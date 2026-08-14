-- Every image on a message, not just the first.
--
-- A product carousel is up to four images and a size-chart answer can cover two
-- categories, but only the first was recorded, so the inbox showed one picture
-- and gave no hint the others existed.
--
-- Additive. Existing single values are carried across as one-element lists so
-- nothing rendered yesterday stops rendering today.
ALTER TABLE "ChatMessage" ADD COLUMN "imageUrls" TEXT;

UPDATE "ChatMessage"
SET "imageUrls" = json_build_array("imageUrl")::text
WHERE "imageUrl" IS NOT NULL AND "imageUrls" IS NULL;
