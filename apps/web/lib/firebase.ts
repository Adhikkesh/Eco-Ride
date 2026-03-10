/**
 * @fileoverview Firebase Client Configuration
 * @description Initializes and exports Firebase client SDK services for the web application.
 *              Provides access to Authentication, Firestore, Realtime Database, and Storage.
 *              Handles client-side only initialization to prevent SSR issues in Next.js.
 * @module lib/firebase
 */

import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";

/**
 * Google Authentication Provider instance.
 * Used for sign-in with Google OAuth flow.
 */
export const googleProvider = new GoogleAuthProvider();

/**
 * Firebase configuration object.
 * All values are loaded from environment variables (NEXT_PUBLIC_ prefix for client access).
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_DATABASE_URL,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

/**
 * Firebase app instance.
 * Only initialized on client-side (window exists) to prevent SSR errors.
 * Reuses existing app if already initialized to avoid duplicate app errors.
 */
const app =
  typeof window !== "undefined"
    ? !getApps().length
      ? initializeApp(firebaseConfig)
      : getApp()
    : null;

/**
 * Firebase Authentication instance.
 * Used for user sign-in, sign-up, and session management.
 * @type {Auth}
 */
export const auth = app ? getAuth(app) : (null as unknown as ReturnType<typeof getAuth>);

/**
 * Firestore database instance.
 * Used for reading user data and ride information.
 * @type {Firestore}
 */
export const db = app ? getFirestore(app) : (null as unknown as ReturnType<typeof getFirestore>);


/**
 * Firebase Realtime Database instance.
 * Used for real-time driver location tracking and ride status updates.
 * @type {Database}
 */
export const rtdb = app ? getDatabase(app) : (null as unknown as ReturnType<typeof getDatabase>);

export default app;
