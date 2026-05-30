CREATE TABLE "CourierWebhookEventLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "provider" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "courierStatus" TEXT NOT NULL,
    "mappedStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "payload" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierWebhookEventLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "brand" TEXT,
    "actorEmail" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourierWebhookEventLog_orderId_receivedAt_idx" ON "CourierWebhookEventLog"("orderId", "receivedAt");
CREATE INDEX "CourierWebhookEventLog_provider_status_receivedAt_idx" ON "CourierWebhookEventLog"("provider", "status", "receivedAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "AdminAuditLog_brand_createdAt_idx" ON "AdminAuditLog"("brand", "createdAt");

ALTER TABLE "CourierWebhookEventLog"
  ADD CONSTRAINT "CourierWebhookEventLog_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
