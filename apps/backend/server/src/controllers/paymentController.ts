/**
 * @fileoverview Payment Controller
 * @description Handles payment processing for the Eco-Ride platform via Stripe.
 *              Provides endpoints for creating payment intents and confirming payments.
 *              Uses lazy initialization for the Stripe client to defer secret key access.
 * @module controllers/paymentController
 */

import type { Request, Response } from "express";
import Stripe from "stripe";
import { db, rtdb } from "../config/firebase.js";

/**
 * Lazily-initialized Stripe SDK instance.
 * Created on first use rather than at module load time.
 */
let stripeInstance: Stripe | null = null;

/**
 * Returns the Stripe SDK instance, creating it on first call.
 *
 * Initialization is deferred so the `STRIPE_SECRET_KEY` environment variable
 * doesn't need to be present at module load time. Subsequent calls return
 * the cached instance.
 *
 * @returns The initialised Stripe client, or `null` if the secret key is missing.
 */
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

/**
 * Creates a Stripe PaymentIntent for an existing ride.
 *
 * Looks up the ride document in Firestore to determine the fare, enforces the
 * Stripe minimum of ₹50, and returns the `clientSecret` the frontend needs to
 * complete the payment flow.
 *
 * @param req - Express request containing `rideId` in the body.
 * @param res - Express response.
 * @returns JSON with `clientSecret`, `amount`, and `success` flag.
 * @throws Returns 400 if `rideId` is missing, 404 if the ride doesn't exist,
 *         or 503 if Stripe is not configured.
 */
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

/**
 * Confirms a completed payment and updates ride/driver state.
 *
 * Sets `paymentStatus` to `"PAID"` in both Firestore and RTDB, marks the
 * ride as `"PAYMENT_CONFIRMED"`, and releases the driver back to
 * `"AVAILABLE"` status so they can accept new rides.
 *
 * @param req - Express request containing `rideId` and `amount` in the body.
 * @param res - Express response.
 * @returns JSON with success message or an error.
 * @throws Returns 400 if `rideId` is missing.
 */
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
