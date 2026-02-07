import express, { type Router } from "express";
import {
  GetUnverifiedDriversController,
  VerifyDriverController,
} from "../controllers/adminController.js";
import { VerifyTokenController } from "../controllers/authController.js";
import { GetMeController, HealthCheckController } from "../controllers/index.js";
import {
  cancelRide,
  completeRide,
  getActiveRide,
  requestRide,
  startRide,
} from "../controllers/rideController.js";
import { CreateUserController } from "../controllers/userController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

export const router: Router = express.Router();

router.get("/health", HealthCheckController);
router.get("/auth/verify", verifyToken, VerifyTokenController);
router.get("/getme", verifyToken, GetMeController);
router.post("/user", verifyToken, CreateUserController);

// Ride routes
router.post("/ride/request", verifyToken, requestRide);
router.get("/ride/active", verifyToken, getActiveRide);
router.post("/ride/cancel", verifyToken, cancelRide);
router.post("/ride/start", verifyToken, startRide);
router.post("/ride/complete", verifyToken, completeRide);

// Admin routes
router.get("/admin/drivers/unverified", verifyToken, GetUnverifiedDriversController);
router.post("/admin/drivers/verify", verifyToken, VerifyDriverController);
