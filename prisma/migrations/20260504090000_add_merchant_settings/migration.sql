CREATE TABLE "MerchantSettings" (
    "id"                            SERIAL NOT NULL,
    "storeKey"                      TEXT NOT NULL DEFAULT 'default',
    "brand"                         TEXT,
    "displayName"                   TEXT,
    "supportPhone"                  TEXT,
    "supportWhatsapp"               TEXT,
    "supportHours"                  TEXT NOT NULL DEFAULT '9:00 AM to 6:00 PM',
    "supportHandoffMessage"         TEXT,
    "processingErrorMessage"        TEXT,
    "paymentMethods"                TEXT NOT NULL DEFAULT 'COD,Online Transfer',
    "defaultPaymentMethod"          TEXT NOT NULL DEFAULT 'COD',
    "onlineTransferLabel"           TEXT NOT NULL DEFAULT 'Online Transfer',
    "deliveryColomboCharge"         INTEGER NOT NULL DEFAULT 150,
    "deliveryOutsideColomboCharge"  INTEGER NOT NULL DEFAULT 200,
    "deliveryColomboEstimate"       TEXT NOT NULL DEFAULT '1-2 business days',
    "deliveryOutsideColomboEstimate" TEXT NOT NULL DEFAULT '2-3 business days',
    "cartRecoveryEnabled"           BOOLEAN NOT NULL DEFAULT true,
    "cartRecoveryDelayHours"        INTEGER NOT NULL DEFAULT 12,
    "cartRecoveryCooldownHours"     INTEGER NOT NULL DEFAULT 72,
    "supportTimeoutEnabled"         BOOLEAN NOT NULL DEFAULT true,
    "supportTimeoutDelayHours"      INTEGER NOT NULL DEFAULT 24,
    "supportTimeoutCooldownHours"   INTEGER NOT NULL DEFAULT 48,
    "postOrderFollowUpEnabled"      BOOLEAN NOT NULL DEFAULT true,
    "postOrderFollowUpDelayDays"    INTEGER NOT NULL DEFAULT 3,
    "postOrderFollowUpWindowDays"   INTEGER NOT NULL DEFAULT 21,
    "reorderReminderEnabled"        BOOLEAN NOT NULL DEFAULT true,
    "reorderReminderDelayDays"      INTEGER NOT NULL DEFAULT 45,
    "reorderReminderWindowDays"     INTEGER NOT NULL DEFAULT 120,
    "purchaseNudgeCooldownDays"     INTEGER NOT NULL DEFAULT 14,
    "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantSettings_storeKey_key" ON "MerchantSettings"("storeKey");
CREATE INDEX "MerchantSettings_brand_idx" ON "MerchantSettings"("brand");
