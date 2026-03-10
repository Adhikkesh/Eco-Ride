/**
 * @fileoverview Fare Controller
 * @description Handles fare calculation for rides using Google Routes API.
 *              Computes dynamic pricing based on distance, duration, and ride type.
 *              Also calculates CO2 emissions saved by using electric vehicles.
 * @module controllers/fareController
 */

import type { Request, Response } from "express";

const PREDICTION_SERVICE_URL = process.env.PREDICTION_SERVICE_URL || "http://prediction:5000";

/**
 * Pricing configuration for fare calculation (in INR).
 * @constant {Object}
 * @property {number} BASE_FARE - Base fare for all rides in rupees
 * @property {number} PER_KM - Per kilometer charge in rupees
 * @property {number} PER_MIN - Per minute charge in rupees
 * @property {number} POOL_BASE_DISCOUNT - Base discount for choosing pooled ride (25%)
 * @property {number} POOL_PER_PASSENGER_DISCOUNT - Additional discount per extra passenger (5%)
 */
const PRICING = {
  BASE_FARE: 40,
  GREEN_DISCOUNT_MAX_PCT: 0.10,
  GREEN_DISCOUNT_PER_KM: 0.5,
  PER_KM: 12,
  PER_MIN: 1.5,
  POOL_BASE_DISCOUNT: 0.25,
  POOL_PER_PASSENGER_DISCOUNT: 0.05,
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
  /** Current number of passengers sharing the ride (for dynamic discount) */
  passengerCount?: number;
}

/**
 * Calculates the pooling discount based on passenger count.
 * Base discount of 25% for opting into pooling, plus 5% per additional passenger.
 * Max discount capped at 40%.
 */
function getPoolDiscount(passengerCount: number): number {
  const baseDiscount = PRICING.POOL_BASE_DISCOUNT;
  const extraPassengers = Math.max(0, passengerCount - 1);
  const totalDiscount = baseDiscount + extraPassengers * PRICING.POOL_PER_PASSENGER_DISCOUNT;
  return Math.min(totalDiscount, 0.4); // Cap at 40%
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
    const { pickup, drop, isPooled, passengerCount = 1 } = req.body as EstimateRequest;

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
        requestedReferenceRoutes: ["FUEL_EFFICIENT"],
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
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

    // ═══════════════════════════════════════════════════════════════
    // PRICING LOGIC — Eco-Friendly Fare Calculation
    // ═══════════════════════════════════════════════════════════════
    let baseFare =
      PRICING.BASE_FARE + distanceKm * PRICING.PER_KM + durationMin * PRICING.PER_MIN;

    // Fetch dynamic surge multiplier from Python Microservice
    let surgeMultiplier = 1.0;
    try {
      const now = new Date();
      const surgeRes = await fetch(`${PREDICTION_SERVICE_URL}/predict/surge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hour: now.getHours(),
          day_of_week: now.getDay() === 0 ? 6 : now.getDay() - 1, // mapping to 0=Mon
        }),
      });
      if (surgeRes.ok) {
        const surgeData = await surgeRes.json();
        surgeMultiplier = surgeData.surge_multiplier || 1.0;
      }
    } catch (e) {
      console.warn("Could not fetch surge multiplier, defaulting to 1.0x", e);
    }

    baseFare = baseFare * surgeMultiplier;

    let finalFare = baseFare;
    let poolDiscount = 0;
    let poolSavings = 0;

    if (isPooled) {
      poolDiscount = getPoolDiscount(passengerCount || 1);
      poolSavings = Math.round(baseFare * poolDiscount);
      finalFare = baseFare - poolSavings;
    }

    // ═══════════════════════════════════════════════════════════════
    // GREEN DISCOUNT — Incentive for eco-friendly rides
    // ₹0.5 per km driven, capped at 10% of base fare
    // ═══════════════════════════════════════════════════════════════
    const greenDiscountRaw = distanceKm * PRICING.GREEN_DISCOUNT_PER_KM;
    const greenDiscountCap = baseFare * PRICING.GREEN_DISCOUNT_MAX_PCT;
    const greenDiscount = Math.round(Math.min(greenDiscountRaw, greenDiscountCap));
    finalFare = finalFare - greenDiscount;

    const roundedFare = Math.round(finalFare);

    // ═══════════════════════════════════════════════════════════════
    // CO₂ & ECO CALCULATIONS
    // ═══════════════════════════════════════════════════════════════
    const co2EmittedStandard = distanceKm * EMISSIONS.PETROL_G_PER_KM;
    // For pooled rides, each rider's share of CO2 saved is proportional
    const effectivePassengers = isPooled ? Math.max(passengerCount || 1, 1) : 1;
    const co2SavedPerRider = Math.round(co2EmittedStandard / effectivePassengers);
    const co2SavedTotal = Math.round(co2EmittedStandard);

    // Green points: base + distance bonus, with pooling multiplier
    const baseGreenPoints = Math.round(10 + distanceKm * 2);
    const greenPointsMultiplier = isPooled ? 1.5 : 1.0;
    const greenPoints = Math.round(baseGreenPoints * greenPointsMultiplier);

    return res.status(200).json({
      co2_saved_g: co2SavedTotal,
      co2_saved_per_rider_g: co2SavedPerRider,
      currency: "INR",
      details: {
        distance_m: distanceMeters,
        duration_s: durationSeconds,
      },
      distance_km: distanceKm.toFixed(1),
      eta_min: Math.round(durationMin),
      fare: roundedFare,
      green_discount: greenDiscount,
      green_discount_pct: Math.round((greenDiscount / baseFare) * 100),
      green_points: greenPoints,
      is_pooled: isPooled || false,
      passenger_count: effectivePassengers,
      polyline: route.polyline.encodedPolyline,
      pool_discount_pct: isPooled ? Math.round(poolDiscount * 100) : 0,
      pool_savings: poolSavings,
      solo_fare: Math.round(baseFare),
      surge_multiplier: surgeMultiplier,
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
