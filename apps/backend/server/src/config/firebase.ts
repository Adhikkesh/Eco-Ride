/**
 * @fileoverview Firebase Configuration
 * @description Initializes and exports Firebase Admin SDK services.
 *              Provides access to Firestore, Realtime Database, Authentication, and Storage.
 *              Uses service account credentials for server-side Firebase access.
 *              Credential path and database URL are configurable via environment variables.
 * @module config/firebase
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

// Get current directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to Firebase service account credentials JSON file.
 * Reads from FIREBASE_CREDENTIAL_PATH env var (used in Docker),
 * falls back to the local file in the server root directory.
 */
const serviceAccount =
  process.env.FIREBASE_CREDENTIAL_PATH ||
  path.resolve(__dirname, "../../firebase_credential.json");

/**
 * Firebase Realtime Database URL.
 * Reads from FIREBASE_DATABASE_URL env var (used in Docker),
 * falls back to the hardcoded default.
 */
const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://eco-ride-07-default-rtdb.asia-southeast1.firebasedatabase.app/";

/**
 * Initialize Firebase Admin SDK if not already initialized.
 * Prevents duplicate initialization errors when module is imported multiple times.
 */
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL,
  });
}

/**
 * Firebase Authentication service instance.
 * Used for verifying user tokens and managing user accounts.
 * @type {Auth}
 */
export const auth: Auth = getAuth();

/**
 * Firestore database instance.
 * Primary database for persistent data (users, rides, vehicles, etc.).
 * @type {Firestore}
 */
export const db: Firestore = getFirestore();

/**
 * Firebase Realtime Database instance.
 * Used for real-time data synchronization (driver locations, ride status).
 * @type {Database}
 */
export const rtdb = getDatabase();

/**
 * Firebase Cloud Storage instance.
 * Used for storing files (KYC documents, profile images, etc.).
 * @type {Storage}
 */
export const storage: Storage = getStorage();
