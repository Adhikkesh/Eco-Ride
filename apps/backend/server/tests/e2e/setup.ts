/**
 * E2E Test Setup for Server
 *
 * Provides mock Firebase & Stripe configuration shared across all
 * E2E test files. E2E tests exercise entire request flows spanning
 * multiple endpoints (e.g. full ride lifecycle).
 */

import { vi } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Firestore
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory data store to simulate Firestore across E2E flows.
 * Keys are "collection/docId" strings mapping to document data.
 */
export const firestoreStore = new Map<string, Record<string, unknown>>();

export const mockDocRef = (collection: string, docId: string) => ({
  get: vi.fn(async () => {
    const key = `${collection}/${docId}`;
    const data = firestoreStore.get(key);
    return {
      data: () => data ?? {},
      exists: firestoreStore.has(key),
      id: docId,
    };
  }),
  set: vi.fn(async (data: Record<string, unknown>) => {
    firestoreStore.set(`${collection}/${docId}`, data);
  }),
  update: vi.fn(async (partial: Record<string, unknown>) => {
    const key = `${collection}/${docId}`;
    const existing = firestoreStore.get(key) ?? {};
    firestoreStore.set(key, { ...existing, ...partial });
  }),
});

export const mockQuerySnapshot = {
  docs: [] as Array<{ data: () => Record<string, unknown>; id: string }>,
  empty: true,
};

export const mockCollectionRef = {
  add: vi.fn(async (data: Record<string, unknown>) => {
    const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    firestoreStore.set(`_last/${id}`, data);
    return { id };
  }),
  doc: vi.fn((id = "mock-doc-id") => mockDocRef("_collection", id)),
  where: vi.fn(() => ({
    get: vi.fn(async () => mockQuerySnapshot),
    limit: vi.fn(() => ({
      get: vi.fn(async () => mockQuerySnapshot),
    })),
    where: vi.fn(() => ({
      get: vi.fn(async () => mockQuerySnapshot),
      limit: vi.fn(() => ({
        get: vi.fn(async () => mockQuerySnapshot),
      })),
    })),
  })),
};

export const mockTransaction = {
  get: vi.fn(async () => ({
    data: () => ({ rating: 4.0, rating_count: 5, rider_rating: 4.0, rider_rating_count: 3 }),
    exists: true,
  })),
  set: vi.fn(),
  update: vi.fn(),
};

export const mockDb = {
  batch: vi.fn(() => ({
    commit: vi.fn(async () => {}),
    set: vi.fn(),
  })),
  collection: vi.fn(() => mockCollectionRef),
  runTransaction: vi.fn(async (fn: (t: unknown) => Promise<void>) => {
    return fn(mockTransaction);
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Mock RTDB
// ═══════════════════════════════════════════════════════════════════════════════

export const rtdbStore = new Map<string, unknown>();

export const mockRtdbRef = {
  once: vi.fn(async () => ({
    val: () => ({}),
  })),
  remove: vi.fn(async () => {}),
  set: vi.fn(async (data: unknown) => {
    rtdbStore.set("_last", data);
  }),
  update: vi.fn(async (data: unknown) => {
    rtdbStore.set("_last_update", data);
  }),
};

export const mockRtdb = {
  ref: vi.fn(() => mockRtdbRef),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Firebase Auth
// ═══════════════════════════════════════════════════════════════════════════════

export const mockAuth = {
  verifyIdToken: vi.fn(async () => ({
    email: "e2e-rider@ecoride.com",
    email_verified: true,
    name: "E2E Rider",
    picture: "https://example.com/e2e-photo.jpg",
    uid: "e2e-rider-uid",
  })),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

export const AUTH_HEADER = "Bearer e2e-mock-token";

export const RIDER = {
  email: "e2e-rider@ecoride.com",
  email_verified: true,
  name: "E2E Rider",
  picture: "https://example.com/rider.jpg",
  uid: "e2e-rider-uid",
};

export const DRIVER = {
  email: "e2e-driver@ecoride.com",
  email_verified: true,
  name: "E2E Driver",
  picture: "https://example.com/driver.jpg",
  uid: "e2e-driver-uid",
};

export const ADMIN = {
  email: "admin@gmail.com",
  email_verified: true,
  name: "Admin",
  picture: "https://example.com/admin.jpg",
  uid: "dq8zZsXXsldH9yVcrB4B7qbHzgB2",
};

export const BANGALORE_PICKUP = { lat: 12.9716, lng: 77.5946 };
export const BANGALORE_DROP = { lat: 12.9352, lng: 77.6245 }; // ~5 km away
export const CHENNAI_DROP = { lat: 13.0827, lng: 80.2707 };

/**
 * Switch the authenticated user identity.
 */
export function setAuthUser(user: typeof RIDER | typeof DRIVER | typeof ADMIN) {
  mockAuth.verifyIdToken.mockResolvedValue(user as any);
}

/**
 * Set what the RTDB returns for a specific ref.
 */
export function setRtdbData(data: Record<string, unknown> | null) {
  mockRtdbRef.once.mockResolvedValue({
    val: () => data,
  });
}

/**
 * Set what a Firestore doc.get() returns.
 */
export function setDocData(exists: boolean, data: Record<string, unknown> = {}) {
  mockCollectionRef.doc.mockReturnValue({
    get: vi.fn(async () => ({
      data: () => data,
      exists,
      id: "mock-doc-id",
    })),
    set: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  });
}

/**
 * Set what a Firestore query returns.
 */
export function setQueryDocs(docs: Array<{ data: Record<string, unknown>; id: string }>) {
  mockQuerySnapshot.docs = docs.map((d) => ({
    data: () => d.data,
    id: d.id,
  }));
  mockQuerySnapshot.empty = docs.length === 0;
}

/**
 * Reset all mocks and in-memory stores.
 */
export function resetE2EMocks() {
  firestoreStore.clear();
  rtdbStore.clear();
  vi.clearAllMocks();

  // Restore default auth identity
  mockAuth.verifyIdToken.mockResolvedValue(RIDER as any);

  // Restore default RTDB response
  mockRtdbRef.once.mockResolvedValue({ val: () => ({}) });

  // Restore default query snapshot
  mockQuerySnapshot.docs = [];
  mockQuerySnapshot.empty = true;
}
