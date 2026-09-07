import { Worker, type Job } from "bullmq";
import nodemailer from "nodemailer";
import config from "../config/index.js";
import {
  AssignmentStatus,
  NotificationDeliveryStatus,
  NotificationType,
} from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import {
  createWorkerConnectionOptions,
  completeOutboxEvent,
  recoverFailedOutboxJob,
  EMAIL_NOTIFICATION_JOB,
  type EmailNotificationJobData,
  NOTIFICATION_QUEUE_NAME,
} from "./queue.js";

const hasEmailConfiguration = () =>
  Boolean(config.email.smtp_host && config.email.from);

const createEmailTransport = () => {
  if (!config.email.smtp_host || !config.email.from) {
    throw new Error("SMTP_HOST and EMAIL_FROM are required for email delivery");
  }
  return nodemailer.createTransport({
    host: config.email.smtp_host,
    port: config.email.smtp_port,
    secure: config.email.smtp_secure,
    auth:
      config.email.smtp_user && config.email.smtp_password
        ? {
            user: config.email.smtp_user,
            pass: config.email.smtp_password,
          }
        : undefined,
  });
};

export const deliverNotificationEmail = async (notificationId: number) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      title: true,
      message: true,
      type: true,
      deliveryStatus: true,
      user: { select: { name: true, email: true } },
      donorAssignment: {
        select: { status: true, expiresAt: true },
      },
    },
  });
  if (!notification) return { delivered: false, reason: "NOT_FOUND" as const };
  if (notification.deliveryStatus === NotificationDeliveryStatus.SENT) {
    return { delivered: false, reason: "ALREADY_SENT" as const };
  }
  if (
    notification.type === NotificationType.DONOR_INVITATION &&
    notification.donorAssignment &&
    (notification.donorAssignment.status !== AssignmentStatus.INVITED ||
      notification.donorAssignment.expiresAt <= new Date())
  ) {
    await prisma.notification.updateMany({
      where: {
        id: notification.id,
        deliveryStatus: { not: NotificationDeliveryStatus.SENT },
      },
      data: { deliveryStatus: NotificationDeliveryStatus.FAILED },
    });
    return { delivered: false, reason: "INVITATION_INACTIVE" as const };
  }

  const transport = createEmailTransport();
  await transport.sendMail({
    from: config.email.from,
    to: notification.user.email,
    subject: notification.title,
    text: `Hello ${notification.user.name},\n\n${notification.message}\n\nFor privacy and safety, sign in to view the verified request details.`,
  });
  await prisma.notification.updateMany({
    where: {
      id: notification.id,
      deliveryStatus: { not: NotificationDeliveryStatus.SENT },
    },
    data: {
      deliveryStatus: NotificationDeliveryStatus.SENT,
      deliveredAt: new Date(),
    },
  });
  return { delivered: true as const };
};

const processNotificationJob = async (
  job: Job<EmailNotificationJobData, void, typeof EMAIL_NOTIFICATION_JOB>,
) => {
  if (job.name !== EMAIL_NOTIFICATION_JOB) {
    throw new Error("Unsupported notification job");
  }
  try {
    await deliverNotificationEmail(job.data.notificationId);
    await completeOutboxEvent(job.data.outboxEventId);
  } catch (error) {
    await prisma.notification
      .updateMany({
        where: {
          id: job.data.notificationId,
          deliveryStatus: { not: NotificationDeliveryStatus.SENT },
        },
        data: { deliveryStatus: NotificationDeliveryStatus.FAILED },
      })
      .catch(() => undefined);
    throw error;
  }
};

export const startNotificationWorker = () => {
  if (!hasEmailConfiguration()) {
    console.warn(
      "Email worker started without SMTP configuration; jobs will remain retryable",
    );
  }
  const worker = new Worker<
    EmailNotificationJobData,
    void,
    typeof EMAIL_NOTIFICATION_JOB
  >(NOTIFICATION_QUEUE_NAME, processNotificationJob, {
    connection: createWorkerConnectionOptions(),
    concurrency: 5,
  });
  worker.on("failed", (job) => {
    console.error("Email notification job failed", {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
    });
    void recoverFailedOutboxJob(job).catch(() => {
      console.error("Email outbox recovery deferred", {
        eventId: job?.data.outboxEventId,
      });
    });
  });
  worker.on("error", () => {
    console.error("Email notification worker error");
  });
  return worker;
};
