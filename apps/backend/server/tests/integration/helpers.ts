/**
 * Integration Test Helpers
 *
 * Shared test data fixtures and SuperTest agent factory.
 */

import supertest from "supertest";
import { app } from "../../src/app.js";

/** SuperTest agent bound to the Express app (no live server needed). */
export const request = supertest(app);

/** Authorization header value used for authenticated requests. */
export const AUTH_HEADER = "Bearer mock-firebase-token";

/** Mock Firebase-decoded user – matches what verifyToken injects. */
export const MOCK_USER = {
  email: "test@ecoride.com",
  email_verified: true,
  name: "Test User",
  picture: "https://example.com/photo.jpg",
  uid: "test-user-uid-123",
};

/** Admin user UID (must match ADMIN_UID in adminController). */
export const ADMIN_UID = "dq8zZsXXsldH9yVcrB4B7qbHzgB2";

/** Sample coordinates for ride tests. */
export const SAMPLE_PICKUP = { lat: 12.9716, lng: 77.5946 }; // Bangalore
export const SAMPLE_DROP = { lat: 13.0827, lng: 80.2707 }; // Chennai
