/**
 * @fileoverview Simulator Firebase Configuration
 * @description Initializes and exports Firebase Admin SDK services for the
 *              driver simulation engine. Shares the same Firebase project as
 *              the main server but runs as a separate Node.js process.
 *              Provides Firestore and Realtime Database access.
 *              Credential path and database URL are configurable via environment variables.
 * @module simulator/config/firebase
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the shared Firebase service account credentials.
 * Reads from FIREBASE_CREDENTIAL_PATH env var (used in Docker),
 * falls back to the server package's credential file for local dev.
 */
const serviceAccount =
  process.env.FIREBASE_CREDENTIAL_PATH ||
  path.resolve(__dirname, "../../../server/firebase_credential.json");

/**
 * Firebase Realtime Database URL.
 * Reads from FIREBASE_DATABASE_URL env var (used in Docker),
 * falls back to the hardcoded default.
 */
const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://eco-ride-07-default-rtdb.asia-southeast1.firebasedatabase.app/";

let app: App;

/**
 * Initialize Firebase Admin SDK if not already initialized.
 * Prevents duplicate initialization errors when module is imported multiple times.
 */
if (!getApps().length) {
  app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL,
  });
} else {
  app = getApps()[0];
}

/**
 * Firestore database instance.
 * Used by the simulator for reading driver/ride data and updating ride status.
 */
export const db: Firestore = getFirestore(app);

/**
 * Firebase Realtime Database instance.
 * Used by the simulator for real-time driver location updates and ride state tracking.
 */
export const rtdb: Database = getDatabase(app);
