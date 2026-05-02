import { NextResponse } from 'next/server';
import { runSupportTimeoutAutomation } from '@/lib/retention-automation';

export async function GET() {
  try {
    const result = await runSupportTimeoutAutomation(new Date());

    return NextResponse.json({
      success: true,
      cleared: result.sent,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
