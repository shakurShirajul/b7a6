import { Router } from "express";
import { profileController } from "./profile.controller.js";

const router: Router = Router();

router.post("/profiles/patient", profileController.createPatientProfile);
router.post("/profiles/donor", profileController.createDonorProfile);
router.patch("/profiles/patient/:id", profileController.updatePatientProfile);
router.patch("/profiles/donor/:id", profileController.updateDonorProfile);

export const profileRoutes: Router = router;
