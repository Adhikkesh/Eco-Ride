/**
 * Unit Tests for Saved Locations Controller - Validation Logic
 *
 * This file contains unit tests for saved locations validation.
 * Tests cover type validation, location format validation, and authentication.
 *
 * @author Team Member 5 - Saved Locations Module
 * @date 2026-02-03
 */

import { describe, expect, it } from "vitest";

/**
 * Validation functions for saved locations
 */

// Validate authentication
const validateAuth = (user: any) => {
  if (!user) {
    return { message: "Unauthorized", valid: false };
  }
  return { valid: true };
};

// Validate location type
const validateLocationType = (type: string) => {
  const validTypes = ["home", "work", "favourite"];
  if (!type || !validTypes.includes(type)) {
    return {
      message: "Invalid location type. Must be 'home', 'work', or 'favourite'",
      valid: false,
    };
  }
  return { valid: true };
};

// Validate location structure
const validateLocationFormat = (location: any) => {
  if (location === null) {
    return { valid: true }; // null is valid (for deleting)
  }

  if (
    typeof location.lat !== "number" ||
    typeof location.lng !== "number" ||
    typeof location.name !== "string"
  ) {
    return {
      message: "Invalid location format. Required: { lat: number, lng: number, name: string }",
      valid: false,
    };
  }

  return { valid: true };
};

// Get default saved locations object
const getDefaultSavedLocations = () => ({
  favourite: null,
  home: null,
  work: null,
});

// Format update path for Firestore
const formatUpdatePath = (type: string) => {
  return `saved_locations.${type}`;
};

// Format success message
const formatSuccessMessage = (type: string) => {
  const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
  return `${capitalizedType} location updated successfully`;
};

describe("Saved Locations Controller - Validation Logic", () => {
  describe("validateAuth", () => {
    it("should return invalid when user is undefined", () => {
      const result = validateAuth(undefined);
      expect(result.valid).toBe(false);
      expect(result.message).toBe("Unauthorized");
    });

    it("should return invalid when user is null", () => {
      const result = validateAuth(null);
      expect(result.valid).toBe(false);
    });

    it("should return valid when user exists", () => {
      const result = validateAuth({ uid: "test-123" });
      expect(result.valid).toBe(true);
    });
  });

  describe("validateLocationType", () => {
    it('should accept "home" as valid type', () => {
      const result = validateLocationType("home");
      expect(result.valid).toBe(true);
    });

    it('should accept "work" as valid type', () => {
      const result = validateLocationType("work");
      expect(result.valid).toBe(true);
    });

    it('should accept "favourite" as valid type', () => {
      const result = validateLocationType("favourite");
      expect(result.valid).toBe(true);
    });

    it("should reject invalid type", () => {
      const result = validateLocationType("invalid");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("Invalid location type");
    });

    it("should reject empty type", () => {
      const result = validateLocationType("");
      expect(result.valid).toBe(false);
    });

    it("should reject undefined type", () => {
      const result = validateLocationType(undefined as any);
      expect(result.valid).toBe(false);
    });

    it("should reject types with different casing", () => {
      const result = validateLocationType("Home");
      expect(result.valid).toBe(false);
    });
  });

  describe("validateLocationFormat", () => {
    it("should accept valid location object", () => {
      const location = { lat: 12.9716, lng: 77.5946, name: "Home" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(true);
    });

    it("should accept null location (for deletion)", () => {
      const result = validateLocationFormat(null);
      expect(result.valid).toBe(true);
    });

    it("should reject location with non-numeric lat", () => {
      const location = { lat: "invalid", lng: 77.5946, name: "Home" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(false);
      expect(result.message).toContain("Invalid location format");
    });

    it("should reject location with non-numeric lng", () => {
      const location = { lat: 12.9716, lng: "invalid", name: "Home" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(false);
    });

    it("should reject location with non-string name", () => {
      const location = { lat: 12.9716, lng: 77.5946, name: 123 };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(false);
    });

    it("should reject location missing lat", () => {
      const location = { lng: 77.5946, name: "Home" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(false);
    });

    it("should reject location missing lng", () => {
      const location = { lat: 12.9716, name: "Home" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(false);
    });

    it("should reject location missing name", () => {
      const location = { lat: 12.9716, lng: 77.5946 };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(false);
    });

    it("should accept location with 0 coordinates", () => {
      const location = { lat: 0, lng: 0, name: "Null Island" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(true);
    });

    it("should accept location with negative coordinates", () => {
      const location = { lat: -33.8688, lng: 151.2093, name: "Sydney" };
      const result = validateLocationFormat(location);
      expect(result.valid).toBe(true);
    });
  });

  describe("getDefaultSavedLocations", () => {
    it("should return object with home, work, and favourite as null", () => {
      const defaults = getDefaultSavedLocations();
      expect(defaults.home).toBeNull();
      expect(defaults.work).toBeNull();
      expect(defaults.favourite).toBeNull();
    });

    it("should have exactly 3 properties", () => {
      const defaults = getDefaultSavedLocations();
      expect(Object.keys(defaults).length).toBe(3);
    });
  });

  describe("formatUpdatePath", () => {
    it("should format home update path correctly", () => {
      expect(formatUpdatePath("home")).toBe("saved_locations.home");
    });

    it("should format work update path correctly", () => {
      expect(formatUpdatePath("work")).toBe("saved_locations.work");
    });

    it("should format favourite update path correctly", () => {
      expect(formatUpdatePath("favourite")).toBe("saved_locations.favourite");
    });
  });

  describe("formatSuccessMessage", () => {
    it("should format home success message correctly", () => {
      expect(formatSuccessMessage("home")).toBe("Home location updated successfully");
    });

    it("should format work success message correctly", () => {
      expect(formatSuccessMessage("work")).toBe("Work location updated successfully");
    });

    it("should format favourite success message correctly", () => {
      expect(formatSuccessMessage("favourite")).toBe("Favourite location updated successfully");
    });
  });

  describe("Complete Validation Flow", () => {
    it("should validate complete update request", () => {
      // User authentication
      const authResult = validateAuth({ uid: "user-123" });
      expect(authResult.valid).toBe(true);

      // Location type
      const typeResult = validateLocationType("home");
      expect(typeResult.valid).toBe(true);

      // Location format
      const location = { lat: 12.9716, lng: 77.5946, name: "My Home" };
      const formatResult = validateLocationFormat(location);
      expect(formatResult.valid).toBe(true);

      // Update path
      const updatePath = formatUpdatePath("home");
      expect(updatePath).toBe("saved_locations.home");
    });

    it("should handle delete operation (null location)", () => {
      const authResult = validateAuth({ uid: "user-123" });
      const typeResult = validateLocationType("work");
      const formatResult = validateLocationFormat(null);

      expect(authResult.valid).toBe(true);
      expect(typeResult.valid).toBe(true);
      expect(formatResult.valid).toBe(true);
    });
  });
});
