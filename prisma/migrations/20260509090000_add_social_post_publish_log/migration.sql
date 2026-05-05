-- AlterTable: add publish tracking columns to SocialPost
ALTER TABLE "SocialPost" ADD COLUMN "publishStatus" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "SocialPost" ADD COLUMN "publishedBy" TEXT;

-- CreateTable
CREATE TABLE "SocialPostPublishLog" (
    "id" SERIAL NOT NULL,
    "socialPostId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalPostId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostPublishLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPostPublishLog_socialPostId_createdAt_idx" ON "SocialPostPublishLog"("socialPostId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialPostPublishLog_brand_channel_createdAt_idx" ON "SocialPostPublishLog"("brand", "channel", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialPostPublishLog" ADD CONSTRAINT "SocialPostPublishLog_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
