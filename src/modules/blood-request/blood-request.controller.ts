import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { bloodRequestService } from "./blood-request.service.js";

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const createBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const request = await bloodRequestService.createBloodRequest(
    requireCurrentUser(req).userId,
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Blood request created successfully",
    data: request,
  });
});

const listBloodRequests = catchAsync(async (req: Request, res: Response) => {
  const result = await bloodRequestService.listBloodRequests(
    requireCurrentUser(req),
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blood requests retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const listMyBloodRequests = catchAsync(async (req: Request, res: Response) => {
  const result = await bloodRequestService.listMyBloodRequests(
    requireCurrentUser(req).userId,
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Your blood requests were retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const request = await bloodRequestService.getAuthorizedBloodRequest(
    requireCurrentUser(req),
    Number(req.params.id),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blood request retrieved successfully",
    data: request,
  });
});

const updateBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const request = await bloodRequestService.updateBloodRequest(
    requireCurrentUser(req).userId,
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blood request updated successfully",
    data: request,
  });
});

const deleteBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const result = await bloodRequestService.deleteBloodRequest(
    requireCurrentUser(req),
    Number(req.params.id),
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blood request deleted successfully",
    data: result,
  });
});

const cancelBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const request = await bloodRequestService.cancelBloodRequest(
    requireCurrentUser(req),
    Number(req.params.id),
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blood request cancelled successfully",
    data: request,
  });
});

const verifyBloodRequest = catchAsync(async (req: Request, res: Response) => {
  const request = await bloodRequestService.verifyBloodRequest(
    requireCurrentUser(req).userId,
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      req.body.decision === "VERIFIED"
        ? "Blood request verified successfully"
        : "Blood request rejected successfully",
    data: request,
  });
});

export const bloodRequestController = {
  createBloodRequest,
  listBloodRequests,
  listMyBloodRequests,
  getBloodRequest,
  updateBloodRequest,
  deleteBloodRequest,
  cancelBloodRequest,
  verifyBloodRequest,
};
