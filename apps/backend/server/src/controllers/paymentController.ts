/**
 * @fileoverview Payment Controller
 * @description Handles payment processing for the Eco-Ride platform via Stripe.
 *              Provides endpoints for creating payment intents and confirming payments.
 *              Uses lazy initialization for the Stripe client to defer secret key access.
 * @module controllers/paymentController
 */

import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { db, rtdb } from "../config/firebase.js";

console.log("------------------ PAYMENT CONTROLLER LOADED ------------------");

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

export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { rideId, useGreenPoints, carbonOffset } = req.body;

    console.log(
      `[PaymentDebug] createPaymentIntent called. rideId: ${rideId}, useGreenPoints: ${useGreenPoints}`,
    );

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
    const fare = Number(rideData?.fare || 0);
    const riderId = rideData?.riderId;

    // Fallback for legacy rides (created before fare was saved)
    let finalFare = fare > 0 ? fare : 100;
    let discountAmount = 0;
    let pointsUsed = 0;
    let availablePoints = 0;
    const carbonOffsetAmount = carbonOffset ? 5 : 0;

    console.log(`[PaymentDebug] Initial Fare: ${fare}, finalFare: ${finalFare}`);

    // 2. Calculate Green Points Discount
    if (useGreenPoints && riderId) {
      const userDoc = await db.collection("users").doc(riderId).get();
      const userData = userDoc.data();
      availablePoints = Number(userData?.green_points || 0);

      if (availablePoints > 0) {
        console.log(
          `[PaymentDebug] Available Points: ${availablePoints}, starting finalFare: ${finalFare}`,
        );
        // 1 Point = 1 Rupee
        discountAmount = Math.min(finalFare, availablePoints);

        console.log(`[PaymentDebug] Initial discountAmount: ${discountAmount}`);

        // Ensure we don't drop below Stripe minimum (₹50) unless we cover the FULL amount
        const remainingAmount = finalFare - discountAmount;
        if (remainingAmount > 0 && remainingAmount < 50) {
          // Adjust discount to leave exactly ₹50 to pay
          discountAmount = Math.max(0, finalFare - 50);
          console.log(`[PaymentDebug] Adjusted discountAmount (Stripe min): ${discountAmount}`);
        }

        pointsUsed = discountAmount;
        const prevFare = finalFare;

        // Explicitly handle full coverage to avoid any floating point issues
        if (discountAmount >= finalFare) {
          finalFare = 0;
        } else {
          finalFare = finalFare - discountAmount;
        }

        console.log(
          `[PaymentDebug] Updated finalFare: ${finalFare} (was ${prevFare}) - discount: ${discountAmount}`,
        );
      }
    }

    // 3. Handle 100% Discount (No Stripe Payment Needed)
    if (finalFare === 0) {
      return res.status(200).json({
        amount: 0,
        clientSecret: null,
        discountAmount,
        message: "Ride fully covered by Green Points",
        pointsUsed,
        success: true,
      });
    }

    if (finalFare < 50) {
      console.warn(`Fare ₹${finalFare} is below Stripe minimum. Adjusting to ₹50.`);
      finalFare = 50;
    }

    // Add carbon offset fee if opted-in
    finalFare += carbonOffsetAmount;

    const amountInPaise = Math.round(finalFare * 100);

    // 4. Create Payment Intent
    const stripe = getStripe();
    if (!stripe) {
      console.error("❌ Stripe is not initialized. Missing API Key.");
      return res.status(503).json({
        message:
          "Payment service unavailable (Stripe not configured - STRIPE_SECRET_KEY missing or invalid)",
        success: false,
      });
    }

    console.log(
      `Creating payment intent for ride: ${rideId}, amount: ${finalFare}, points used: ${pointsUsed}`,
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPaise,
      automatic_payment_methods: {
        enabled: true,
      },
      currency: "inr",
      metadata: {
        carbonOffset: carbonOffset ? "true" : "false",
        carbonOffsetAmount: carbonOffsetAmount.toString(),
        pointsUsed: pointsUsed.toString(),
        rideId,
        riderId: riderId || "unknown",
      },
    });

    console.log(`✅ Payment intent created successfully: ${paymentIntent.id}`);

    return res.status(200).json({
      amount: finalFare,
      carbonOffsetAmount,
      clientSecret: paymentIntent.client_secret,
      debug: {
        availablePoints,
        calculatedDiscount: discountAmount,
        carbonOffset: carbonOffsetAmount,
        finalCalculatedFare: finalFare,
        originalFareFromDB: fare,
      },
      discountAmount,
      pointsUsed,
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
    const { rideId, amount, pointsUsed } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    console.log(
      `Confirming payment for ride: ${rideId}, amount: ${amount}, points used: ${pointsUsed}`,
    );

    const updates: any = {
      paidAmount: amount,
      paymentStatus: "PAID",
    };

    if (pointsUsed) {
      updates.greenPointsRedeemed = pointsUsed;
    }

    const rideDoc = await db.collection("rides").doc(rideId).get();
    const driverId = rideDoc.data()?.driverId;

    // Update RTDB to notify driver
    await rtdb.ref(`rides/${rideId}`).update({
      ...updates,
      status: "PAYMENT_CONFIRMED",
    });

    // Update Firestore Ride Doc
    const rideRef = db.collection("rides").doc(rideId);
    await rideRef.update(updates);

    // Deduct points from User if used
    if (pointsUsed && pointsUsed > 0) {
      const riderId = rideDoc.data()?.riderId;

      if (riderId) {
        await db
          .collection("users")
          .doc(riderId)
          .update({
            green_points: FieldValue.increment(-pointsUsed),
          });
        console.log(`Deducted ${pointsUsed} green points from user ${riderId}`);
      }
    }

    if (driverId) {
      // ═══════════════════════════════════════════════════════════════
      // Pool-Aware: Only set driver AVAILABLE if no other active rides
      // ═══════════════════════════════════════════════════════════════
      let hasOtherActiveRides = false;

      try {
        // Check if there are other active (non-completed) rides for this driver
        const activeRidesSnap = await db
          .collection("rides")
          .where("driverId", "==", driverId)
          .where("status", "in", ["MATCHED", "STARTED", "IN_PROGRESS", "COMPLETED"])
          .get();

        // Filter out the current ride — if other rides exist, driver stays busy
        const otherActiveRides = activeRidesSnap.docs.filter((d) => d.id !== rideId);
        hasOtherActiveRides = otherActiveRides.length > 0;
      } catch (err) {
        console.error("Error checking for other active rides:", err);
      }

      if (!hasOtherActiveRides) {
        await rtdb.ref(`drivers-online/${driverId}`).update({ status: "AVAILABLE" });
        console.log(`Driver ${driverId} is now AVAILABLE after payment confirmation`);
      } else {
        console.log(`Driver ${driverId} has other active pooled rides — staying BUSY`);
      }

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
