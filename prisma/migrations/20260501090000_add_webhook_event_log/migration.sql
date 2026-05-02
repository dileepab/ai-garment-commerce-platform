-- Durable Meta webhook idempotency and failure observability.
CREATE TABLE "WebhookEventLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "senderId" TEXT,
    "pageOrAccountId" TEXT,
    "brand" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookEventLog_channel_senderId_receivedAt_idx" ON "WebhookEventLog"("channel", "senderId", "receivedAt");
CREATE INDEX "WebhookEventLog_status_updatedAt_idx" ON "WebhookEventLog"("status", "updatedAt");
