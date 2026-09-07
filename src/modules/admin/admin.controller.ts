import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { adminService } from "./admin.service.js";

const currentAdminId = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }
  return req.user.userId;
};

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const listUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.listUsers(req.query as never);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const user = await adminService.updateUserStatus(
    currentAdminId(req),
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User status updated successfully",
    data: user,
  });
});

const createHospital = catchAsync(async (req: Request, res: Response) => {
  const hospital = await adminService.createHospital(
    currentAdminId(req),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Hospital created successfully",
    data: hospital,
  });
});

const updateHospital = catchAsync(async (req: Request, res: Response) => {
  const hospital = await adminService.updateHospital(
    currentAdminId(req),
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      req.body.action === "DELETE"
        ? "Hospital deleted successfully"
        : "Hospital updated successfully",
    data: hospital,
  });
});

const verifyDonor = catchAsync(async (req: Request, res: Response) => {
  const donor = await adminService.verifyDonor(
    currentAdminId(req),
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      req.body.decision === "VERIFIED"
        ? "Donor profile verified successfully"
        : "Donor profile rejected successfully",
    data: donor,
  });
});

const rematchBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.rematchBloodRequest(
    currentAdminId(req),
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blood request rematching completed",
    data: result,
  });
});

const getDashboard = catchAsync(async (req: Request, res: Response) => {
  const dashboard = await adminService.getDashboard(req.query as never);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dashboard retrieved successfully",
    data: dashboard,
  });
});

const getDonationReport = catchAsync(async (req: Request, res: Response) => {
  const report = await adminService.getDonationReport(req.query as never);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donation report retrieved successfully",
    data: report,
  });
});

const listAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.listAuditLogs(req.query as never);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Audit logs retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const adminController = {
  listUsers,
  updateUserStatus,
  createHospital,
  updateHospital,
  verifyDonor,
  rematchBloodRequest,
  getDashboard,
  getDonationReport,
  listAuditLogs,
};
