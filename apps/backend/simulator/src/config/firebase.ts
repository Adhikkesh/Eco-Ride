import path from "node:path";
import { fileURLToPath } from "node:url";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = path.resolve(__dirname, "../../../server/firebase_credential.json");

let app: App;

if (!getApps().length) {
  app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: "https://eco-ride-07-default-rtdb.asia-southeast1.firebasedatabase.app/",
  });
} else {
  app = getApps()[0];
}

export const db: Firestore = getFirestore(app);
export const rtdb: Database = getDatabase(app);
