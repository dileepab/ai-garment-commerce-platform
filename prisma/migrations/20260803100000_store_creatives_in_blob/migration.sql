-- Every generated creative was stored as a base64 data URL inside Postgres,
-- roughly 1-3 MB per row. New generations upload to blob storage and keep only
-- the URL here; existing rows keep their base64 until they are regenerated, so
-- generatedImageData has to become nullable rather than being dropped.
ALTER TABLE "GeneratedCreative"
ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "GeneratedCreative"
ALTER COLUMN "generatedImageData" DROP NOT NULL;
