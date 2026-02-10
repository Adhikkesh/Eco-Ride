/**
 * Integration Test Setup
 *
 * Mocks all external dependencies (Firebase, Stripe) at the module level
 * so that SuperTest can exercise the full Express HTTP stack without
 * requiring live credentials or network access.
 */

import { vi } from "vitest";

// ────────────────────────────────────────────────────────────────
// 1. Firebase Admin SDK mocks
// ────────────────────────────────────────────────────────────────

// Mock Firestore helpers – returned by every db.collection().doc().get() etc.
const mockFirestoreDocData: Record<string, unknown> = {};
const mockFirestoreDocExists = true;

const mockDocRef = {
  get: vi.fn(async () => ({
    data: () => mockFirestoreDocData,
    exists: mockFirestoreDocExists,
    id: "mock-doc-id",
  })),
  set: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
};

const mockQuerySnapshot = {
  docs: [] as Array<{ data: () => Record<string, unknown>; id: string }>,
  empty: true,
};

const mockCollectionRef = {
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

const mockDb = {
  batch: vi.fn(() => ({
    commit: vi.fn(async () => {}),
    set: vi.fn(),
  })),
  collection: vi.fn(() => mockCollectionRef),
};

// Mock RTDB helpers
const mockRtdbRefData: Record<string, unknown> | null = {};
const mockRtdbRef = {
  once: vi.fn(async () => ({
    val: () => mockRtdbRefData,
  })),
  remove: vi.fn(async () => {}),
  set: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
};

const mockRtdb = {
  ref: vi.fn(() => mockRtdbRef),
};

// Mock Firebase Auth
const mockAuth = {
  verifyIdToken: vi.fn(async () => ({
    email: "test@ecoride.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    uid: "test-user-uid-123",
  })),
};

// Apply Firebase mocks
vi.mock("../../src/config/firebase.js", () => ({
  auth: mockAuth,
  db: mockDb,
  rtdb: mockRtdb,
  storage: {},
}));

// ────────────────────────────────────────────────────────────────
// 2. Auth Middleware mock – bypass token verification
// ────────────────────────────────────────────────────────────────

const defaultMockUser = {
  email: "test@ecoride.com",
  email_verified: true,
  name: "Test User",
  picture: "https://example.com/photo.jpg",
  uid: "test-user-uid-123",
};

let currentMockUser: Record<string, unknown> | null = defaultMockUser;

vi.mock("../../src/middleware/authMiddleware.js", () => ({
  verifyToken: vi.fn((req: any, _res: any, next: any) => {
    req.user = currentMockUser;
    next();
  }),
}));

// ────────────────────────────────────────────────────────────────
// 3. Stripe mock
// ────────────────────────────────────────────────────────────────

vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      paymentIntents: {
        create: vi.fn(async () => ({
          client_secret: "pi_mock_secret",
          id: "pi_mock_id",
        })),
      },
    })),
  };
});

// ────────────────────────────────────────────────────────────────
// 4. Exported helpers for tests to customise mock behaviour
// ────────────────────────────────────────────────────────────────

export {
  currentMockUser,
  defaultMockUser,
  mockAuth,
  mockCollectionRef,
  mockDb,
  mockDocRef,
  mockFirestoreDocData,
  mockFirestoreDocExists,
  mockQuerySnapshot,
  mockRtdb,
  mockRtdbRef,
  mockRtdbRefData,
};

/**
 * Sets the mock user that will be injected by the verifyToken middleware.
 * Pass `null` to simulate an unauthenticated request.
 */
export function setMockUser(user: Record<string, unknown> | null) {
  currentMockUser = user;
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
  // biome-ignore lint/suspicious/noExplicitAny: RTDB val() can legitimately return null
  mockRtdbRef.once.mockResolvedValue({
    val: () => data as any,
  });
}

/**
 * Resets all mocks to their default state.
 */
export function resetAllMocks() {
  setMockUser(defaultMockUser);
  setMockDoc(true, {});
  setMockQuerySnapshot([]);
  setMockRtdbData({});
  vi.clearAllMocks();
}
