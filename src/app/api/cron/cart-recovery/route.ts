import { NextResponse } from 'next/server';
import {
  runCartRecoveryAutomation,
  runOrderRetentionAutomations,
} from '@/lib/retention-automation';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { logWarn } from '@/lib/app-log';

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    logWarn('Cart Recovery Cron', 'Unauthorized cron request rejected.');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const cartRecovery = await runCartRecoveryAutomation(now);
    const orderRetention = await runOrderRetentionAutomations(now);

    return NextResponse.json({
      success: true,
      recovered: cartRecovery.recovered,
      cartRecovery,
      orderRetention,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
