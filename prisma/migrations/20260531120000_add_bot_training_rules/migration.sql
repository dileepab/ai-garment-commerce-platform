CREATE TABLE "BotTrainingRule" (
    "id" SERIAL NOT NULL,
    "brand" TEXT,
    "intent" TEXT NOT NULL,
    "language" TEXT,
    "matchType" TEXT NOT NULL DEFAULT 'contains',
    "pattern" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotTrainingRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotTrainingRule_enabled_brand_language_priority_idx" ON "BotTrainingRule"("enabled", "brand", "language", "priority");
CREATE INDEX "BotTrainingRule_intent_enabled_idx" ON "BotTrainingRule"("intent", "enabled");
CREATE INDEX "BotTrainingRule_lastMatchedAt_idx" ON "BotTrainingRule"("lastMatchedAt");
