import type { RequestHandler } from "express";
import status from "http-status";
import { db } from "../config/firebase.js";

// Admin UID for authorization
const ADMIN_UID = "dq8zZsXXsldH9yVcrB4B7qbHzgB2";

// Get all drivers with kyc_verified = false
export const GetUnverifiedDriversController: RequestHandler = async (req, res) => {
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  // Check if user is admin
  if (firebaseUser.uid !== ADMIN_UID) {
    return res.status(status.FORBIDDEN).json({ message: "Access denied. Admin only." });
  }

  try {
    // Get all driver profiles where kyc_verified is false
    const driverProfilesSnapshot = await db
      .collection("driver_profile")
      .where("kyc_verified", "==", false)
      .get();

    if (driverProfilesSnapshot.empty) {
      return res.status(status.OK).json({ data: [], message: "No unverified drivers found" });
    }

    const drivers = [];

    for (const doc of driverProfilesSnapshot.docs) {
      const driverProfile = doc.data();
      const driverUid = driverProfile.driver_uid;

      // Get user info
      const userDoc = await db.collection("users").doc(driverUid).get();
      const userData = userDoc.exists ? userDoc.data() : null;

      // Get vehicle info
      const vehicleSnapshot = await db
        .collection("vehicle")
        .where("driver_uid", "==", driverUid)
        .limit(1)
        .get();

      const vehicleData = vehicleSnapshot.empty ? null : vehicleSnapshot.docs[0]?.data();

      drivers.push({
        email: userData?.email || "Unknown",
        kyc_url: driverProfile.kyc_url || null,
        license_url: driverProfile.license_url || null,
        name: userData?.name || "Unknown",
        phone_number: userData?.phone_number || "Unknown",
        uid: driverUid,
        vehicle: vehicleData
          ? {
              is_ev: vehicleData.is_ev,
              model: vehicleData.model,
              plate_number: vehicleData.plate_number,
              pollution_expiry: vehicleData.pollution_expiry,
            }
          : null,
      });
    }

    res.status(status.OK).json({
      data: drivers,
      message: "Unverified drivers fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching unverified drivers:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to fetch unverified drivers",
    });
  }
};

interface VerifyDriverBody {
  driver_uid: string;
  verified: boolean;
}

// Verify or decline a driver
export const VerifyDriverController: RequestHandler<object, object, VerifyDriverBody> = async (
  req,
  res,
) => {
  const firebaseUser = req.user;
  const { driver_uid, verified } = req.body;

  if (!firebaseUser) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  // Check if user is admin
  if (firebaseUser.uid !== ADMIN_UID) {
    return res.status(status.FORBIDDEN).json({ message: "Access denied. Admin only." });
  }

  if (!driver_uid) {
    return res.status(status.BAD_REQUEST).json({ message: "driver_uid is required" });
  }

  try {
    const driverProfileRef = db.collection("driver_profile").doc(driver_uid);
    const driverProfileDoc = await driverProfileRef.get();

    if (!driverProfileDoc.exists) {
      return res.status(status.NOT_FOUND).json({ message: "Driver profile not found" });
    }

    // Update kyc_verified status
    await driverProfileRef.update({
      kyc_verified: verified,
    });

    res.status(status.OK).json({
      data: { driver_uid, verified },
      message: verified ? "Driver verified successfully" : "Driver verification declined",
    });
  } catch (error) {
    console.error("Error updating driver verification:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to update driver verification",
    });
  }
};
