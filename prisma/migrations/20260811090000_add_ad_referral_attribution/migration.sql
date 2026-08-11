-- Click-to-WhatsApp ads name the ad only on the first message after the click.
-- The order is placed several messages later, so the referral is parked per
-- sender and copied onto the order when it is created.
ALTER TABLE "Order"
ADD COLUMN "adSourceType" TEXT,
ADD COLUMN "adSourceId" TEXT,
ADD COLUMN "adClickId" TEXT;

CREATE INDEX "Order_adSourceId_idx" ON "Order"("adSourceId");

CREATE TABLE "AdReferral" (
    "id" SERIAL NOT NULL,
    "channel" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "clickId" TEXT,
    "headline" TEXT,
    "sourceUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdReferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdReferral_channel_senderId_key"
ON "AdReferral"("channel", "senderId");

CREATE INDEX "AdReferral_sourceId_idx" ON "AdReferral"("sourceId");
