import { Router } from "express";
import { userController } from "./user.controller";

const router: Router = Router();

router.get("/users", userController.getAllUsers);
router.get("/users/:id", userController.getUserById);

export const userRoutes: Router = router;