import httpStatus from "http-status";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { NotificationListQuery } from "./notification.interface.js";

const notificationSelect = {
  id: true,
  title: true,
  message: true,
  type: true,
  readAt: true,
  deliveryStatus: true,
  deliveredAt: true,
  bloodRequestId: true,
  donorAssignmentId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationSelect;

const listOwnNotifications = async (
  userId: number,
  query: NotificationListQuery,
) => {
  const where = {
    userId,
    ...(query.unread === undefined
      ? {}
      : { readAt: query.unread ? null : { not: null } }),
    ...(query.type ? { type: query.type } : {}),
  } satisfies Prisma.NotificationWhereInput;
  const [data, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { data, meta: { page: query.page, limit: query.limit, total } };
};

const markAllOwnRead = async (userId: number) => {
  const readAt = new Date();
  const updated = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt },
  });
  return { updatedCount: updated.count, readAt };
};

const markOwnRead = async (userId: number, notificationId: number) => {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, readAt: true },
  });
  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }
  if (!existing.readAt) {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
  return prisma.notification.findFirstOrThrow({
    where: { id: notificationId, userId },
    select: notificationSelect,
  });
};

export const notificationService = {
  listOwnNotifications,
  markAllOwnRead,
  markOwnRead,
};
