-- Web Push subscriptions for the support inbox, one row per browser.
--
-- Stored per device rather than per operator: the same person signs in on a
-- phone and a laptop and wants to be buzzed on the phone only, and each
-- browser issues its own endpoint and key pair.
CREATE TABLE "OperatorPushSubscription" (
    "id" SERIAL NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "operatorEmail" TEXT NOT NULL,
    "brands" TEXT,
    "notifyEscalations" BOOLEAN NOT NULL DEFAULT true,
    "notifyAllMessages" BOOLEAN NOT NULL DEFAULT false,
    "deviceLabel" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorPushSubscription_pkey" PRIMARY KEY ("id")
);

-- The browser hands back the same endpoint when it re-subscribes, so this is
-- what turns a repeat subscribe into an update instead of a duplicate row.
CREATE UNIQUE INDEX "OperatorPushSubscription_endpoint_key" ON "OperatorPushSubscription"("endpoint");

CREATE INDEX "OperatorPushSubscription_operatorEmail_idx" ON "OperatorPushSubscription"("operatorEmail");
