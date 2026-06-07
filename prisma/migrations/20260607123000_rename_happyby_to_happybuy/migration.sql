UPDATE "Product" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "Customer" SET "preferredBrand" = 'Happybuy' WHERE "preferredBrand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "Order" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "ProductionBatch" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "Analytics" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "BotMessageDiagnostic" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "BotTrainingRule" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "SupportEscalation" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "CommentLog" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "CommentOptOut" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "CommentReplyQueue" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "WebhookEventLog" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "CourierIntegrationSetting" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "CourierShipment" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "CourierLocation" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "AdminAuditLog" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "AutomationActionLog" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "MerchantSettings" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "BrandChannelConfig" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "SocialPost" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "SocialPostPublishLog" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "GeneratedCreative" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');
UPDATE "ReturnRequest" SET "brand" = 'Happybuy' WHERE "brand" IN ('Happyby', 'Happy Buy', 'happyby', 'happybuy');

UPDATE "ConversationState"
SET "stateJson" = REPLACE(REPLACE(REPLACE("stateJson", 'Happyby', 'Happybuy'), 'Happy Buy', 'Happybuy'), 'happyby', 'happybuy')
WHERE "stateJson" LIKE '%Happyby%'
   OR "stateJson" LIKE '%Happy Buy%'
   OR "stateJson" LIKE '%happyby%';

UPDATE "GeneratedCreative"
SET "personaStyle" = REPLACE("personaStyle", 'happyby-', 'happybuy-')
WHERE "personaStyle" LIKE 'happyby-%';
