/**
 * Pre-Trip Matching Algorithm Configuration
 *
 * Centralized configuration for tunable parameters across all 4 phases
 * and the eco-friendly ride pooling system.
 */

export const MATCHING_CONFIG = {
  AVERAGE_SPEED_KMH: 30, // City average for ETA calculations

  /** CO₂ grams saved per km when ride is shared vs solo */
  CO2_GRAMS_PER_KM_PETROL: 192,
  DEFAULT_MAX_PASSENGERS: 4, // Default vehicle capacity

  // ═══════════════════════════════════════════════════════════════
  // EV PRIORITY — Sustainability-Aware Matching (2.9 + 2.10)
  // ═══════════════════════════════════════════════════════════════
  /** Cost bonus (subtracted from cost) for ELECTRIC vehicles. Higher = stronger preference. */
  EV_BONUS: 0.15,
  /** Cost bonus for HYBRID vehicles. Less than EV but still preferred over petrol. */
  HYBRID_BONUS: 0.07,

  // ═══════════════════════════════════════════════════════════════
  // POOLING CONFIGURATION — Eco-Friendly Ride Sharing Rules
  // ═══════════════════════════════════════════════════════════════
  ENABLE_POOLING: true,

  // ═══════════════════════════════════════════════════════════════
  // SPATIAL & MATCHING PHASES
  // ═══════════════════════════════════════════════════════════════

  // Fallback configuration
  EXPANDED_RADIUS_INCREMENT_KM: 5,

  // Fuel consumption factors (liters per 100km)
  FUEL_CONSUMPTION: {
    DIESEL: 6.5,
    ELECTRIC: 0,
    HYBRID: 4.5,
    PETROL: 8.0,
  } as Record<string, number>,

  // Phase 1: Spatial Indexing
  GEOHASH_PRECISION: 6, // ~1.2km x 0.6km cells

  // Phase 3: Detour Feasibility
  MAX_DETOUR_MINUTES: 15,
  MAX_PICKUP_RADIUS_KM: 2, // Initial search radius

  /**
   * Max riders sharing one vehicle (excluding driver).
   * Lower = more comfort, Higher = more eco-friendly.
   */
  MAX_POOLED_RIDERS: 3,
  MAX_SEARCH_RADIUS_KM: 100,

  // Phase 2: Vector Alignment
  MIN_COSINE_SIMILARITY: 0.8, // cos(36.87°) ≈ 0.8, angle < ~37°

  /**
   * OTP wait timeout at each pickup point (seconds).
   * If rider doesn't provide OTP, trip auto-starts.
   */
  OTP_WAIT_TIMEOUT_S: 300,

  // ═══════════════════════════════════════════════════════════════
  // FARE & ECO CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  /** Base discount % for choosing pooled ride (rider incentive) */
  POOL_BASE_DISCOUNT: 0.25, // 25% off for opting into pooling

  /** Green points bonus multiplier for pooled rides */
  POOL_GREEN_POINTS_MULTIPLIER: 1.5, // 50% more green points for eco-friendly pooling

  /** Additional discount per extra passenger sharing (stacks) */
  POOL_PER_PASSENGER_DISCOUNT: 0.05, // +5% off per additional rider (max 35% with 3 riders)

  /**
   * Max extra time (factor) allowed for detours when pooling.
   * 1.5 = allow 50% longer total trip time for pooled rides.
   */
  POOLING_DETOUR_TOLERANCE_FACTOR: 1.5,

  /**
   * Max distance between rider destinations to qualify for pooling (km).
   * Riders heading to similar areas get grouped together.
   */
  POOLING_DROP_TOLERANCE_KM: 5,

  /**
   * Max wait time (seconds) for a pooled ride match before falling back to solo.
   */
  POOLING_MATCH_TIMEOUT_S: 120,

  /**
   * Max detour distance (km) for picking up an additional rider mid-trip.
   * Prevents wildly out-of-the-way pickups.
   */
  POOLING_MAX_DETOUR_KM: 3,

  /**
   * Minimum route direction similarity (cosine) for pooling.
   * 0.7 ≈ 45° max angle divergence — ensures riders go roughly the same way.
   */
  POOLING_MIN_DIRECTION_SIMILARITY: 0.7,

  /**
   * Max distance between rider pickups to qualify for pooling (km).
   * Ensures all pickups are within a reasonable detour.
   */
  POOLING_PICKUP_TOLERANCE_KM: 5,
  WEIGHT_DETOUR: 0.35,
  WEIGHT_FUEL: 0.25,

  // Phase 4: Global Optimization Weights
  WEIGHT_PICKUP_TIME: 0.4,
} as const;

export type MatchingConfig = typeof MATCHING_CONFIG;
