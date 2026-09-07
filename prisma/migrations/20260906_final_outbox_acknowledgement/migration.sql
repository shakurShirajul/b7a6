-- Publication is not execution. Retain durable work until a worker acknowledges
-- completion; existing published rows are reconciled against retained jobs or
-- replayed through idempotent domain handlers after this migration.
ALTER TABLE "OutboxEvent" ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE INDEX "OutboxEvent_completedAt_availableAt_idx"
  ON "OutboxEvent"("completedAt", "availableAt");
