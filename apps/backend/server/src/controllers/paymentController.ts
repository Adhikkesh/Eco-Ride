import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { db, rtdb } from "../config/firebase.js";

let stripeInstance: Stripe | null = null;

const getStripe = () => {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      console.log("✅ STRIPE_SECRET_KEY found, initializing Stripe client...");
      stripeInstance = new Stripe(key, {
        typescript: true,
      });
    } else {
      console.warn("⚠️ STRIPE_SECRET_KEY is missing when attempting to initialize Stripe.");
    }
  }
  return stripeInstance;
};

export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({
        message: "Ride not found",
        success: false,
      });
    }

    const rideData = rideDoc.data();
    const fare = rideData?.fare;

    let finalFare = fare || 100;

    if (finalFare < 50) {
      console.warn(`Fare ₹${finalFare} is below Stripe minimum. Adjusting to ₹50.`);
      finalFare = 50;
    }

    const amountInPaise = Math.round(finalFare * 100);

    const stripe = getStripe();
    if (!stripe) {
      console.error("❌ Stripe is not initialized. Missing API Key.");
      return res.status(503).json({
        message:
          "Payment service unavailable (Stripe not configured - STRIPE_SECRET_KEY missing or invalid)",
        success: false,
      });
    }

    console.log(`Creating payment intent for ride: ${rideId}, amount: ${finalFare}`);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPaise,
      automatic_payment_methods: {
        enabled: true,
      },
      currency: "inr",
      metadata: {
        rideId,
        riderId: rideData?.riderId || "unknown",
      },
    });

    console.log(`✅ Payment intent created successfully: ${paymentIntent.id}`);

    return res.status(200).json({
      amount: finalFare,
      clientSecret: paymentIntent.client_secret,
      success: true,
    });
  } catch (error) {
    console.error("❌ Create Payment Intent Error:", error);
    return res.status(500).json({
      message: `Error creating payment intent: ${error instanceof Error ? error.message : "Unknown error"}`,
      success: false,
    });
  }
};

export const confirmPayment = async (req: Request, res: Response) => {
  try {
    const { rideId, amount } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    console.log(`Confirming payment for ride: ${rideId}, amount: ${amount}`);

    const rideDoc = await db.collection("rides").doc(rideId).get();
    const driverId = rideDoc.data()?.driverId;

    await rtdb.ref(`rides/${rideId}`).update({
      paidAmount: amount,
      paymentStatus: "PAID",
      status: "PAYMENT_CONFIRMED",
    });

    // Update Firestore
    await db.collection("rides").doc(rideId).update({
      paidAmount: amount,
      paymentStatus: "PAID",
    });

    if (driverId) {
      await rtdb.ref(`drivers-online/${driverId}`).update({ status: "AVAILABLE" });
      console.log(`Driver ${driverId} is now AVAILABLE after payment confirmation`);

      // Update Driver's Wallet Balance
      try {
        const fareAmount = Number(amount) || 0;
        await db
          .collection("driver_profile")
          .doc(driverId)
          .update({
            wallet_balance: FieldValue.increment(fareAmount),
          });
        console.log(`Incremented wallet balance for driver ${driverId} by ${fareAmount}`);
      } catch (err) {
        console.error("Error updating driver wallet balance:", err);
      }

      // Update Driver's Trust Score (Rating)
      try {
        // Increment trust score by 0.1 for each successful ride, capped later in fetching or logic if needed
        // For now, simple increment
        await db
          .collection("users")
          .doc(driverId)
          .update({
            trust_score: FieldValue.increment(0.1),
          });
        console.log(`Incremented trust score for driver ${driverId}`);
      } catch (err) {
        console.error("Error updating driver trust score:", err);
      }
    }

    return res.status(200).json({
      message: "Payment confirmed",
      success: true,
    });
  } catch (error) {
    console.error("Confirm Payment Error:", error);
    return res.status(500).json({
      message: "Error confirming payment",
      success: false,
    });
  }
};
