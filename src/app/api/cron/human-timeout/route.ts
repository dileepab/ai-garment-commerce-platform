import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendMessengerMessage } from '@/lib/meta';
import { logWarn } from '@/lib/app-log';

export async function GET() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleEscalations = await prisma.supportEscalation.findMany({
      where: {
        status: 'open',
        updatedAt: { lte: twentyFourHoursAgo },
        channel: 'messenger'
      }
    });

    let clearedCount = 0;

    for (const esc of staleEscalations) {
      const conv = await prisma.conversationState.findUnique({
        where: { senderId_channel: { senderId: esc.senderId, channel: 'messenger' } }
      });
      
      if (conv?.stateJson) {
        const parsed = JSON.parse(conv.stateJson);
        if (parsed.botPaused) {
          parsed.botPaused = false;
          await prisma.conversationState.update({
            where: { id: conv.id },
            data: { stateJson: JSON.stringify(parsed) }
          });
          
          const msg = `Hi again. I'm sorry to say all of our human agents are currently occupied and haven't been able to review your ticket yet.\n\nI have un-paused our automated system so I can help answer some of your questions while we wait!`;
          const delivery = await sendMessengerMessage(esc.senderId, msg);
          if (!delivery.ok) {
            logWarn('Human Timeout Cron', 'Could not send support timeout notification.', {
              escalationId: esc.id,
              senderId: esc.senderId,
              error: delivery.error || delivery.status || 'unknown',
            });
          }
          clearedCount++;
        }
      }
    }

    return NextResponse.json({ success: true, cleared: clearedCount });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
