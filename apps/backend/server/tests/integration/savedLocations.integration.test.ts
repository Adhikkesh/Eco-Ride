/**
 * Integration Tests – Saved Locations Endpoints
 */

import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/firebase.js", async () => {
  const setup = await import("./setup.js");
  return {
    auth: setup.mockAuth,
    db: setup.mockDb,
    rtdb: setup.mockRtdb,
    storage: {},
  };
});

vi.mock("stripe", async () => {
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

import { AUTH_HEADER } from "./helpers.js";
import { resetAllMocks, setMockDoc, setMockUser } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Saved Locations Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("GET /api/v1/user/saved-locations", () => {
    it("should return saved locations for authenticated user", async () => {
      setMockDoc(true, {
        saved_locations: {
          favourite: null,
          home: { lat: 12.97, lng: 77.59, name: "Home" },
          work: { lat: 12.98, lng: 77.6, name: "Office" },
        },
      });
      const res = await request
        .get("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.savedLocations.home.name).toBe("Home");
    });

    it("should return default empty locations when none saved", async () => {
      setMockDoc(true, {}); // no saved_locations field
      const res = await request
        .get("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.savedLocations.home).toBeNull();
    });

    it("should return 404 when user does not exist", async () => {
      setMockDoc(false);
      const res = await request
        .get("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request
        .get("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/v1/user/saved-locations", () => {
    it("should update home location successfully", async () => {
      setMockDoc(true, {});
      const res = await request
        .put("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER)
        .send({
          location: { lat: 12.97, lng: 77.59, name: "My Home" },
          type: "home",
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 400 for invalid location type", async () => {
      const res = await request
        .put("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER)
        .send({
          location: { lat: 12.97, lng: 77.59, name: "Place" },
          type: "invalid_type",
        });
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid location format", async () => {
      const res = await request
        .put("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER)
        .send({
          location: { lat: "not-a-number", lng: 77.59, name: "Office" },
          type: "work",
        });
      expect(res.status).toBe(400);
    });

    it("should allow deleting a saved location by passing null", async () => {
      setMockDoc(true, {});
      const res = await request
        .put("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER)
        .send({
          location: null,
          type: "favourite",
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request
        .put("/api/v1/user/saved-locations")
        .set("Authorization", AUTH_HEADER)
        .send({
          location: { lat: 12.97, lng: 77.59, name: "Home" },
          type: "home",
        });
      expect(res.status).toBe(401);
    });
  });
});
