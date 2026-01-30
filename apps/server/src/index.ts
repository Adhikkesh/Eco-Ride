import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "../../../.env");
console.log("Loading .env from:", envPath);
dotenv.config({ path: envPath });

console.log(
  "Environment Check - GOOGLE_API_KEY:",
  process.env.GOOGLE_API_KEY ? "EXISTS" : "MISSING",
);

import { app } from "./app.js";

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
