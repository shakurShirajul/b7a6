import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Application } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import httpStatus from "http-status";
import config from "./config/index.js";
import { AppError } from "./errors/AppError.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import { assignmentRoutes } from "./modules/assignment/assignment.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { bloodRequestRoutes } from "./modules/blood-request/blood-request.routes.js";
import { donationRoutes } from "./modules/donation/donation.routes.js";
import { donorRoutes } from "./modules/donor/donor.routes.js";
import { hospitalRoutes } from "./modules/hospital/hospital.routes.js";
import { notificationRoutes } from "./modules/notification/notification.routes.js";
import { patientRoutes } from "./modules/patient/patient.routes.js";
import {
  paymentRoutes,
  paymentWebhookRoutes,
} from "./modules/payment/payment.routes.js";
import { userRoutes } from "./modules/user/user.routes.js";
import { createBackgroundHandler } from "./jobs/background.routes.js";
import { checkReadiness } from "./readiness.js";

type AppOptions = {
  readinessCheck?: () => Promise<boolean>;
};

export const createApp = (options: AppOptions = {}): Application => {
  const app = express();
  const readinessCheck = options.readinessCheck ?? checkReadiness;

  app.disable("x-powered-by");
  app.set("trust proxy", config.trust_proxy_hops);
  app.use(helmet());
  app.use(
    cors({
      origin: config.cors_origins,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );

  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Service is healthy",
      data: { status: "ok" },
    });
  });

  app.get("/ready", async (_req, res) => {
    const ready = await readinessCheck().catch(() => false);

    if (!ready) {
      res.status(httpStatus.SERVICE_UNAVAILABLE).json({
        success: false,
        statusCode: httpStatus.SERVICE_UNAVAILABLE,
        message: "Service is not ready",
        errors: [],
        data: { status: "not_ready" },
      });
      return;
    }

    res.status(httpStatus.OK).json({
      success: true,
      statusCode: httpStatus.OK,
      message: "Service is ready",
      data: { status: "ready" },
    });
  });

  app.post("/api/internal/jobs", createBackgroundHandler());

  app.use(paymentWebhookRoutes);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      handler: (_req, _res, next) => {
        next(
          new AppError(
            httpStatus.TOO_MANY_REQUESTS,
            "Too many requests. Please try again later.",
          ),
        );
      },
    }),
  );

  app.use("/api/v1", userRoutes);
  app.use("/api/v1", authRoutes);
  app.use("/api/v1", patientRoutes);
  app.use("/api/v1", donorRoutes);
  app.use("/api/v1", hospitalRoutes);
  app.use("/api/v1", bloodRequestRoutes);
  app.use("/api/v1", assignmentRoutes);
  app.use("/api/v1", donationRoutes);
  app.use("/api/v1", paymentRoutes);
  app.use("/api/v1", notificationRoutes);
  app.use("/api/v1", adminRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

export default createApp();
