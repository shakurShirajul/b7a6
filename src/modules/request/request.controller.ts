import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { requestService } from "./request.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";

const getBloodsRequests = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await requestService.getBloodsRequestFromDB()
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Blood requests retrieved successfully",
        data: result
    })
})

const getBloodRequestById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;
    const result = await requestService.getBloodRequestByIdFromDB(Number(id));
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Blood request retrived successfully",
        data: result
    })
})

const getDonorRequests = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await requestService.getDonorsRequestFromDB()
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Donor requests retrieved successfully",
        data: result
    })
})

const getDonorRequestById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;
    const result =  await requestService.getDonorRequestByIdFromDB(Number(id))
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Donor request retrieved successfully",
        data: result
    })
})

const createBloodRequest = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const result = await requestService.createBloodRequestInDB(payload);
    sendResponse(res,{
        statusCode: httpStatus.CREATED,
        success: true,
        message: "Blood request created successfully",
        data: result
    })
})

const approveBloodRequest = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;
    const result = await requestService.approvdeBloodRequest(Number(id));
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Blood request approved successfully",
        data: result
    });
});

export const requestController = {
  getBloodsRequests,
  getBloodRequestById,
  getDonorRequests,
  getDonorRequestById,
  createBloodRequest,
  approveBloodRequest
}  