/**
 * @fileoverview Fare Controller
 * @description Handles fare calculation for rides using Google Routes API.
 *              Computes dynamic pricing based on distance, duration, and ride type.
 *              Also calculates CO2 emissions saved by using electric vehicles.
 * @module controllers/fareController
 */

import type { Request, Response } from "express";

/**
 * Pricing configuration for fare calculation (in INR).
 * @constant {Object}
 * @property {number} BASE_FARE - Base fare for all rides in rupees
 * @property {number} PER_KM - Per kilometer charge in rupees
 * @property {number} PER_MIN - Per minute charge in rupees
 * @property {number} POOL_DISCOUNT - Discount percentage for pooled rides (0.2 = 20%)
 */
const PRICING = {
  BASE_FARE: 40,
  PER_KM: 12,
  PER_MIN: 1.5,
  POOL_DISCOUNT: 0.2,
};

/**
 * CO2 emissions configuration (grams per kilometer).
 * Used to calculate environmental impact savings.
 * @constant {Object}
 * @property {number} EV_G_PER_KM - Emissions for electric vehicles (0g)
 * @property {number} PETROL_G_PER_KM - Average emissions for petrol vehicles
 */
const EMISSIONS = {
  EV_G_PER_KM: 0,
  PETROL_G_PER_KM: 192,
};

/**
 * Request body interface for fare estimation endpoint.
 * @interface EstimateRequest
 * @property {Object} pickup - Pickup location coordinates
 * @property {number} pickup.lat - Pickup latitude
 * @property {number} pickup.lng - Pickup longitude
 * @property {Object} drop - Drop-off location coordinates
 * @property {number} drop.lat - Drop-off latitude
 * @property {number} drop.lng - Drop-off longitude
 * @property {boolean} [isPooled] - Whether this is a pooled ride (optional)
 */
interface EstimateRequest {
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  isPooled?: boolean;
}

/**
 * Calculate Fare Controller
 * @description Calculates ride fare using Google Routes API for distance and duration.
 *              Applies base fare + per-km + per-minute pricing with optional pool discount.
 *              Also returns CO2 savings, route polyline, and ETA.
 * @route POST /fare/calculate
 * @param {EstimateRequest} req.body - Pickup and drop coordinates with optional pooling flag
 * @returns {Object} JSON response with fare, distance, ETA, CO2 savings, and route polyline
 */
export const calculateFare = async (req: Request, res: Response) => {
  try {
    const { pickup, drop, isPooled } = req.body as EstimateRequest;

    if (!pickup?.lat || !pickup?.lng || !drop?.lat || !drop?.lng) {
      return res.status(400).json({
        message: "Invalid pickup or drop coordinates",
        success: false,
      });
    }

    // Read API Key at runtime to ensure env is loaded
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

    if (!GOOGLE_API_KEY) {
      console.error("GOOGLE_API_KEY is missing in server environment");
      return res.status(500).json({
        message: "Server configuration error",
        success: false,
      });
    }

    // Call Google Routes API (v2)
    // Docs: https://developers.google.com/maps/documentation/routes/compute_route
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      body: JSON.stringify({
        computeAlternativeRoutes: false,
        destination: { location: { latLng: { latitude: drop.lat, longitude: drop.lng } } },
        origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
        routingPreference: "TRAFFIC_AWARE",
        travelMode: "DRIVE",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      method: "POST",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Routes API Failed:", {
        errorBody: errorText,
        status: response.status,
        statusText: response.statusText,
      });
      return res.status(response.status).json({
        message: `Routes API Error: ${response.status} - ${errorText}`,
        success: false,
      });
    }

    const data = await response.json();
    const route = data.routes?.[0];

    if (!route) {
      return res.status(404).json({
        message: "No route found between these locations",
        success: false,
      });
    }

    // Extract metrics
    const distanceMeters = route.distanceMeters || 0;
    // Duration comes as string "123s"
    const durationString = route.duration || "0s";
    const durationSeconds = parseInt(durationString.replace("s", ""), 10);

    const distanceKm = distanceMeters / 1000;
    const durationMin = durationSeconds / 60;

    // Pricing Logic
    let totalFare = PRICING.BASE_FARE + distanceKm * PRICING.PER_KM + durationMin * PRICING.PER_MIN;

    if (isPooled) {
      totalFare = totalFare * (1 - PRICING.POOL_DISCOUNT);
    }

    const finalFare = Math.round(totalFare);

    // CO2 Logic
    const co2EmittedStandard = distanceKm * EMISSIONS.PETROL_G_PER_KM;
    const co2Saved = Math.round(co2EmittedStandard); // 100% savings with EV

    return res.status(200).json({
      co2_saved_g: co2Saved,
      currency: "INR",
      details: {
        distance_m: distanceMeters,
        duration_s: durationSeconds,
      },
      distance_km: distanceKm.toFixed(1),
      eta_min: Math.round(durationMin),
      fare: finalFare,
      polyline: route.polyline.encodedPolyline,
      success: true,
    });
  } catch (error) {
    console.error("Calculate Fare Error:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};
