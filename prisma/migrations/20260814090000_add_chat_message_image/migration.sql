-- Photo a customer sent, re-hosted on blob storage.
--
-- Meta's CDN links expire and WhatsApp media needs the access token, so the
-- inbound image was shown to the model and then discarded. Nullable and
-- additive: every existing row keeps working, older conversations simply have
-- no photo to show.
ALTER TABLE "ChatMessage" ADD COLUMN "imageUrl" TEXT;
