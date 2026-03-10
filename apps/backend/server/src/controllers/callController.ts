/**
 * @fileoverview Call Masking Controller
 * @description Implements Twilio-based call masking so riders and drivers
 *              never see each other's real phone numbers.
 *              Uses Twilio REST API to initiate a call from the Twilio number
 *              to the caller, then connects to the other party via TwiML.
 * @module controllers/callController
 */

import type { Request, Response } from "express";
import twilio from "twilio";
import { db } from "../config/firebase.js";

/**
 * Initiate a masked call between rider and driver.
 * @description Looks up the ride to get both parties' phone numbers,
 *              then uses Twilio to connect the call with the Twilio number
 *              as the caller ID for both sides.
 * @route POST /call/mask
 * @param {string} req.body.rideId - The ride ID to look up contact info
 * @param {"rider"|"driver"} req.body.callerRole - Who is initiating the call
 */
export const initiateCallMask = async (req: Request, res: Response) => {
  try {
    const { rideId, callerRole } = req.body;

    if (!rideId || !callerRole) {
      return res
        .status(400)
        .json({ message: "Missing rideId or callerRole", success: false });
    }

    // Read env vars at call time (not module-load time) to ensure dotenv has loaded
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !twilioNumber) {
      console.error("Twilio env vars missing:", {
        TWILIO_ACCOUNT_SID: accountSid ? "SET" : "MISSING",
        TWILIO_AUTH_TOKEN: authToken ? "SET" : "MISSING",
        TWILIO_PHONE_NUMBER: twilioNumber ? "SET" : "MISSING",
      });
      return res
        .status(500)
        .json({ message: "Twilio not configured", success: false });
    }

    // Look up ride to get phone numbers
    const rideDoc = await db.collection("rides").doc(rideId).get();
    if (!rideDoc.exists) {
      return res
        .status(404)
        .json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();
    const riderId = rideData?.riderId;
    const driverId = rideData?.driverId;

    if (!riderId || !driverId) {
      return res
        .status(400)
        .json({ message: "Ride missing rider or driver", success: false });
    }

    // Get phone numbers from user profiles
    const [riderDoc, driverDoc] = await Promise.all([
      db.collection("users").doc(riderId).get(),
      db.collection("users").doc(driverId).get(),
    ]);

    const riderPhone = riderDoc.data()?.phone_number;
    const driverPhone = driverDoc.data()?.phone_number;

    if (!riderPhone || !driverPhone) {
      return res
        .status(400)
        .json({ message: "Phone numbers not available", success: false });
    }

    // Determine caller and recipient based on who initiated
    const callerPhone = callerRole === "rider" ? riderPhone : driverPhone;
    const recipientPhone = callerRole === "rider" ? driverPhone : riderPhone;

    // Ensure phone numbers have country code (default to India +91)
    const formatPhone = (phone: string): string => {
      const cleaned = phone.replace(/\s+/g, "").replace(/-/g, "");
      if (cleaned.startsWith("+")) return cleaned;
      if (cleaned.startsWith("0")) return `+91${cleaned.substring(1)}`;
      if (cleaned.length === 10) return `+91${cleaned}`;
      return `+${cleaned}`;
    };

    const formattedCaller = formatPhone(callerPhone);
    const formattedRecipient = formatPhone(recipientPhone);

    // Create Twilio client and initiate call
    // Call the RECIPIENT's phone; when they pick up, bridge to the CALLER
    // so the person who tapped "Call" hears the other party's phone ring.
    const client = twilio(accountSid, authToken);

    const call = await client.calls.create({
      from: twilioNumber,
      to: formattedRecipient,
      twiml: `<Response><Say>Connecting you now. Please hold.</Say><Dial callerId="${twilioNumber}"><Number>${formattedCaller}</Number></Dial></Response>`,
    });

    console.log(`Call masking initiated: SID=${call.sid}, ${callerRole} (${formattedCaller}) → ${formattedRecipient}`);

    return res.status(200).json({
      message: "Calling rider now...",
      callSid: call.sid,
      success: true,
    });
  } catch (error) {
    console.error("Call Masking Error:", error);

    // Provide helpful error messages for common Twilio issues
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    if (errMsg.includes("unverified")) {
      return res.status(400).json({
        message:
          "Phone number not verified in Twilio trial. Add it at console.twilio.com → Verified Caller IDs.",
        success: false,
      });
    }

    return res
      .status(500)
      .json({ message: `Call failed: ${errMsg}`, success: false });
  }
};
