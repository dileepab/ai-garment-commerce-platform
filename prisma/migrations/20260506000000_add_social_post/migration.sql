-- CreateTable: SocialPost for AI content studio draft management
CREATE TABLE "SocialPost" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "generatedCaptions" TEXT,
    "productContext" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_brand_status_createdAt_idx" ON "SocialPost"("brand", "status", "createdAt");
