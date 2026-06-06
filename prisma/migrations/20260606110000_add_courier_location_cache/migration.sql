CREATE TABLE "CourierLocation" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'koombiyo',
    "districtId" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "rawPayload" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierLocation_brand_provider_districtId_cityId_key" ON "CourierLocation"("brand", "provider", "districtId", "cityId");
CREATE INDEX "CourierLocation_brand_provider_normalized_idx" ON "CourierLocation"("brand", "provider", "normalized");
CREATE INDEX "CourierLocation_provider_syncedAt_idx" ON "CourierLocation"("provider", "syncedAt");
