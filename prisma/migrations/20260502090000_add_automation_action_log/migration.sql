-- Durable retention automation deduplication and observability.
CREATE TABLE "AutomationActionLog" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'messenger',
    "brand" TEXT,
    "customerId" INTEGER,
    "orderId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "messagePreview" TEXT,
    "deliveryStatus" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationActionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationActionLog_dedupeKey_key" ON "AutomationActionLog"("dedupeKey");
CREATE INDEX "AutomationActionLog_senderId_channel_action_createdAt_idx" ON "AutomationActionLog"("senderId", "channel", "action", "createdAt");
CREATE INDEX "AutomationActionLog_brand_action_createdAt_idx" ON "AutomationActionLog"("brand", "action", "createdAt");
CREATE INDEX "AutomationActionLog_status_updatedAt_idx" ON "AutomationActionLog"("status", "updatedAt");
