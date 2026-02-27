/**
 * Pre-Trip Matching Algorithm Configuration
 *
 * Centralized configuration for tunable parameters across all 4 phases.
 */

export const MATCHING_CONFIG = {
  AVERAGE_SPEED_KMH: 30, // City average for ETA calculations
  DEFAULT_MAX_PASSENGERS: 4, // Default vehicle capacity

  // Pooling Configuration
  ENABLE_POOLING: true,

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
  MAX_POOLED_RIDERS: 3, // Max riders per vehicle (excluding driver)
  MAX_SEARCH_RADIUS_KM: 100,

  // Phase 2: Vector Alignment
  MIN_COSINE_SIMILARITY: 0.8, // cos(36.87°) ≈ 0.8, angle < ~37°
  POOLING_DETOUR_TOLERANCE_FACTOR: 1.5, // Allow 50% more detour for pooled rides
  POOLING_DROP_TOLERANCE_KM: 2, // Max distance between destinations for pooling
  POOLING_PICKUP_TOLERANCE_KM: 2, // Max distance between pickups for pooling
  WEIGHT_DETOUR: 0.35,
  WEIGHT_FUEL: 0.25,

  // Phase 4: Global Optimization Weights
  WEIGHT_PICKUP_TIME: 0.4,
} as const;

export type MatchingConfig = typeof MATCHING_CONFIG;
