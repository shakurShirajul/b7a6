import type { Urgency } from "../generated/prisma/enums.js";

const urgencyBandSize = 699_050;
const urgencyBand: Record<Urgency, number> = {
  EMERGENCY: 0,
  HIGH: 1,
  NORMAL: 2,
};

// BullMQ allows 1..2,097,151 for explicit priority, with lower values first.
// Absolute UTC-hour buckets stay comparable across publication/retry times.
// The supported band spans 2000 through September 2079; outside values clamp.
export const requestQueuePriority = (urgency: Urgency, requiredAt: Date) => {
  const deadlineHour = Math.floor(
    (requiredAt.getTime() - Date.UTC(2000, 0, 1)) / 3_600_000,
  );
  return (
    urgencyBand[urgency] * urgencyBandSize +
    Math.max(0, Math.min(urgencyBandSize - 1, deadlineHour)) +
    1
  );
};
