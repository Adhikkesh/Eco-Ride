/**
 * Eco-Ride Reactive Driver Simulator
 *
 * Entry point for the simulation engine.
 * This simulator does NOT create drivers - it only "possesses"
 * drivers who manually go online via the Driver App.
 */

import express from "express";
import "dotenv/config";
import { simulationEngine } from "./services/SimulationEngine.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (_req, res) => {
  res.status(200).send("Simulator is running");
});

async function main(): Promise<void> {
  try {
    // Start the health check server
    const _server = app.listen(PORT, () => {
      console.log(`🤖 Simulator Health Check Server listening on port ${PORT}`);
    });

    // Start the simulation engine
    await simulationEngine.start();

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n  🛑 Received SIGINT, shutting down...");
      simulationEngine.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("\n  🛑 Received SIGTERM, shutting down...");
      simulationEngine.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Simulator failed to start:", error);
    process.exit(1);
  }
}

main();
