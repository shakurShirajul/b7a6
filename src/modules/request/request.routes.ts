import { Router } from "express";
import { requestController } from "./request.controller.js";

const router: Router = Router();

router.get("/requests/bloods", requestController.getBloodsRequests);
router.get("/requests/blooods/:id", requestController.getBloodRequestById);
router.get("/requests/donors", requestController.getDonorRequests);
router.get("/requests/donors/:id", requestController.getDonorRequestById);
router.post("/requests/bloods", requestController.createBloodRequest);
router.post("/requests/:id/approve", requestController.approveBloodRequest);

export const requestRoutes: Router = router;
