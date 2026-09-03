-- TikTok photo publishing only accepts media from a verified domain or URL
-- prefix. Persist the provider-issued verification file and status so the
-- public verification route can serve it without storing it in source code.
CREATE TABLE "TikTokUrlProperty" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "propertyType" INTEGER NOT NULL DEFAULT 2,
    "status" INTEGER NOT NULL DEFAULT 0,
    "signature" TEXT,
    "fileName" TEXT,
    "requestId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokUrlProperty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TikTokUrlProperty_url_key"
ON "TikTokUrlProperty"("url");
