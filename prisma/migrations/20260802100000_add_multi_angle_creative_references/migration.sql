-- A product colour used to allow exactly one photo. Creative generation could
-- therefore only ever see the front, and back/side views were inferred by the
-- image model. Store one photo per colour AND angle so each requested view has
-- a real reference.
ALTER TABLE "ProductColorImage"
ADD COLUMN "angle" TEXT NOT NULL DEFAULT 'front';

-- Existing rows are all front photos, which the default already records.
DROP INDEX IF EXISTS "ProductColorImage_productId_color_key";

CREATE UNIQUE INDEX "ProductColorImage_productId_color_angle_key"
ON "ProductColorImage"("productId", "color", "angle");

-- Track the full reference set, output framing, and correction history on each
-- generation so a regenerate reproduces the same inputs instead of falling back
-- to a single source image.
ALTER TABLE "GeneratedCreative"
ADD COLUMN "referenceImages" TEXT,
ADD COLUMN "aspectRatio" TEXT,
ADD COLUMN "corrections" TEXT;

-- Backfill the reference set from the single source image already recorded.
UPDATE "GeneratedCreative"
SET "referenceImages" = json_build_array(
  json_build_object('url', "sourceImageUrl", 'angle', 'front')
)::text
WHERE "sourceImageUrl" IS NOT NULL
  AND "referenceImages" IS NULL;
