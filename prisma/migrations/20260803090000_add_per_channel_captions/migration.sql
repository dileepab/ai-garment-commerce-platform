-- Facebook and Instagram reward different copy, but publishing pushed the same
-- caption string to both. Store an optional per-channel override; the existing
-- caption column stays as the shared fallback so old posts are unaffected.
ALTER TABLE "SocialPost"
ADD COLUMN "captionsByChannel" TEXT;
