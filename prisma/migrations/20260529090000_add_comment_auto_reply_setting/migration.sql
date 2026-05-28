ALTER TABLE "MerchantSettings"
ADD COLUMN IF NOT EXISTS "commentAutoReplyEnabled" BOOLEAN NOT NULL DEFAULT false;
