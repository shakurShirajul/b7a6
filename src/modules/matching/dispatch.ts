import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";
import { matchDonors } from "./matching.service.js";

export const runRequestMatching = async (
  requestId: number,
  radiusKm: number,
) => {
  // Capture IDs before matching so a newer event cannot be acknowledged here.
  const events = await prisma.outboxEvent.findMany({
    where: {
      type: "MATCH_BLOOD_REQUEST",
      aggregateId: String(requestId),
      completedAt: null,
    },
    select: { id: true },
  });
  const result = await matchDonors(requestId, radiusKm);
  if (events.length > 0) {
    const now = new Date();
    await prisma.outboxEvent.updateMany({
      where: { id: { in: events.map(({ id }) => id) }, completedAt: null },
      data: { processedAt: now, completedAt: now, lastError: null },
    });
  }
  return result;
};

export const dispatchVerifiedRequestMatching = async (requestId: number) => {
  if (config.matching.execution_mode === "WORKER") {
    return { status: "QUEUED" as const };
  }
  try {
    await runRequestMatching(requestId, config.matching.default_radius_km);
    return { status: "COMPLETED" as const };
  } catch {
    // Verification has committed. Keep its outbox event for a worker or admin retry.
    return { status: "DEFERRED" as const };
  }
};
