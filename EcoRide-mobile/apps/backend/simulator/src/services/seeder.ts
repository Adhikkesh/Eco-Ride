import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase.js";

const DRIVER_COUNT = 20;

interface UserDoc {
  uid: string;
  name: string;
  email: string;
  role: "driver";
  created_at: FieldValue;
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

function padDriverId(num: number): string {
  return `driver_${String(num).padStart(3, "0")}`;
}

export async function seedDrivers(): Promise<void> {
  console.log(`🌱 Checking/seeding ${DRIVER_COUNT} dummy drivers...`);

  for (let i = 1; i <= DRIVER_COUNT; i++) {
    const driverId = padDriverId(i);
    const userRef = db.collection("users").doc(driverId);

    const userSnap = await userRef.get();
    if (userSnap.exists) {
      console.log(`  ✓ ${driverId} already exists, skipping.`);
      continue;
    }

    console.log(`  → Creating ${driverId}...`);

    // Document 1: users/{driver_id}
    const userData: UserDoc = {
      created_at: FieldValue.serverTimestamp(),
      email: `driver${i}@ecoride.com`,
      name: `Eco Driver ${i}`,
      role: "driver",
      uid: driverId,
    };

    // Document 2: driver_profile/{driver_id}
    const profileData: DriverProfileDoc = {
      current_location: null,
      driver_uid: driverId,
      is_online: true,
      kyc_verified: true,
      wallet_balance: 100,
    };

    // Document 3: vehicle/{driver_id}
    const vehicleData: VehicleDoc = {
      driver_uid: driverId,
      is_ev: true,
      model: "Tesla Model 3",
      plate_number: `ECO-2025-${String(i).padStart(3, "0")}`,
    };

    // Batch write all 3 documents atomically
    const batch = db.batch();
    batch.set(userRef, userData);
    batch.set(db.collection("driver_profile").doc(driverId), profileData);
    batch.set(db.collection("vehicle").doc(driverId), vehicleData);

    await batch.commit();
    console.log(`  ✓ ${driverId} created successfully.`);
  }

  console.log(`✅ Seeding complete. ${DRIVER_COUNT} drivers ensured.`);
}
