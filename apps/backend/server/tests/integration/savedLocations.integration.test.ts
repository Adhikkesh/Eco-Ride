/**
 * Integration Tests – Saved Locations Endpoints
 *
 * Tests GET and PUT for user saved locations (home, work, favourite)
 * through the full Express HTTP stack using SuperTest.
 */

import { afterEach, describe, expect, it } from "vitest";
import { AUTH_HEADER, request } from "./helpers.js";
import { mockDocRef, resetAllMocks, setMockDoc, setMockUser } from "./setup.js";

describe("Saved Locations Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  // ── GET /api/v1/user/saved-locations ───────────────────────
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
      expect(res.body.savedLocations).toBeDefined();
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
      expect(res.body.savedLocations.work).toBeNull();
      expect(res.body.savedLocations.favourite).toBeNull();
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

  // ── PUT /api/v1/user/saved-locations ───────────────────────
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
      expect(res.body.message).toContain("Home location updated");
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
      expect(res.body.message).toContain("Invalid location type");
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
      expect(res.body.message).toContain("Invalid location format");
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
