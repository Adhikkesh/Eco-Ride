/**
 * @fileoverview Saved Locations Controller
 * @description Manages user's saved locations (home, work, favourite) for quick access
 *              during ride booking. Provides CRUD operations for location preferences.
 * @module controllers/savedLocationsController
 */

import type { RequestHandler } from "express";
import status from "http-status";
import { db } from "../config/firebase.js";

/**
 * Interface representing a single saved location.
 * @interface SavedLocation
 * @property {number} lat - Latitude of the saved location
 * @property {number} lng - Longitude of the saved location
 * @property {string} name - Human-readable name/address of the location
 */
interface SavedLocation {
  lat: number;
  lng: number;
  name: string;
}

/**
 * Interface representing all saved locations for a user.
 * @interface SavedLocations
 * @property {SavedLocation|null} home - User's home address
 * @property {SavedLocation|null} work - User's work address
 * @property {SavedLocation|null} favourite - User's favourite/frequent location
 */
interface SavedLocations {
  home: SavedLocation | null;
  work: SavedLocation | null;
  favourite: SavedLocation | null;
}

/**
 * Valid location type values.
 * @typedef {"home"|"work"|"favourite"} LocationType
 */
type LocationType = "home" | "work" | "favourite";

/**
 * Get Saved Locations Controller
 * @description Retrieves all saved locations for the authenticated user.
 *              Returns home, work, and favourite locations from Firestore.
 * @route GET /user/saved-locations
 * @access Authenticated users
 * @returns {Object} JSON response with savedLocations object
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
 * Update Saved Location Controller
 * @description Updates or deletes a specific saved location for the user.
 *              Supports home, work, and favourite location types.
 *              Pass null as location to delete a saved location.
 * @route PUT /user/saved-locations
 * @access Authenticated users
 * @param {Object} req.body - Request body
 * @param {LocationType} req.body.type - Type of location to update
 * @param {SavedLocation|null} req.body.location - New location data or null to delete
 * @returns {Object} JSON response with update status
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
