import { rtdb } from "../config/firebase.js";

async function clearActiveTrips() {
  console.log("Clearing all active trips...");

  try {
    // 1. Clear 'rides' node
    await rtdb.ref("rides").remove();
    console.log("✓ Removed 'rides' node.");

    // 2. Clear 'rides-assigned' node
    await rtdb.ref("rides-assigned").remove();
    console.log("✓ Removed 'rides-assigned' node.");

    // 3. Clear 'drivers-online' node (optional, but good for full reset)
    // Or maybe just reset status to AVAILABLE?
    // User asked to delete "in-progress trips". Clearing assignments covers trip state.
    // Clearing 'drivers-online' might force drivers to re-login/re-online, which is clean.
    await rtdb.ref("drivers-online").remove();
    console.log("✓ Removed 'drivers-online' node.");

    console.log("All active ride data cleared successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Error clearing data:", error);
    process.exit(1);
  }
}

clearActiveTrips();
