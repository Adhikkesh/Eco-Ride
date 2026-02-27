/**
 * Green Points Calculation Utility
 *
 * Formula: GreenPoints = ((E_benchmark - (E_vehicle / N_passengers)) * Distance) / 10
 *
 * Where:
 * - E_benchmark = 150 g/km (standard petrol car emissions)
 * - E_vehicle = emissions based on vehicle type
 * - N_passengers = vehicle passenger capacity (pooling factor)
 * - Distance = trip length in km
 */

export type VehicleType = "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";

/**
 * Emission factors in grams of CO2 per kilometer
 */
export const EMISSION_FACTORS: Record<VehicleType, number> = {
  DIESEL: 130,
  ELECTRIC: 0,
  HYBRID: 70,
  PETROL: 150,
};

/**
 * Benchmark emission (standard petrol car)
 */
export const E_BENCHMARK = 150; // g/km

/**
 * Calculate green points earned for a trip
 *
 * @param vehicleType - Type of vehicle used (PETROL, DIESEL, HYBRID, ELECTRIC)
 * @param passengerCapacity - Number of passengers the vehicle can accommodate
 * @param distanceKm - Trip distance in kilometers
 * @returns Green points earned (rounded to nearest integer, minimum 0)
 */
export function calculateGreenPoints(
  vehicleType: VehicleType,
  passengerCapacity: number,
  distanceKm: number,
): number {
  // Validate inputs
  if (passengerCapacity < 1) {
    passengerCapacity = 1; // Minimum 1 passenger (the driver)
  }

  const eVehicle = EMISSION_FACTORS[vehicleType] ?? EMISSION_FACTORS.PETROL;

  // Formula: ((E_benchmark - (E_vehicle / N_passengers)) * Distance) / 10
  const points = ((E_BENCHMARK - eVehicle / passengerCapacity) * distanceKm) / 10;

  // Return rounded points, minimum 0
  return Math.max(0, Math.round(points));
}
