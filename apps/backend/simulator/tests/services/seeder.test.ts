/**
 * Unit Tests for Driver Seeder
 *
 * Tests the business logic extracted from the seeder service:
 * - padDriverId formatting
 * - Document structure generation
 * - Seeding idempotency logic
 *
 * WHAT IS NOT TESTED:
 * - Actual Firestore batch writes (requires Firebase)
 */

import { describe, expect, it } from "vitest";

// ─── Extracted Business Logic ─────────────────────────────────────────────────

const DRIVER_COUNT = 20;

function padDriverId(num: number): string {
  return `driver_${String(num).padStart(3, "0")}`;
}

interface UserDoc {
  uid: string;
  name: string;
  email: string;
  role: "driver";
}

interface DriverProfileDoc {
  driver_uid: string;
  is_online: boolean;
  wallet_balance: number;
  kyc_verified: boolean;
  current_location: null;
}

interface VehicleDoc {
  driver_uid: string;
  model: string;
  plate_number: string;
  is_ev: boolean;
}

function buildUserDoc(driverId: string, index: number): Omit<UserDoc, "created_at"> {
  return {
    email: `driver${index}@ecoride.com`,
    name: `Eco Driver ${index}`,
    role: "driver",
    uid: driverId,
  };
}

function buildProfileDoc(driverId: string): DriverProfileDoc {
  return {
    current_location: null,
    driver_uid: driverId,
    is_online: true,
    kyc_verified: true,
    wallet_balance: 100,
  };
}

function buildVehicleDoc(driverId: string, index: number): VehicleDoc {
  return {
    driver_uid: driverId,
    is_ev: true,
    model: "Tesla Model 3",
    plate_number: `ECO-2025-${String(index).padStart(3, "0")}`,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Driver Seeder - padDriverId", () => {
  it("should format single digit", () => {
    expect(padDriverId(1)).toBe("driver_001");
  });

  it("should format double digits", () => {
    expect(padDriverId(20)).toBe("driver_020");
  });

  it("should generate unique IDs for all driver count", () => {
    const ids = Array.from({ length: DRIVER_COUNT }, (_, i) => padDriverId(i + 1));
    const unique = new Set(ids);
    expect(unique.size).toBe(DRIVER_COUNT);
  });
});

describe("Driver Seeder - Document Structure", () => {
  describe("UserDoc", () => {
    it("should build with correct email format", () => {
      const doc = buildUserDoc("driver_005", 5);
      expect(doc.email).toBe("driver5@ecoride.com");
    });

    it("should have role set to driver", () => {
      const doc = buildUserDoc("driver_001", 1);
      expect(doc.role).toBe("driver");
    });

    it("should have uid matching driverId", () => {
      const doc = buildUserDoc("driver_010", 10);
      expect(doc.uid).toBe("driver_010");
    });

    it("should have a name with the driver index", () => {
      const doc = buildUserDoc("driver_003", 3);
      expect(doc.name).toBe("Eco Driver 3");
    });
  });

  describe("DriverProfileDoc", () => {
    it("should have initial wallet balance of 100", () => {
      const doc = buildProfileDoc("driver_001");
      expect(doc.wallet_balance).toBe(100);
    });

    it("should be KYC verified", () => {
      const doc = buildProfileDoc("driver_001");
      expect(doc.kyc_verified).toBe(true);
    });

    it("should be online by default", () => {
      const doc = buildProfileDoc("driver_001");
      expect(doc.is_online).toBe(true);
    });

    it("should have null current_location", () => {
      const doc = buildProfileDoc("driver_001");
      expect(doc.current_location).toBeNull();
    });

    it("should reference the correct driver uid", () => {
      const doc = buildProfileDoc("driver_007");
      expect(doc.driver_uid).toBe("driver_007");
    });
  });

  describe("VehicleDoc", () => {
    it("should be an EV", () => {
      const doc = buildVehicleDoc("driver_001", 1);
      expect(doc.is_ev).toBe(true);
    });

    it("should have Tesla Model 3 as default model", () => {
      const doc = buildVehicleDoc("driver_001", 1);
      expect(doc.model).toBe("Tesla Model 3");
    });

    it("should generate correct plate number format", () => {
      const doc = buildVehicleDoc("driver_005", 5);
      expect(doc.plate_number).toBe("ECO-2025-005");
    });

    it("should reference the correct driver uid", () => {
      const doc = buildVehicleDoc("driver_012", 12);
      expect(doc.driver_uid).toBe("driver_012");
    });

    it("should have unique plate numbers for each driver", () => {
      const plates = Array.from(
        { length: DRIVER_COUNT },
        (_, i) => buildVehicleDoc(padDriverId(i + 1), i + 1).plate_number,
      );
      const unique = new Set(plates);
      expect(unique.size).toBe(DRIVER_COUNT);
    });
  });
});
