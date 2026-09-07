import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { assignmentService } from "./assignment.service.js";

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const listMyAssignments = catchAsync(async (req: Request, res: Response) => {
  const result = await assignmentService.listMyAssignments(
    requireCurrentUser(req).userId,
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donor assignments retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const acceptAssignment = catchAsync(async (req: Request, res: Response) => {
  const assignment = await assignmentService.acceptAssignment(
    requireCurrentUser(req).userId,
    Number(req.params.id),
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donor assignment accepted successfully",
    data: assignment,
  });
});

const rejectAssignment = catchAsync(async (req: Request, res: Response) => {
  const assignment = await assignmentService.rejectAssignment(
    requireCurrentUser(req).userId,
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donor assignment rejected successfully",
    data: assignment,
  });
});

export const assignmentController = {
  listMyAssignments,
  acceptAssignment,
  rejectAssignment,
};
