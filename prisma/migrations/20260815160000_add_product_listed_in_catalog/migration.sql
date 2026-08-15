-- Whether a product appears in the Meta catalog feed.
--
-- New products default to false: previously a product reached the WhatsApp
-- catalog within the hour of being created, carrying whatever image it had at
-- that moment. That was the raw photo, before the edited one existed.
ALTER TABLE "Product" ADD COLUMN "listedInCatalog" BOOLEAN NOT NULL DEFAULT false;

-- Everything that already exists is already listed with Meta. Leaving these
-- false would delete the live catalog on deploy.
UPDATE "Product" SET "listedInCatalog" = true;
