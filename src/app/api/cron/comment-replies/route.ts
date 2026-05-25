import { NextResponse } from 'next/server';
import { processDueFacebookCommentReplies } from '@/lib/comment-reply-safety';
import { logError, logInfo, logWarn } from '@/lib/app-log';
import prisma from '@/lib/prisma';

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return process.env.NODE_ENV !== 'production';
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    logWarn('Comment Reply Cron', 'Unauthorized cron request rejected.');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processDueFacebookCommentReplies(new Date());
    const nextPending = result.checked === 0
      ? await prisma.commentReplyQueue.findFirst({
          where: { status: 'pending' },
          orderBy: { scheduledAt: 'asc' },
          select: {
            commentId: true,
            brand: true,
            pageOrAccountId: true,
            scheduledAt: true,
            attempts: true,
          },
        })
      : null;

    logInfo('Comment Reply Cron', 'Processed queued Facebook comment replies.', {
      ...result,
      nextPending: nextPending
        ? {
            commentId: nextPending.commentId,
            brand: nextPending.brand,
            pageId: nextPending.pageOrAccountId,
            scheduledAt: nextPending.scheduledAt.toISOString(),
            attempts: nextPending.attempts,
          }
        : null,
    });

    return NextResponse.json({
      success: true,
      ...result,
      nextPending,
    });
  } catch (error) {
    logError('Comment Reply Cron', 'Cron processing failed.', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
