/**
 * Geospatial Utilities for Dynamic En-Route Pooling
 *
 * Provides:
 * - Polyline Buffer generation (1km corridor around driver's remaining route)
 * - Point-in-Polygon (ray-casting) for intercept queries
 * - Downstream verification (vector alignment along route)
 * - Haversine distance + bearing calculations
 */

// ============================================================================
// Types
// ============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

/** A polygon represented as an ordered array of vertices */
export type Polygon = LatLng[];

// ============================================================================
// Constants
// ============================================================================

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ============================================================================
// Core Geo Functions
// ============================================================================

/**
 * Haversine distance between two points in km.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Initial bearing from point A to point B (degrees, 0 = North, clockwise).
 */
export function bearing(from: LatLng, to: LatLng): number {
  const dLng = (to.lng - from.lng) * DEG_TO_RAD;
  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/**
 * Offset a point by a given distance (km) and bearing (degrees).
 * Returns new LatLng.
 */
export function offsetPoint(origin: LatLng, distanceKm: number, bearingDeg: number): LatLng {
  const d = distanceKm / EARTH_RADIUS_KM;
  const brng = bearingDeg * DEG_TO_RAD;
  const lat1 = origin.lat * DEG_TO_RAD;
  const lng1 = origin.lng * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: lat2 * RAD_TO_DEG, lng: lng2 * RAD_TO_DEG };
}

/**
 * Perpendicular distance from a point to a line segment (km).
 * Returns the minimum distance from `point` to the segment [segA, segB].
 */
export function pointToSegmentDistanceKm(point: LatLng, segA: LatLng, segB: LatLng): number {
  const dAB = haversineKm(segA, segB);
  if (dAB === 0) return haversineKm(point, segA);

  // Project point onto segment using parametric t
  const dAP = haversineKm(segA, point);
  if (dAP === 0) return 0; // Point is exactly at segA
  const dBP = haversineKm(segB, point);

  // Use the cosine rule to find projection parameter
  const cosAngle = (dAP * dAP + dAB * dAB - dBP * dBP) / (2 * dAP * dAB);
  const t = (dAP * cosAngle) / dAB;

  if (t <= 0) return dAP;
  if (t >= 1) return dBP;

  // Interpolate closest point on segment
  const closestLat = segA.lat + t * (segB.lat - segA.lat);
  const closestLng = segA.lng + t * (segB.lng - segA.lng);
  return haversineKm(point, { lat: closestLat, lng: closestLng });
}

// ============================================================================
// Polyline Buffer (Active Route Corridor)
// ============================================================================

/**
 * Generate a polygon buffer around a polyline at a given radius (km).
 *
 * Algorithm:
 * 1. For each segment, compute perpendicular offset points on both sides.
 * 2. Left-side offsets form one edge, right-side offsets form the other.
 * 3. Close the polygon by connecting the two edges with semicircular caps.
 *
 * Returns a closed polygon (first vertex === last vertex).
 */
export function generatePolylineBuffer(polyline: LatLng[], bufferKm: number): Polygon {
  if (polyline.length < 2) return [];

  const leftSide: LatLng[] = [];
  const rightSide: LatLng[] = [];

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const segBearing = bearing(a, b);

    // Perpendicular bearings
    const leftBearing = (segBearing - 90 + 360) % 360;
    const rightBearing = (segBearing + 90) % 360;

    // Offset start point of segment
    leftSide.push(offsetPoint(a, bufferKm, leftBearing));
    rightSide.push(offsetPoint(a, bufferKm, rightBearing));

    // Offset end point of last segment
    if (i === polyline.length - 2) {
      leftSide.push(offsetPoint(b, bufferKm, leftBearing));
      rightSide.push(offsetPoint(b, bufferKm, rightBearing));
    }
  }

  // Build closed polygon: left side forward, then right side reversed
  // Add semicircular end caps for better coverage
  const polygon: LatLng[] = [];

  // Start cap (semicircle around first polyline point)
  const firstPoint = polyline[0]!;
  const firstBearing = bearing(firstPoint, polyline[1]!);
  const startCapBearing = (firstBearing + 180) % 360; // Backward
  for (let angle = -90; angle <= 90; angle += 30) {
    polygon.push(offsetPoint(firstPoint, bufferKm, (startCapBearing + angle + 360) % 360));
  }

  // Left side (forward)
  polygon.push(...leftSide);

  // End cap (semicircle around last polyline point)
  const lastPoint = polyline[polyline.length - 1]!;
  const lastBearing = bearing(polyline[polyline.length - 2]!, lastPoint);
  for (let angle = -90; angle <= 90; angle += 30) {
    polygon.push(offsetPoint(lastPoint, bufferKm, (lastBearing + angle + 360) % 360));
  }

  // Right side (reverse)
  polygon.push(...rightSide.reverse());

  // Close the polygon
  if (polygon.length > 0) {
    polygon.push(polygon[0]!);
  }

  return polygon;
}

// ============================================================================
// Point-in-Polygon (Ray Casting)
// ============================================================================

/**
 * Determine if a point lies inside a polygon using the ray-casting algorithm.
 * Works for convex and concave polygons.
 */
export function pointInPolygon(point: LatLng, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const { lat: px, lng: py } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i]!;
    const vj = polygon[j]!;

    const intersect =
      vi.lng > py !== vj.lng > py &&
      px < ((vj.lat - vi.lat) * (py - vi.lng)) / (vj.lng - vi.lng) + vi.lat;

    if (intersect) inside = !inside;
  }

  return inside;
}

// ============================================================================
// Fast Corridor Check (distance-based, no polygon needed)
// ============================================================================

/**
 * Quick check: is a point within `bufferKm` of ANY segment in the polyline?
 * This is faster than full polygon generation + PIP for simple checks.
 */
export function isPointWithinPolylineCorridor(
  point: LatLng,
  polyline: LatLng[],
  bufferKm: number,
): boolean {
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = pointToSegmentDistanceKm(point, polyline[i]!, polyline[i + 1]!);
    if (dist <= bufferKm) return true;
  }
  return false;
}

// ============================================================================
// Downstream Verification (Vector Alignment)
// ============================================================================

/**
 * Find the closest point index on the polyline to a given point.
 * Returns the index of the polyline vertex closest to the target.
 */
export function closestPolylineIndex(point: LatLng, polyline: LatLng[]): number {
  let minDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < polyline.length; i++) {
    const d = haversineKm(point, polyline[i]!);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Downstream Verification: ensures Rider B's drop-off is structurally
 * "ahead" (downstream) of their pickup on the driver's route.
 *
 * This prevents backtracking — if drop-off projects onto an earlier
 * segment of the polyline than pickup, the ride would require reversing.
 *
 * @returns true if drop-off is downstream of pickup
 */
export function isDropoffDownstream(
  pickupPoint: LatLng,
  dropoffPoint: LatLng,
  polyline: LatLng[],
): boolean {
  if (polyline.length < 2) return false;

  const pickupIdx = closestPolylineIndex(pickupPoint, polyline);
  const dropoffIdx = closestPolylineIndex(dropoffPoint, polyline);

  // Drop-off must be at the same or later index in the polyline
  return dropoffIdx >= pickupIdx;
}

/**
 * Calculate the route distance (km) along the polyline between two indices.
 */
export function polylineSubDistance(polyline: LatLng[], fromIdx: number, toIdx: number): number {
  let dist = 0;
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);

  for (let i = start; i < end && i < polyline.length - 1; i++) {
    dist += haversineKm(polyline[i]!, polyline[i + 1]!);
  }

  return dist;
}
