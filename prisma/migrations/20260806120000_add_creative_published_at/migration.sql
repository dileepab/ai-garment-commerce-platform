-- Adopted creatives: a creative becomes a product's customer-facing image once a
-- post using it publishes. Nullable, so existing rows stay unadopted and the
-- original photos keep serving until a post goes out.
ALTER TABLE "GeneratedCreative" ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE INDEX "GeneratedCreative_productId_publishedAt_idx" ON "GeneratedCreative"("productId", "publishedAt");
