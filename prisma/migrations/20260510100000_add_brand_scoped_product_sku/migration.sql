-- Add a real product-level SKU so product codes can continue independently
-- within each brand instead of using the global Product.id sequence.
ALTER TABLE "Product" ADD COLUMN "sku" TEXT;

WITH ranked AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(LEFT(UPPER(REGEXP_REPLACE("brand", '[^A-Za-z0-9]', '', 'g')), 3), ''),
      'SKU'
    ) AS prefix,
    ROW_NUMBER() OVER (PARTITION BY "brand" ORDER BY "id") AS brand_seq
  FROM "Product"
)
UPDATE "Product" AS p
SET "sku" = ranked.prefix || '-' || LPAD(ranked.brand_seq::TEXT, 4, '0')
FROM ranked
WHERE p."id" = ranked."id";

CREATE UNIQUE INDEX "Product_brand_sku_key" ON "Product"("brand", "sku");
