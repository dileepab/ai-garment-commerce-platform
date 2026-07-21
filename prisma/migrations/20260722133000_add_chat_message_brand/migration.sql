-- Brand-scoped conversation history. Keep the column nullable so legacy or
-- non-brand chat sources remain valid while new channel traffic is attributed.
ALTER TABLE "ChatMessage"
ADD COLUMN "brand" TEXT;

-- Prefer the diagnostic generated for the same conversation nearest in time.
-- Bot diagnostics carry the brand resolved by the chat orchestrator.
UPDATE "ChatMessage" AS message
SET "brand" = (
    SELECT diagnostic."brand"
    FROM "BotMessageDiagnostic" AS diagnostic
    WHERE diagnostic."senderId" = message."senderId"
      AND diagnostic."channel" = message."channel"
      AND diagnostic."brand" IS NOT NULL
    ORDER BY
      ABS(EXTRACT(EPOCH FROM (diagnostic."createdAt" - message."createdAt"))) ASC,
      diagnostic."createdAt" DESC,
      diagnostic."id" DESC
    LIMIT 1
)
WHERE message."brand" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "BotMessageDiagnostic" AS diagnostic
    WHERE diagnostic."senderId" = message."senderId"
      AND diagnostic."channel" = message."channel"
      AND diagnostic."brand" IS NOT NULL
  );

-- Older support-owned conversations may predate diagnostics. Use the closest
-- support case for the same channel identity when its brand is known.
UPDATE "ChatMessage" AS message
SET "brand" = (
    SELECT escalation."brand"
    FROM "SupportEscalation" AS escalation
    WHERE escalation."senderId" = message."senderId"
      AND escalation."channel" = message."channel"
      AND escalation."brand" IS NOT NULL
    ORDER BY
      ABS(EXTRACT(EPOCH FROM (escalation."createdAt" - message."createdAt"))) ASC,
      escalation."updatedAt" DESC,
      escalation."id" DESC
    LIMIT 1
)
WHERE message."brand" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "SupportEscalation" AS escalation
    WHERE escalation."senderId" = message."senderId"
      AND escalation."channel" = message."channel"
      AND escalation."brand" IS NOT NULL
  );

-- Final fallback for customer histories that have a saved preferred brand but
-- no diagnostic or support case. externalId is unique in the current schema.
UPDATE "ChatMessage" AS message
SET "brand" = customer."preferredBrand"
FROM "Customer" AS customer
WHERE message."brand" IS NULL
  AND customer."externalId" = message."senderId"
  AND customer."preferredBrand" IS NOT NULL;

CREATE INDEX "ChatMessage_brand_channel_senderId_createdAt_idx"
ON "ChatMessage"("brand", "channel", "senderId", "createdAt");
