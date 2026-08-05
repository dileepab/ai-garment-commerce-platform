-- TikTok Business Account OAuth uses short-lived access tokens with refresh
-- tokens. Keep these credentials separate from TikTok Marketing API tokens.
ALTER TABLE "ChatMessage"
ADD COLUMN "externalMessageId" TEXT,
ADD COLUMN "providerMetadata" TEXT;

CREATE UNIQUE INDEX "ChatMessage_channel_externalMessageId_key"
ON "ChatMessage"("channel", "externalMessageId");

CREATE TABLE "TikTokAccountConnection" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "displayName" TEXT,
    "username" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "grantedScopes" TEXT,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "dmAutoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "refreshLeaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokAccountConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TikTokAccountConnection_brand_key"
ON "TikTokAccountConnection"("brand");

CREATE UNIQUE INDEX "TikTokAccountConnection_openId_key"
ON "TikTokAccountConnection"("openId");

-- TikTok comment and DM threads need provider IDs that are not represented by
-- the generic Support Inbox message table.
CREATE TABLE "TikTokInboxContext" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "businessOpenId" TEXT NOT NULL,
    "conversationId" TEXT,
    "videoId" TEXT,
    "commentId" TEXT,
    "customerOpenId" TEXT,
    "customerName" TEXT,
    "replyable" BOOLEAN NOT NULL DEFAULT true,
    "lastInboundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokInboxContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TikTokInboxContext_brand_channel_senderId_key"
ON "TikTokInboxContext"("brand", "channel", "senderId");

CREATE INDEX "TikTokInboxContext_businessOpenId_channel_idx"
ON "TikTokInboxContext"("businessOpenId", "channel");

CREATE INDEX "TikTokInboxContext_conversationId_idx"
ON "TikTokInboxContext"("conversationId");

CREATE INDEX "TikTokInboxContext_commentId_idx"
ON "TikTokInboxContext"("commentId");

CREATE TABLE "TikTokWebhookJob" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "businessOpenId" TEXT,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokWebhookJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TikTokWebhookJob_status_nextAttemptAt_idx"
ON "TikTokWebhookJob"("status", "nextAttemptAt");

CREATE INDEX "TikTokWebhookJob_businessOpenId_receivedAt_idx"
ON "TikTokWebhookJob"("businessOpenId", "receivedAt");

CREATE TABLE "TikTokOutboundComment" (
    "commentId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "businessOpenId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "parentCommentId" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokOutboundComment_pkey" PRIMARY KEY ("commentId")
);

CREATE INDEX "TikTokOutboundComment_businessOpenId_videoId_createdAt_idx"
ON "TikTokOutboundComment"("businessOpenId", "videoId", "createdAt");

CREATE TABLE "TikTokOutboundMessage" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "businessOpenId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "lastError" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokOutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TikTokOutboundMessage_providerMessageId_key"
ON "TikTokOutboundMessage"("providerMessageId");

CREATE INDEX "TikTokOutboundMessage_conversationId_status_reservedAt_idx"
ON "TikTokOutboundMessage"("conversationId", "status", "reservedAt");

CREATE INDEX "TikTokOutboundMessage_businessOpenId_reservedAt_idx"
ON "TikTokOutboundMessage"("businessOpenId", "reservedAt");
