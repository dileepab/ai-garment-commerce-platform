-- Free delivery threshold, per brand.
-- Previously a literal in the storefront, so changing it meant a deploy and
-- the cart and the courier could disagree about what a shopper owed.
ALTER TABLE "MerchantSettings"
  ADD COLUMN "freeDeliveryOverAmount" INTEGER NOT NULL DEFAULT 7000;
