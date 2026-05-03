-- AlterTable: add criticalThreshold to VariantInventory for per-variant planning thresholds
ALTER TABLE "VariantInventory" ADD COLUMN "criticalThreshold" INTEGER;
