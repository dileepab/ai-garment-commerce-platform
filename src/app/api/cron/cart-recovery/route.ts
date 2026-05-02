import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendMessengerMessage } from '@/lib/meta';
import { logWarn } from '@/lib/app-log';

export async function GET() {
  try {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const staleStates = await prisma.conversationState.findMany({
      where: {
        updatedAt: { lte: twelveHoursAgo },
        channel: 'messenger',
      }
    });

    let recoveredCount = 0;

    for (const state of staleStates) {
      if (!state.stateJson) continue;
      const parsed = JSON.parse(state.stateJson);
      
      if (parsed.orderDraft && !parsed.reminderSent && parsed.pendingStep) {
        parsed.reminderSent = true;
        
        await prisma.conversationState.update({
          where: { id: state.id },
          data: { stateJson: JSON.stringify(parsed) }
        });

        const msg = `Hi there! It looks like you left something in your drafted order. Did you still want to complete this purchase? If so, just let me know or ask me any final questions!`;
        const delivery = await sendMessengerMessage(state.senderId, msg);
        if (!delivery.ok) {
          logWarn('Cart Recovery Cron', 'Could not send cart recovery reminder.', {
            senderId: state.senderId,
            error: delivery.error || delivery.status || 'unknown',
          });
        }
        recoveredCount++;
      }
    }

    return NextResponse.json({ success: true, recovered: recoveredCount });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
