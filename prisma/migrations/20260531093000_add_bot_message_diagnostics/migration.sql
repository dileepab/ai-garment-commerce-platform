CREATE TABLE "BotMessageDiagnostic" (
    "id" SERIAL NOT NULL,
    "senderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'messenger',
    "brand" TEXT,
    "messagePreview" TEXT,
    "detectedLanguage" TEXT,
    "replyLanguage" TEXT,
    "aiAction" TEXT,
    "effectiveAction" TEXT,
    "aiConfidence" REAL,
    "assistantReplyKind" TEXT,
    "supportMode" TEXT,
    "pendingStep" TEXT,
    "hasReply" BOOLEAN NOT NULL DEFAULT false,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "orderId" INTEGER,
    "issueFlags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotMessageDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotMessageDiagnostic_channel_senderId_createdAt_idx" ON "BotMessageDiagnostic"("channel", "senderId", "createdAt");
CREATE INDEX "BotMessageDiagnostic_brand_createdAt_idx" ON "BotMessageDiagnostic"("brand", "createdAt");
CREATE INDEX "BotMessageDiagnostic_effectiveAction_createdAt_idx" ON "BotMessageDiagnostic"("effectiveAction", "createdAt");
CREATE INDEX "BotMessageDiagnostic_assistantReplyKind_createdAt_idx" ON "BotMessageDiagnostic"("assistantReplyKind", "createdAt");
