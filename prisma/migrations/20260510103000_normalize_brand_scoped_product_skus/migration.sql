-- Normalize any existing product SKUs so every brand owns its own sequence.
-- Example: Happyby HAP-0001.. and Cleopatra CLE-0001.. independently.
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
