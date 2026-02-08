/**
 * Eco-Ride Reactive Driver Simulator
 *
 * Entry point for the simulation engine.
 * This simulator does NOT create drivers - it only "possesses"
 * drivers who manually go online via the Driver App.
 */

import "dotenv/config";
import { simulationEngine } from "./services/SimulationEngine.js";

async function main(): Promise<void> {
  try {
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
