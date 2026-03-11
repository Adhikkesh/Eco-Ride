/**
 * E2E Test Fixtures for Eco-Ride Web App
 *
 * Extends Playwright with custom fixtures for:
 * - Mocking Firebase auth via page.addInitScript
 * - Mocking backend API responses via page.route
 */

import { test as base, type Page } from "@playwright/test";

/** Test user data consistent with backend mock helpers. */
export const TEST_USER = {
  displayName: "Test User",
  email: "test@ecoride.com",
  photoURL: "https://example.com/photo.jpg",
  uid: "test-user-uid-123",
};

export const TEST_DRIVER = {
  displayName: "Test Driver",
  email: "driver@ecoride.com",
  photoURL: "https://example.com/driver.jpg",
  uid: "test-driver-uid-456",
};

export const ADMIN_UID = "dq8zZsXXsldH9yVcrB4B7qbHzgB2";

export const SAMPLE_PICKUP = { lat: 12.9716, lng: 77.5946 };
export const SAMPLE_DROP = { lat: 13.0827, lng: 80.2707 };

/**
 * Mock all backend API calls so tests run without a live server.
 */
export async function mockBackendAPI(page: Page, role: "rider" | "driver" = "rider") {
  // Health check
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { status: "ok" }, status: 200 }),
  );

  // Auth verify – returns the user matching the role
  await page.route("**/api/v1/auth/verify", (route) =>
    route.fulfill({
      json: {
        user: {
          email: role === "driver" ? TEST_DRIVER.email : TEST_USER.email,
          name: role === "driver" ? TEST_DRIVER.displayName : TEST_USER.displayName,
          role,
          uid: role === "driver" ? TEST_DRIVER.uid : TEST_USER.uid,
        },
      },
      status: 200,
    }),
  );

  // User create
  await page.route("**/api/v1/user/create", (route) =>
    route.fulfill({ json: { success: true }, status: 200 }),
  );

  // Driver status
  await page.route("**/api/v1/user/driver-status", (route) =>
    route.fulfill({ json: { kyc_verified: true }, status: 200 }),
  );

  // Ride request
  await page.route("**/api/v1/ride/request", (route) =>
    route.fulfill({
      json: { driverId: "driver-1", rideId: "ride-001", success: true },
      status: 200,
    }),
  );

  // Fare calculate
  await page.route("**/api/v1/fare/calculate", (route) =>
    route.fulfill({
      json: { distance: 15.2, duration: 25, fare: 250, success: true },
      status: 200,
    }),
  );

  // Payment
  await page.route("**/api/v1/payment/create-intent", (route) =>
    route.fulfill({
      json: { clientSecret: "pi_mock_secret", paymentIntentId: "pi_mock_id" },
      status: 200,
    }),
  );

  // Rating
  await page.route("**/api/v1/rating/submit", (route) =>
    route.fulfill({ json: { success: true }, status: 200 }),
  );

  // Saved locations
  await page.route("**/api/v1/saved-locations", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { favAddress: "", homeAddress: "", workAddress: "" },
        status: 200,
      });
    }
    return route.fulfill({ json: { success: true }, status: 200 });
  });

  // Admin endpoints
  await page.route("**/api/v1/admin/unverified-drivers", (route) =>
    route.fulfill({
      json: {
        drivers: [
          {
            email: "pending@ecoride.com",
            kyc_url: "https://example.com/kyc.pdf",
            license_url: "https://example.com/license.pdf",
            name: "Pending Driver",
            phone_number: "9876543210",
            uid: "unverified-driver-1",
            vehicle: {
              is_ev: true,
              model: "Tesla Model 3",
              plate_number: "KA01AB1234",
              pollution_expiry: "2027-01-01",
            },
          },
        ],
      },
      status: 200,
    }),
  );

  await page.route("**/api/v1/admin/verify-driver", (route) =>
    route.fulfill({ json: { success: true }, status: 200 }),
  );

  // Prediction endpoints
  await page.route("**/api/v1/prediction/**", (route) =>
    route.fulfill({
      json: {
        forecast: Array.from({ length: 24 }, (_, i) => ({
          demand: Math.random() * 100,
          hour: i,
          surge: 1 + Math.random() * 0.5,
        })),
        success: true,
      },
      status: 200,
    }),
  );

  // Pooling
  await page.route("**/api/v1/pooling/**", (route) =>
    route.fulfill({ json: { success: true }, status: 200 }),
  );
}

/**
 * Inject a mock Firebase auth user into the page.
 * This overrides the Firebase SDK so the app thinks a user is logged in.
 */
export async function injectMockAuth(
  page: Page,
  user: { uid: string; email: string; displayName: string; photoURL: string } = TEST_USER,
) {
  await page.addInitScript((u) => {
    // Store mock user for Firebase auth override
    (window as any).__MOCK_USER__ = {
      displayName: u.displayName,
      email: u.email,
      emailVerified: true,
      getIdToken: () => Promise.resolve("mock-firebase-token"),
      getIdTokenResult: () => Promise.resolve({ claims: {}, token: "mock-firebase-token" }),
      photoURL: u.photoURL,
      uid: u.uid,
    };
  }, user);
}

/** Extended test fixture with mock helpers available. */
export const test = base.extend<{
  mockAPI: (role?: "rider" | "driver") => Promise<void>;
}>({
  mockAPI: async ({ page }, use) => {
    const setup = async (role: "rider" | "driver" = "rider") => {
      await mockBackendAPI(page, role);
    };
    await use(setup);
  },
});

export { expect } from "@playwright/test";
