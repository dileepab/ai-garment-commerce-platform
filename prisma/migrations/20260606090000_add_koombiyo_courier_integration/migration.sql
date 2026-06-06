CREATE TABLE "CourierIntegrationSetting" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'koombiyo',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "apiKey" TEXT,
    "senderName" TEXT,
    "senderAddress" TEXT,
    "senderPhone" TEXT,
    "defaultReceiverDistrictId" TEXT,
    "defaultReceiverCityId" TEXT,
    "notes" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierIntegrationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourierShipment" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "brand" TEXT,
    "provider" TEXT NOT NULL,
    "waybillId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "orderReference" TEXT,
    "courierStatus" TEXT NOT NULL DEFAULT 'created',
    "mappedStatus" TEXT,
    "rawResponse" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdByEmail" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierIntegrationSetting_brand_provider_key" ON "CourierIntegrationSetting"("brand", "provider");
CREATE INDEX "CourierIntegrationSetting_provider_isActive_idx" ON "CourierIntegrationSetting"("provider", "isActive");
CREATE UNIQUE INDEX "CourierShipment_provider_waybillId_key" ON "CourierShipment"("provider", "waybillId");
CREATE INDEX "CourierShipment_orderId_provider_idx" ON "CourierShipment"("orderId", "provider");
CREATE INDEX "CourierShipment_provider_courierStatus_updatedAt_idx" ON "CourierShipment"("provider", "courierStatus", "updatedAt");

ALTER TABLE "CourierShipment" ADD CONSTRAINT "CourierShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
