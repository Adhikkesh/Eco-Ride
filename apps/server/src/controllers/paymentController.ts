/**
 * @fileoverview Payment Controller
 * @description Handles payment processing for rides using Stripe payment gateway.
 *              Manages payment intent creation and payment confirmation workflows.
 *              Integrates with Firebase Firestore and Realtime Database for ride data.
 * @module controllers/paymentController
 */

import type { Request, Response } from "express";
import Stripe from "stripe";
import { db, rtdb } from "../config/firebase.js";

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
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;

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
    const fare = rideData?.fare;

    // Fallback for legacy rides (created before fare was saved)
    let finalFare = fare || 100;

    // Stripe India minimum amount is ₹50
    if (finalFare < 50) {
      console.warn(`Fare ₹${finalFare} is below Stripe minimum. Adjusting to ₹50.`);
      finalFare = 50;
    }

    // Stripe expects amount in cents/lowest currency unit
    // Assuming fare is in INR integers (Rupees), convert to paise
    const amountInPaise = Math.round(finalFare * 100);

    // 2. Create Payment Intent
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
    const { rideId, amount } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    console.log(`Confirming payment for ride: ${rideId}, amount: ${amount}`);

    // Update RTDB to notify driver
    await rtdb.ref(`rides/${rideId}`).update({
      paidAmount: amount,
      paymentStatus: "PAID",
    });

    // Update Firestore
    await db.collection("rides").doc(rideId).update({
      paidAmount: amount,
      paymentStatus: "PAID",
    });

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
