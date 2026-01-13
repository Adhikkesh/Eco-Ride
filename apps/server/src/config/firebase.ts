import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = path.resolve(__dirname, "../../firebase_credential.json");

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const auth: Auth = getAuth();
export const db: Firestore = getFirestore();
export const storage: Storage = getStorage();
