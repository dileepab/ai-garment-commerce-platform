ALTER TABLE "MerchantSettings"
ALTER COLUMN "deliveryColomboCharge" SET DEFAULT 425,
ALTER COLUMN "deliveryOutsideColomboCharge" SET DEFAULT 425;

UPDATE "MerchantSettings"
SET
  "deliveryColomboCharge" = 425,
  "deliveryOutsideColomboCharge" = 425
WHERE
  "deliveryColomboCharge" <> 425
  OR "deliveryOutsideColomboCharge" <> 425;
