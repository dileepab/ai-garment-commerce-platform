-- Fulfillment workflow: tracking/courier/reason fields and a per-order
-- fulfillment event log for the admin timeline.
ALTER TABLE "Order"
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "courier"        TEXT,
  ADD COLUMN "failureReason"  TEXT,
  ADD COLUMN "returnReason"   TEXT;

CREATE TABLE "OrderFulfillmentEvent" (
    "id"               SERIAL NOT NULL,
    "orderId"          INTEGER NOT NULL,
    "fromStatus"       TEXT,
    "toStatus"         TEXT NOT NULL,
    "note"             TEXT,
    "trackingNumber"   TEXT,
    "courier"          TEXT,
    "actorEmail"       TEXT,
    "actorName"        TEXT,
    "customerNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFulfillmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderFulfillmentEvent_orderId_createdAt_idx" ON "OrderFulfillmentEvent"("orderId", "createdAt");

ALTER TABLE "OrderFulfillmentEvent"
  ADD CONSTRAINT "OrderFulfillmentEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
