import { Router } from "express";
import { userController } from "./user.controller";

const router: Router = Router();

router.get("/users", userController.getAllUsers);
router.get("/users/:id", userController.getUserById);
router.post("/users", userController.createUser);

export const userRoutes: Router = router;