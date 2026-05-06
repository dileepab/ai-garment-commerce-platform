-- Link generated creatives to a product (nullable for back-compat)
ALTER TABLE "GeneratedCreative"
  ADD COLUMN "productId" INTEGER,
  ADD COLUMN "viewAngle" TEXT;

ALTER TABLE "GeneratedCreative"
  ADD CONSTRAINT "GeneratedCreative_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GeneratedCreative_productId_status_createdAt_idx"
  ON "GeneratedCreative"("productId", "status", "createdAt");
