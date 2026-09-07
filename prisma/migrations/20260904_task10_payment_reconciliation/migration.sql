-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "checkoutCompletedAt" TIMESTAMP(3),
ADD COLUMN "refundId" TEXT,
ADD COLUMN "refundRequestedAt" TIMESTAMP(3),
ADD COLUMN "refundStatus" VARCHAR(32);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_refundId_key" ON "Payment"("refundId");
