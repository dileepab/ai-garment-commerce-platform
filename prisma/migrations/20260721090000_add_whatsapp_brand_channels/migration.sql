ALTER TABLE "BrandChannelConfig"
ADD COLUMN "whatsappBusinessAccountId" TEXT,
ADD COLUMN "whatsappPhoneNumberId" TEXT,
ADD COLUMN "whatsappDisplayPhoneNumber" TEXT,
ADD COLUMN "whatsappAccessToken" TEXT;

CREATE UNIQUE INDEX "BrandChannelConfig_whatsappPhoneNumberId_key"
ON "BrandChannelConfig"("whatsappPhoneNumberId");

-- Happybuy is the first WhatsApp launch brand. Meta's WABA/Phone Number IDs
-- and token are saved later through Settings once Meta finishes registration.
UPDATE "BrandChannelConfig"
SET "whatsappDisplayPhoneNumber" = '+94714123777'
WHERE LOWER(REPLACE("brand", ' ', '')) IN ('happybuy', 'happyby');
