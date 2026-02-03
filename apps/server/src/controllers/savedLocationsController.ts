import type { RequestHandler } from "express";
import status from "http-status";
import { db } from "../config/firebase.js";

// Types for saved locations
interface SavedLocation {
  lat: number;
  lng: number;
  name: string;
}

interface SavedLocations {
  home: SavedLocation | null;
  work: SavedLocation | null;
  favourite: SavedLocation | null;
}

type LocationType = "home" | "work" | "favourite";

/**
 * Get user's saved locations
 * GET /user/saved-locations
 */
export const getSavedLocations: RequestHandler = async (req, res) => {
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  try {
    const userDoc = await db.collection("users").doc(firebaseUser.uid).get();

    if (!userDoc.exists) {
      return res.status(status.NOT_FOUND).json({ message: "User not found" });
    }

    const userData = userDoc.data();
    const savedLocations: SavedLocations = userData?.saved_locations || {
      favourite: null,
      home: null,
      work: null,
    };

    return res.status(status.OK).json({
      savedLocations,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching saved locations:", error);
    return res.status(status.INTERNAL_SERVER_ERROR).json({
      message: "Failed to fetch saved locations",
    });
  }
};

/**
 * Update a saved location
 * PUT /user/saved-locations
 * Body: { type: "home" | "work" | "favourite", location: { lat, lng, name } | null }
 */
export const updateSavedLocation: RequestHandler = async (req, res) => {
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  const { type, location } = req.body as {
    type: LocationType;
    location: SavedLocation | null;
  };

  // Validate type
  if (!type || !["home", "work", "favourite"].includes(type)) {
    return res.status(status.BAD_REQUEST).json({
      message: "Invalid location type. Must be 'home', 'work', or 'favourite'",
    });
  }

  // Validate location structure if provided
  if (location !== null) {
    if (
      typeof location.lat !== "number" ||
      typeof location.lng !== "number" ||
      typeof location.name !== "string"
    ) {
      return res.status(status.BAD_REQUEST).json({
        message: "Invalid location format. Required: { lat: number, lng: number, name: string }",
      });
    }
  }

  try {
    const userRef = db.collection("users").doc(firebaseUser.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(status.NOT_FOUND).json({ message: "User not found" });
    }

    // Update the specific saved location
    const updatePath = `saved_locations.${type}`;
    await userRef.update({
      [updatePath]: location,
    });

    return res.status(status.OK).json({
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} location updated successfully`,
      success: true,
    });
  } catch (error) {
    console.error("Error updating saved location:", error);
    return res.status(status.INTERNAL_SERVER_ERROR).json({
      message: "Failed to update saved location",
    });
  }
};
