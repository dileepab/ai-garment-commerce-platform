import { NextResponse } from 'next/server';
import {
  runCartRecoveryAutomation,
  runOrderRetentionAutomations,
} from '@/lib/retention-automation';

export async function GET() {
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
