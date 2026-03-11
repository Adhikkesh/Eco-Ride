/**
 * E2E Test Setup for Simulator
 *
 * Provides fully-mocked Firebase + Axios so that the SimulationEngine
 * and DriverAgent can be tested through their complete lifecycle
 * without hitting any external services.
 */

import { vi } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// In-memory RTDB store for tracking writes
// ═══════════════════════════════════════════════════════════════════════════════

export const rtdbWrites = new Map<string, unknown>();
export const rtdbListeners = new Map<string, Array<(snapshot: unknown) => void>>();

export const createMockRtdbRef = (path = "") => ({
  off: vi.fn(),
  on: vi.fn((event: string, callback: (snapshot: unknown) => void) => {
    const key = `${path}:${event}`;
    if (!rtdbListeners.has(key)) {
      rtdbListeners.set(key, []);
    }
    rtdbListeners.get(key)!.push(callback);
  }),
  once: vi.fn(async () => ({
    val: () => rtdbWrites.get(path) ?? null,
  })),
  remove: vi.fn(async () => {
    rtdbWrites.delete(path);
  }),
  set: vi.fn(async (data: unknown) => {
    rtdbWrites.set(path, data);
  }),
  update: vi.fn(async (data: unknown) => {
    const current = (rtdbWrites.get(path) as Record<string, unknown>) ?? {};
    rtdbWrites.set(path, { ...current, ...(data as Record<string, unknown>) });
  }),
});

export const mockRtdbRef = createMockRtdbRef();

export const mockRtdb = {
  ref: vi.fn((path?: string) => {
    if (path) {
      return createMockRtdbRef(path);
    }
    return mockRtdbRef;
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Firestore
// ═══════════════════════════════════════════════════════════════════════════════

export const firestoreWrites = new Map<string, unknown>();

export const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: vi.fn((id: string) => ({
      get: vi.fn(async () => ({
        data: () => firestoreWrites.get(`${name}/${id}`) ?? {},
        exists: firestoreWrites.has(`${name}/${id}`),
      })),
      set: vi.fn(async (data: unknown) => {
        firestoreWrites.set(`${name}/${id}`, data);
      }),
      update: vi.fn(async (partial: Record<string, unknown>) => {
        const key = `${name}/${id}`;
        const existing = (firestoreWrites.get(key) as Record<string, unknown>) ?? {};
        firestoreWrites.set(key, { ...existing, ...partial });
      }),
    })),
  })),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Test data
// ═══════════════════════════════════════════════════════════════════════════════

export const COIMBATORE_CENTER = { lat: 11.0168, lng: 76.9558 };
export const COIMBATORE_NEARBY = { lat: 11.02, lng: 76.96 };
export const COIMBATORE_DROP = { lat: 11.04, lng: 76.98 };

export const SAMPLE_ASSIGNMENT = {
  drop: { lat: 11.04, lng: 76.98 },
  pickup: { lat: 11.02, lng: 76.96 },
  rideId: "ride-e2e-sim-001",
  riderId: "rider-e2e-001",
};

export const SAMPLE_ASSIGNMENT_2 = {
  drop: { lat: 11.05, lng: 76.99 },
  pickup: { lat: 11.025, lng: 76.965 },
  rideId: "ride-e2e-sim-002",
  riderId: "rider-e2e-002",
};

/**
 * Fire an RTDB listener callback to simulate a Firebase event.
 */
export function fireRtdbEvent(path: string, event: string, snapshot: unknown) {
  const key = `${path}:${event}`;
  const listeners = rtdbListeners.get(key) ?? [];
  for (const cb of listeners) {
    cb(snapshot);
  }
}

/**
 * Reset all mocks and in-memory stores.
 */
export function resetSimMocks() {
  rtdbWrites.clear();
  rtdbListeners.clear();
  firestoreWrites.clear();
  vi.clearAllMocks();
}
