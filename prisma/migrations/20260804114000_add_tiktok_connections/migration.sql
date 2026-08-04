-- TikTok Marketing API OAuth connections are brand-scoped. App credentials
-- remain in environment variables; only encrypted user access tokens are
-- persisted here.
CREATE TABLE "TikTokConnection" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "advertiserId" TEXT,
    "advertiserName" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "grantedScopes" TEXT,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TikTokConnection_brand_key"
ON "TikTokConnection"("brand");

CREATE INDEX "TikTokConnection_advertiserId_idx"
ON "TikTokConnection"("advertiserId");
