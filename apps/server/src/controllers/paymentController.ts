/**
 * @fileoverview Payment Controller
 * @description Handles payment processing for rides using Stripe payment gateway.
 *              Manages payment intent creation and payment confirmation workflows.
 *              Integrates with Firebase Firestore and Realtime Database for ride data.
 * @module controllers/paymentController
 */

import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { db, rtdb } from "../config/firebase.js";

console.log("------------------ PAYMENT CONTROLLER LOADED ------------------");

/**
 * Singleton instance of the Stripe client.
 * Initialized lazily when first payment operation is requested.
 * @type {Stripe | null}
 */
let stripeInstance: Stripe | null = null;

/**
 * Get or initialize the Stripe client instance.
 * @description Lazily initializes the Stripe client using the STRIPE_SECRET_KEY
 *              environment variable. Logs warnings if key is missing.
 * @returns {Stripe | null} Stripe client instance or null if not configured
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
 * Create Payment Intent Controller
 * @description Creates a Stripe payment intent for a ride.
 *              Fetches ride details from Firestore to determine fare amount.
 *              Handles legacy rides without fare data by using a fallback amount.
 * @route POST /payment/create-intent
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride
 * @returns {Object} JSON response with clientSecret, amount, and success status
 */
import fs from "node:fs/promises";
import path from "node:path";
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { rideId, useGreenPoints } = req.body;

    console.log(
      `[PaymentDebug] createPaymentIntent called. rideId: ${rideId}, useGreenPoints: ${useGreenPoints}`,
    );

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    // 1. Fetch Ride Details to get Fare
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

    // Stripe India minimum amount is ₹50
    if (finalFare < 50) {
      console.warn(`Fare ₹${finalFare} is below Stripe minimum. Adjusting to ₹50.`);
      finalFare = 50;
    }

    // Stripe expects amount in cents/lowest currency unit
    // Assuming fare is in INR integers (Rupees), convert to paise
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
        pointsUsed: pointsUsed.toString(),
        rideId,
        riderId: riderId || "unknown",
      },
    });

    console.log(`✅ Payment intent created successfully: ${paymentIntent.id}`);

    return res.status(200).json({
      amount: finalFare,
      clientSecret: paymentIntent.client_secret,
      debug: {
        availablePoints,
        calculatedDiscount: discountAmount,
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
 * Confirm Payment Controller
 * @description Confirms a successful payment and updates ride status.
 *              Updates both Firebase Realtime Database and Firestore to notify
 *              the driver and maintain persistent payment records.
 * @route POST /payment/confirm
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride
 * @param {number} req.body.amount - The amount paid
 * @returns {Object} JSON response with confirmation status
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

    // Update RTDB to notify driver
    await rtdb.ref(`rides/${rideId}`).update(updates);

    // Update Firestore Ride Doc
    const rideRef = db.collection("rides").doc(rideId);
    await rideRef.update(updates);

    // Deduct points from User if used
    if (pointsUsed && pointsUsed > 0) {
      const rideDoc = await rideRef.get();
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
