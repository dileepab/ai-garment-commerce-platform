-- Meta can temporarily restrict a Page from messaging (Graph code 10, subcode
-- 1893063). While that holds, every send fails and each failure is another
-- negative signal, so record a short cooldown and skip sending until it lapses.
-- Nullable: brands that have never been restricted stay untouched.
ALTER TABLE "BrandChannelConfig" ADD COLUMN "messagingRestrictedUntil" TIMESTAMP(3);
ALTER TABLE "BrandChannelConfig" ADD COLUMN "messagingRestrictionNote" TEXT;
