/**
 * Unit Tests for Auth Controller
 *
 * TESTING APPROACH:
 * Unlike other test files, this one IMPORTS and tests the actual controller.
 * We mock Express request/response objects to test the controller behavior.
 *
 * WHY THIS WORKS WITHOUT DATABASE:
 * The VerifyTokenController only checks `req.user` which is set by middleware.
 * It doesn't make any database calls itself - it just returns user info.
 *
 * WHAT IS TESTED:
 * - Returns 401 when no user is attached (token invalid/missing)
 * - Returns 200 with user info when token is valid
 * - User information extraction (email, name, picture, emailVerified)
 *
 * WHAT IS NOT TESTED:
 * - Firebase token verification (handled by middleware)
 * - Actual authentication flow with Firebase Auth
 *
 * @author Team Member 2 - User & Auth Module
 * @date 2026-02-03
 */

import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Response data interface for auth controller
 */
interface AuthResponseData {
  valid?: boolean;
  message?: string;
  user?: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
    emailVerified?: boolean;
  };
}

/**
 * Mock response helper
 */
interface MockResponse extends Partial<Response> {
  _getData: () => AuthResponseData;
  _getStatusCode: () => number;
}

/**
 * Creates a mock Express response object.
 * Supports chainable methods like .status().json().
 * Includes helper methods _getData() and _getStatusCode() for assertions.
 */
const createMockResponse = (): MockResponse => {
  let statusCode = 200;
  let data: AuthResponseData = {};

  const res: MockResponse = {
    _getData: () => data,
    _getStatusCode: () => statusCode,
    json: vi.fn((responseData: AuthResponseData) => {
      data = responseData;
      return res;
    }) as MockResponse["json"],
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }) as MockResponse["status"],
  };

  return res;
};

/**
 * Mock request helper
 */
/**
 * Creates a mock Express request object.
 * @param overrides - Optional properties to override default request shape
 */
const createMockRequest = (overrides: Record<string, unknown> = {}): Partial<Request> => ({
  body: {},
  headers: {},
  params: {},
  query: {},
  // @ts-expect-error - 'user' is often added by middleware
  user: undefined,
  ...overrides,
});

/**
 * Create mock Firebase user
 */
const createMockUser = (overrides: Record<string, unknown> = {}) => ({
  email: "test@ecoride.com",
  email_verified: true,
  name: "Test User",
  picture: "https://example.com/photo.jpg",
  uid: "test-user-uid-123",
  ...overrides,
});

import { VerifyTokenController } from "../../src/controllers/authController";

describe("Auth Controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("VerifyTokenController", () => {
    describe("Token Validation", () => {
      it("should return 401 when no user is attached to request", async () => {
        // Arrange
        const req = createMockRequest({
          user: undefined,
        });
        const res = createMockResponse();
        const next = vi.fn();

        // Act
        await VerifyTokenController(req as Request, res as Response, next);

        // Assert
        expect(res._getStatusCode()).toBe(401);
        expect(res._getData().valid).toBe(false);
        expect(res._getData().message).toBe("No valid token provided");
      });

      it("should return 200 with user info when token is valid", async () => {
        // Arrange
        const mockUser = createMockUser();
        const req = createMockRequest({
          user: mockUser,
        });
        const res = createMockResponse();
        const next = vi.fn();

        // Act
        await VerifyTokenController(req as Request, res as Response, next);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        expect(res._getData().valid).toBe(true);
        expect(res._getData().user.uid).toBe("test-user-uid-123");
        expect(res._getData().user.email).toBe("test@ecoride.com");
      });
    });

    describe("User Information", () => {
      it("should return user email verification status", async () => {
        // Arrange
        const mockUser = createMockUser({ email_verified: true });
        const req = createMockRequest({ user: mockUser });
        const res = createMockResponse();
        const next = vi.fn();

        // Act
        await VerifyTokenController(req as Request, res as Response, next);

        // Assert
        expect(res._getData().user.emailVerified).toBe(true);
      });

      it("should return user name when available", async () => {
        // Arrange
        const mockUser = createMockUser({ name: "John Doe" });
        const req = createMockRequest({ user: mockUser });
        const res = createMockResponse();
        const next = vi.fn();

        // Act
        await VerifyTokenController(req as Request, res as Response, next);

        // Assert
        expect(res._getData().user.name).toBe("John Doe");
      });

      it("should return user picture when available", async () => {
        // Arrange
        const mockUser = createMockUser({
          picture: "https://lh3.googleusercontent.com/photo.jpg",
        });
        const req = createMockRequest({ user: mockUser });
        const res = createMockResponse();
        const next = vi.fn();

        // Act
        await VerifyTokenController(req as Request, res as Response, next);

        // Assert
        expect(res._getData().user.picture).toBe("https://lh3.googleusercontent.com/photo.jpg");
      });
    });

    describe("Edge Cases", () => {
      it("should handle partial user object gracefully", async () => {
        // Arrange
        const mockUser = { uid: "partial-user" }; // Missing email, name, etc.
        const req = createMockRequest({ user: mockUser });
        const res = createMockResponse();
        const next = vi.fn();

        // Act
        await VerifyTokenController(req as Request, res as Response, next);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        expect(res._getData().valid).toBe(true);
        expect(res._getData().user.uid).toBe("partial-user");
        expect(res._getData().user.email).toBeUndefined();
      });
    });
  });
});
