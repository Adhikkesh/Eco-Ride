import express, { type Router } from "express";
import { VerifyTokenController } from "../controllers/authController.js";
import { GetMeController, HealthCheckController } from "../controllers/index.js";
import { CreateUserController } from "../controllers/userController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

export const router: Router = express.Router();

router.get("/health", HealthCheckController);
router.get("/auth/verify", verifyToken, VerifyTokenController);
router.get("/getme", verifyToken, GetMeController);
router.post("/user", verifyToken, CreateUserController);
