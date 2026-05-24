ALTER TABLE "CommentLog"
ADD COLUMN "senderId" TEXT,
ADD COLUMN "pageOrAccountId" TEXT,
ADD COLUMN "postId" TEXT,
ADD COLUMN "message" TEXT,
ADD COLUMN "replyText" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'replied',
ADD COLUMN "skipReason" TEXT;

CREATE INDEX "CommentLog_channel_senderId_postId_repliedAt_idx" ON "CommentLog"("channel", "senderId", "postId", "repliedAt");
CREATE INDEX "CommentLog_channel_pageOrAccountId_status_repliedAt_idx" ON "CommentLog"("channel", "pageOrAccountId", "status", "repliedAt");

CREATE TABLE "CommentOptOut" (
    "id" SERIAL NOT NULL,
    "channel" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "pageOrAccountId" TEXT NOT NULL,
    "brand" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentOptOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommentOptOut_channel_senderId_pageOrAccountId_key" ON "CommentOptOut"("channel", "senderId", "pageOrAccountId");
CREATE INDEX "CommentOptOut_brand_createdAt_idx" ON "CommentOptOut"("brand", "createdAt");

CREATE TABLE "CommentReplyQueue" (
    "id" SERIAL NOT NULL,
    "commentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'facebook',
    "pageOrAccountId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "postId" TEXT,
    "brand" TEXT,
    "message" TEXT NOT NULL,
    "replyText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CommentReplyQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommentReplyQueue_commentId_key" ON "CommentReplyQueue"("commentId");
CREATE INDEX "CommentReplyQueue_status_scheduledAt_idx" ON "CommentReplyQueue"("status", "scheduledAt");
CREATE INDEX "CommentReplyQueue_pageOrAccountId_status_scheduledAt_idx" ON "CommentReplyQueue"("pageOrAccountId", "status", "scheduledAt");
