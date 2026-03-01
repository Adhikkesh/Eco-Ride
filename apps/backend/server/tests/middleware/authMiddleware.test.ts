/**
 * Unit Tests for Auth Middleware
 *
 * Tests the verifyToken middleware which validates Firebase ID tokens
 * from the Authorization header and attaches decoded user data to requests.
 *
 * Uses vitest mocking to mock Firebase Auth's verifyIdToken.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Firebase Auth
const mockVerifyIdToken = vi.fn();

vi.mock("../../src/config/firebase.js", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: {},
  rtdb: {},
}));

import { verifyToken } from "../../src/middleware/authMiddleware.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function createMockRes(): Partial<Response> & { _status: number; _json: unknown } {
  const res: Partial<Response> & { _status: number; _json: unknown } = {
    _json: null,
    _status: 0,
    json: vi.fn().mockImplementation(function (this: typeof res, data) {
      res._json = data;
      return res as Response;
    }),
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      res._status = code;
      return res as Response;
    }),
  };
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("verifyToken middleware", () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when no Authorization header is present", async () => {
    const req = createMockReq() as Request;
    const res = createMockRes() as unknown as Response;

    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Unauthorized") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when Authorization header doesn't start with Bearer", async () => {
    const req = createMockReq("Basic some-token") as Request;
    const res = createMockRes() as unknown as Response;

    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when Bearer token is empty", async () => {
    const req = createMockReq("Bearer ") as Request;
    const res = createMockRes() as unknown as Response;

    // "Bearer ".split(" ")[1] = "" → falsy
    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next() and attach user when token is valid", async () => {
    const decoded = { email: "test@example.com", uid: "user-123" };
    mockVerifyIdToken.mockResolvedValue(decoded);

    const req = createMockReq("Bearer valid-token") as Request;
    const res = createMockRes() as unknown as Response;

    await verifyToken(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith("valid-token");
    expect(req.user).toEqual(decoded);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 401 when Firebase rejects the token", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Invalid token"));

    const req = createMockReq("Bearer invalid-token") as Request;
    const res = createMockRes() as unknown as Response;

    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Invalid token") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when token is expired", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Token expired"));

    const req = createMockReq("Bearer expired-token") as Request;
    const res = createMockRes() as unknown as Response;

    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
