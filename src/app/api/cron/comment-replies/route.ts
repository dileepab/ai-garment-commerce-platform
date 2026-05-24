import { NextResponse } from 'next/server';
import { processDueFacebookCommentReplies } from '@/lib/comment-reply-safety';

export async function GET() {
  try {
    const result = await processDueFacebookCommentReplies(new Date());

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
