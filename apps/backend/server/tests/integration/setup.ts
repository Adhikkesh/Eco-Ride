/**
 * Integration Test – Mock Objects & Helpers
 *
 * Provides mock objects for Firebase (Firestore, RTDB, Auth) and Stripe,
 * as well as helper functions to configure mock behavior in tests.
 *
 * NOTE: vi.mock() calls must be in each test file (Vitest only hoists
 * vi.mock in the file it appears in). Test files should call
 * `applyMocks()` pattern or put vi.mock at the top.
 */

import { vi } from "vitest";

// ────────────────────────────────────────────────────────────────
// Mock Firestore
// ────────────────────────────────────────────────────────────────

export const mockDocRef = {
  get: vi.fn(async () => ({
    data: () => ({}),
    exists: true,
    id: "mock-doc-id",
  })),
  set: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
};

export const mockQuerySnapshot = {
  docs: [] as Array<{ data: () => Record<string, unknown>; id: string }>,
  empty: true,
};

export const mockCollectionRef = {
  add: vi.fn(async () => ({ id: "mock-new-doc-id" })),
  doc: vi.fn(() => mockDocRef),
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

export const mockDb = {
  batch: vi.fn(() => ({
    commit: vi.fn(async () => {}),
    set: vi.fn(),
  })),
  collection: vi.fn(() => mockCollectionRef),
};

// ────────────────────────────────────────────────────────────────
// Mock RTDB
// ────────────────────────────────────────────────────────────────

export const mockRtdbRef = {
  once: vi.fn(async () => ({
    val: () => ({}),
  })),
  remove: vi.fn(async () => {}),
  set: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
};

export const mockRtdb = {
  ref: vi.fn(() => mockRtdbRef),
};

// ────────────────────────────────────────────────────────────────
// Mock Firebase Auth
// ────────────────────────────────────────────────────────────────

export const mockAuth = {
  verifyIdToken: vi.fn(async () => ({
    email: "test@ecoride.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    uid: "test-user-uid-123",
  })),
};

// ────────────────────────────────────────────────────────────────
// Default user data
// ────────────────────────────────────────────────────────────────

export const defaultMockUser = {
  email: "test@ecoride.com",
  email_verified: true,
  name: "Test User",
  picture: "https://example.com/photo.jpg",
  uid: "test-user-uid-123",
};

// ────────────────────────────────────────────────────────────────
// Helper functions
// ────────────────────────────────────────────────────────────────

/**
 * Changes the identity returned by auth.verifyIdToken().
 * Pass `null` to simulate an unauthenticated request (middleware returns 401).
 */
export function setMockUser(user: Record<string, unknown> | null) {
  if (user === null) {
    mockAuth.verifyIdToken.mockRejectedValue(new Error("Mock: no token"));
  } else {
    mockAuth.verifyIdToken.mockResolvedValue(user as any);
  }
}

/**
 * Configures what mockDocRef.get() will return.
 */
export function setMockDoc(exists: boolean, data: Record<string, unknown> = {}) {
  mockDocRef.get.mockResolvedValue({
    data: () => data,
    exists,
    id: "mock-doc-id",
  });
}

/**
 * Configures what the Firestore query snapshot returns.
 */
export function setMockQuerySnapshot(docs: Array<{ data: Record<string, unknown>; id: string }>) {
  mockQuerySnapshot.docs = docs.map((d) => ({
    data: () => d.data,
    id: d.id,
  }));
  mockQuerySnapshot.empty = docs.length === 0;
}

/**
 * Configures what RTDB ref.once("value") returns.
 */
export function setMockRtdbData(data: Record<string, unknown> | null) {
  mockRtdbRef.once.mockResolvedValue({
    val: () => data,
  });
}

/**
 * Resets all mocks to their default state.
 */
export function resetAllMocks() {
  mockAuth.verifyIdToken.mockResolvedValue({
    email: "test@ecoride.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    uid: "test-user-uid-123",
  } as any);
  setMockDoc(true, {});
  setMockQuerySnapshot([]);
  setMockRtdbData({});
  vi.clearAllMocks();
  // Re-apply default auth after clearAllMocks wipes mockResolvedValue
  mockAuth.verifyIdToken.mockResolvedValue({
    email: "test@ecoride.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    uid: "test-user-uid-123",
  } as any);
}
