CREATE TABLE "BrandChannelConfig" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "facebookPageId" TEXT,
    "facebookPageAccessToken" TEXT,
    "instagramAccountId" TEXT,
    "instagramAccessToken" TEXT,
    "isTestBrand" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandChannelConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandChannelConfig_brand_key" ON "BrandChannelConfig"("brand");
CREATE INDEX "BrandChannelConfig_facebookPageId_idx" ON "BrandChannelConfig"("facebookPageId");
CREATE INDEX "BrandChannelConfig_instagramAccountId_idx" ON "BrandChannelConfig"("instagramAccountId");
