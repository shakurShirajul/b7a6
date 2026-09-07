import { Response } from "express";

type TMeta = {
  page: number;
  limit: number;
  total: number;
};

type TResponseData<T> = {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: TMeta;
};

export const sendResponse = <T>(res: Response, data: TResponseData<T>) => {
  const response = {
    success: data.success,
    statusCode: data.statusCode,
    message: data.message,
    data: data.data,
    ...(data.meta ? { meta: data.meta } : {}),
  };

  return res.status(data.statusCode).json(response);
};
