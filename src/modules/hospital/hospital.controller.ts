import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { hospitalService } from "./hospital.service.js";

const listHospitals = catchAsync(async (req: Request, res: Response) => {
  const result = await hospitalService.listHospitals(
    requireCurrentUser(req).role,
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Hospitals retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getHospitalById = catchAsync(async (req: Request, res: Response) => {
  const hospital = await hospitalService.getHospitalById(
    requireCurrentUser(req).role,
    Number(req.params.id),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Hospital retrieved successfully",
    data: hospital,
  });
});

export const hospitalController = {
  listHospitals,
  getHospitalById,
};
