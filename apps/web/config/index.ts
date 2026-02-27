/**
 * @fileoverview Web Application Configuration
 * @description Centralises environment-driven configuration for the web client.
 *              Exports the Firebase client config object and the backend API base URL.
 * @module config
 */

import "dotenv/config";

/**
 * Firebase client SDK configuration sourced from Next.js public environment variables.
 * All keys use the `NEXT_PUBLIC_` prefix so they are available in the browser bundle.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_DATABASE_URL,
  measurementId: process.env.NEXT_MEASUREMENT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

/**
 * Fully-qualified base URL for the Eco-Ride REST API (v1).
 *
 * @example
 * fetch(`${backendUrl}/ride/estimate`, { method: "POST", ... });
 */
export const backendUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/v1`;
