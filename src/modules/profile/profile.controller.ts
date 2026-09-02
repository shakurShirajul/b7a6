import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { profileService } from "./profile.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";

const createPatientProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const result = profileService.insertPatientProfile(payload);
    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Patient profile created successfully",
      data: result,
    });
  },
);
const createDonorProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const result = profileService.insertDonorProfile(payload);
    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Donor profile created successfully",
      data: result,
    });
  },
);
const updatePatientProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const result = profileService.patchPatientProfile(payload);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Patient profile updated successfully",
      data: result,
    });
  },
);
const updateDonorProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const result = profileService.patchDonorProfile(payload);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Donor profile updated successfully",
      data: result,
    });
  },
);
export const profileController = {
  createPatientProfile,
  createDonorProfile,
  updatePatientProfile,
  updateDonorProfile,
};
