-- Add platform-side courier processing batches for daily RoyalExpress runs.
ALTER TABLE "Order"
ADD COLUMN "courierProcessingStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "courierProcessedAt" TIMESTAMP(3);

CREATE TABLE "CourierBatch" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "brand" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "rawResponse" TEXT,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdByEmail" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CourierShipment"
ADD COLUMN "batchId" INTEGER;

CREATE INDEX "CourierBatch_provider_brand_cutoffAt_idx" ON "CourierBatch"("provider", "brand", "cutoffAt");
CREATE INDEX "CourierBatch_provider_status_createdAt_idx" ON "CourierBatch"("provider", "status", "createdAt");
CREATE INDEX "CourierShipment_batchId_idx" ON "CourierShipment"("batchId");

ALTER TABLE "CourierShipment"
ADD CONSTRAINT "CourierShipment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CourierBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
