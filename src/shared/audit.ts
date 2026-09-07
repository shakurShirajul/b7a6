import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type AuditContext = {
  actorId?: number;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
};

type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

export const recordAuditEvent = async (
  event: AuditContext,
  client: AuditClient = prisma,
) => {
  await client.auditLog.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before,
      after: event.after,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    },
  });
};
