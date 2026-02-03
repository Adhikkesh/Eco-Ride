/**
 * Unit Tests for Auth Controller
 *
 * This file contains unit tests for authentication functionality.
 * Tests cover token verification and user session handling.
 *
 * @author Team Member 2 - User & Auth Module
 * @date 2026-02-03
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mock response helper
 */
const createMockResponse = () => {
  let statusCode = 200;
  let data: any = null;

  const res: any = {
    _getData: () => data,
    _getStatusCode: () => statusCode,
    json: vi.fn((responseData: any) => {
      data = responseData;
      return res;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
  };

  return res;
};

/**
 * Mock request helper
 */
const createMockRequest = (overrides: any = {}) => ({
  body: {},
  headers: {},
  params: {},
  query: {},
  user: undefined,
  ...overrides,
});

/**
 * Create mock Firebase user
 */
const createMockUser = (overrides: any = {}) => ({
  email: "test@ecoride.com",
  email_verified: true,
  name: "Test User",
  picture: "https://example.com/photo.jpg",
  uid: "test-user-uid-123",
  ...overrides,
});

describe("Auth Controller", () => {
  let VerifyTokenController: any;

  beforeEach(async () => {
    vi.resetModules();

    // Import the module
    const authModule = await import("../../src/controllers/authController.js");
    VerifyTokenController = authModule.VerifyTokenController;
  });

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
        await VerifyTokenController(req as any, res as any, next);

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
        await VerifyTokenController(req as any, res as any, next);

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
        await VerifyTokenController(req as any, res as any, next);

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
        await VerifyTokenController(req as any, res as any, next);

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
        await VerifyTokenController(req as any, res as any, next);

        // Assert
        expect(res._getData().user.picture).toBe("https://lh3.googleusercontent.com/photo.jpg");
      });
    });
  });
});
