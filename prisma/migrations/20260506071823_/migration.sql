-- CreateTable
CREATE TABLE "SocialPostCreative" (
    "id" SERIAL NOT NULL,
    "socialPostId" INTEGER NOT NULL,
    "creativeId" INTEGER NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SocialPostCreative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPostCreative_socialPostId_idx" ON "SocialPostCreative"("socialPostId");

-- AddForeignKey
ALTER TABLE "SocialPostCreative" ADD CONSTRAINT "SocialPostCreative_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostCreative" ADD CONSTRAINT "SocialPostCreative_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "GeneratedCreative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
