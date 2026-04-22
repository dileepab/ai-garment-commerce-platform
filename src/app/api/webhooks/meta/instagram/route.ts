import { NextResponse } from 'next/server';
import { sendMessengerImage, sendMessengerMessage, sendMessengerCarousel } from '@/lib/meta';
import { sendInstagramCommentReply, sendInstagramPrivateReply } from '@/lib/meta-comments';
import { getErrorMessage } from '@/lib/error-message';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { logDebug, logError } from '@/lib/app-log';
import { logRuntimeWarnings } from '@/lib/runtime-config';
import { normalizeInstagramEvent, normalizeInstagramComment } from '@/lib/meta-normalize';
import { getAiCommentReply } from '@/lib/ai';
import prisma from '@/lib/prisma';

const IS_CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === '1';

// Map each Instagram account ID to its brand
function getInstagramBrand(accountId: string): string | null {
  const IG_BRAND_MAP: Record<string, string> = {};

  if (process.env.CLEOPATRA_INSTAGRAM_ID) IG_BRAND_MAP[process.env.CLEOPATRA_INSTAGRAM_ID] = 'Cleopatra';
  if (process.env.MODABELLA_INSTAGRAM_ID) IG_BRAND_MAP[process.env.MODABELLA_INSTAGRAM_ID] = 'Modabella';
  if (process.env.HAPPYBY_INSTAGRAM_ID) IG_BRAND_MAP[process.env.HAPPYBY_INSTAGRAM_ID] = 'Happyby';

  return IG_BRAND_MAP[accountId] || null;
}

export async function GET(request: Request) {
  logRuntimeWarnings('Instagram Webhook');
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logDebug('Instagram Webhook', 'Verification successful.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      logError('Instagram Webhook', 'Verification failed.');
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  return new NextResponse('Bad Request', { status: 400 });
}

export async function POST(request: Request) {
  try {
    logRuntimeWarnings('Instagram Webhook');
    const body = await request.json();

    if (body.object === 'instagram') {
      for (const entry of body.entry) {
        const accountId = entry.id;
        const brand = getInstagramBrand(accountId);

        // 1. Process standard messaging events (DMs)
        if (entry.messaging) {
          for (const webhookEvent of entry.messaging) {
            const normalized = normalizeInstagramEvent(webhookEvent, accountId);

            if (!normalized) continue;

            logDebug(
              'Instagram Webhook',
              `Account ${brand || 'unknown'} received a DM from ${normalized.senderId}.${normalized.imageUrl ? ' (with image)' : ''}${normalized.isPostback ? ' (postback)' : ''}`
            );

            const result = await routeCustomerMessage({
              senderId: normalized.senderId,
              channel: normalized.channel,
              currentMessage: normalized.messageText,
              brand: brand || undefined,
              imageUrl: normalized.imageUrl,
            });

            // Instagram DMs use the same Send API as Messenger
            if (!IS_CHAT_TEST_MODE && result.reply) {
              await sendMessengerMessage(normalized.senderId, result.reply);

              if (result.carouselProducts && result.carouselProducts.length > 0) {
                // Note: Instagram has limited template support compared to Messenger.
                await sendMessengerCarousel(normalized.senderId, result.carouselProducts).catch(() => {
                  // Silently fall back if Instagram rejects template
                });
              } else if (result.imagePaths?.length) {
                for (const imagePath of result.imagePaths) {
                  await sendMessengerImage(normalized.senderId, imagePath);
                }
              } else if (result.imagePath) {
                await sendMessengerImage(normalized.senderId, result.imagePath);
              }
            }
          }
        }

        // 2. Process feed changes (Comments)
        if (entry.changes) {
          for (const change of entry.changes) {
            const normalized = normalizeInstagramComment(change.value, accountId);
            if (!normalized) continue;

            // Check if we already replied to this comment
            const existingLog = await prisma.commentLog.findUnique({
              where: { id: normalized.commentId }
            });

            if (existingLog) {
              logDebug('Instagram Webhook', `Already processed comment ${normalized.commentId}. Skipping.`);
              continue;
            }

            logDebug('Instagram Webhook', `Account ${brand || 'unknown'} received a comment: "${normalized.message}"`);

            const replyText = await getAiCommentReply(normalized.message, brand || undefined);

            if (!IS_CHAT_TEST_MODE) {
              // Send public reply
              await sendInstagramCommentReply(normalized.commentId, replyText);
              // Send private DM (Private reply)
              await sendInstagramPrivateReply(normalized.commentId, accountId, replyText);

              // Log to prevent loops
              await prisma.commentLog.create({
                data: {
                  id: normalized.commentId,
                  channel: 'instagram',
                  brand: brand || null,
                }
              });
            }
          }
        }
      }
      return NextResponse.json({ success: true, message: "EVENT_RECEIVED" }, { status: 200 });
    }

    return NextResponse.json({ success: false }, { status: 404 });
  } catch (error: unknown) {
    logError('Instagram Webhook', 'Webhook request failed.', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
