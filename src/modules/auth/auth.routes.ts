import { Router } from "express";
import { authController } from "./auth.controller";

const router: Router = Router();

router.post("/login", authController.loginUser);
router.post("/refreshe-token", authController.refreshToken);
router.post("/logout", authController.logoutUser);

export const authRoutes: Router = router;
