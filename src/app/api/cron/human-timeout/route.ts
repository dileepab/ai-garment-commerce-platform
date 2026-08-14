import { NextResponse } from 'next/server';
import { runSupportTimeoutAutomation } from '@/lib/retention-automation';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { logWarn } from '@/lib/app-log';

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    logWarn('Support Timeout Cron', 'Unauthorized cron request rejected.');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

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
