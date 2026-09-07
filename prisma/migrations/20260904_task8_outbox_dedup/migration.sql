-- Durable fan-out events need a stable idempotency key independent of queue state.
ALTER TABLE "OutboxEvent" ADD COLUMN "deduplicationKey" TEXT;

CREATE UNIQUE INDEX "OutboxEvent_deduplicationKey_key"
ON "OutboxEvent"("deduplicationKey");
