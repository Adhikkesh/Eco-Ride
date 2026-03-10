/**
 * WebSocket Dispatch Service for Driver Pool Offers
 *
 * Manages persistent WebSocket connections to driver dashboards and
 * dispatches high-priority pool-offer payloads with a configurable
 * accept/ignore timeout (default 15 s).
 *
 * Architecture:
 *  - Drivers connect via `ws://host:PORT/ws/driver/:driverId`
 *  - Server tracks connections in a Map<driverId, WebSocket>
 *  - On pool match, server pushes PoolOfferPayload to the target driver
 *  - Driver responds with { type: "POOL_RESPONSE", offerId, accepted: bool }
 *  - If no response within timeout, the offer is treated as "ignored"
 */

import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { PoolOfferPayload } from "../utils/poolingEngine.js";

// ============================================================================
// Types
// ============================================================================

export interface PoolResponse {
  type: "POOL_RESPONSE";
  offerId: string;
  accepted: boolean;
}

interface PendingOffer {
  offerId: string;
  driverId: string;
  payload: PoolOfferPayload;
  timer: ReturnType<typeof setTimeout>;
  resolve: (accepted: boolean) => void;
}

// ============================================================================
// State
// ============================================================================

/** Active driver WebSocket connections (driverId → ws) */
const driverSockets = new Map<string, WebSocket>();

/** Offers awaiting driver response (offerId → PendingOffer) */
const pendingOffers = new Map<string, PendingOffer>();

let wss: WebSocketServer | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Call this once during server bootstrap.
 */
export function initWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ path: "/ws/driver", server });

  wss.on("connection", (ws, req) => {
    // Extract driverId from query string: /ws/driver?driverId=xyz
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const driverId = url.searchParams.get("driverId");

    if (!driverId) {
      ws.close(4001, "Missing driverId query parameter");
      return;
    }

    console.log(`[WS] Driver connected: ${driverId}`);

    // Replace any existing connection for this driver
    const existing = driverSockets.get(driverId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(4002, "Replaced by new connection");
    }

    driverSockets.set(driverId, ws);

    ws.on("message", (data) => {
      handleDriverMessage(driverId, data.toString());
    });

    ws.on("close", () => {
      console.log(`[WS] Driver disconnected: ${driverId}`);
      // Only delete if this is still the active socket
      if (driverSockets.get(driverId) === ws) {
        driverSockets.delete(driverId);
      }
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error for driver ${driverId}:`, err.message);
    });
  });

  console.log("[WS] WebSocket server initialized on /ws/driver");
  return wss;
}

// ============================================================================
// Driver Message Handler
// ============================================================================

function handleDriverMessage(driverId: string, raw: string): void {
  let msg: PoolResponse;
  try {
    msg = JSON.parse(raw) as PoolResponse;
  } catch {
    console.warn(`[WS] Invalid JSON from driver ${driverId}`);
    return;
  }

  if (msg.type !== "POOL_RESPONSE" || !msg.offerId) return;

  const pending = pendingOffers.get(msg.offerId);
  if (!pending) {
    console.warn(`[WS] Unknown or expired offerId: ${msg.offerId}`);
    return;
  }

  // Clear timeout and resolve the promise
  clearTimeout(pending.timer);
  pendingOffers.delete(msg.offerId);

  console.log(
    `[WS] Driver ${driverId} ${msg.accepted ? "ACCEPTED" : "DECLINED"} offer ${msg.offerId}`,
  );

  pending.resolve(msg.accepted);
}

// ============================================================================
// Dispatch
// ============================================================================

/**
 * Send a pool offer to a specific driver and wait for response.
 *
 * @returns Promise that resolves to `true` (accepted) or `false` (declined/timeout).
 */
export function dispatchPoolOffer(payload: PoolOfferPayload): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const ws = driverSockets.get(payload.driverId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log(`[WS] Driver ${payload.driverId} not connected — offer auto-declined`);
      resolve(false);
      return;
    }

    // Send the payload
    ws.send(JSON.stringify(payload));
    console.log(`[WS] Pool offer ${payload.offerId} dispatched to driver ${payload.driverId}`);

    // Set timeout for auto-decline
    const timer = setTimeout(() => {
      pendingOffers.delete(payload.offerId);
      console.log(`[WS] Offer ${payload.offerId} timed out after ${payload.timeoutSeconds}s`);
      resolve(false);
    }, payload.timeoutSeconds * 1000);

    pendingOffers.set(payload.offerId, {
      driverId: payload.driverId,
      offerId: payload.offerId,
      payload,
      resolve,
      timer,
    });
  });
}

// ============================================================================
// Utility
// ============================================================================

/** Check if a driver has an active WebSocket connection */
export function isDriverConnected(driverId: string): boolean {
  const ws = driverSockets.get(driverId);
  return !!ws && ws.readyState === WebSocket.OPEN;
}

/** Get count of connected drivers */
export function connectedDriverCount(): number {
  return driverSockets.size;
}

/** Gracefully shut down all connections */
export function shutdownWebSocket(): void {
  for (const [, ws] of driverSockets) {
    ws.close(1001, "Server shutting down");
  }
  driverSockets.clear();
  for (const [, pending] of pendingOffers) {
    clearTimeout(pending.timer);
    pending.resolve(false);
  }
  pendingOffers.clear();
  wss?.close();
}
