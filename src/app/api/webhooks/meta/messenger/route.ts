import { NextResponse } from 'next/server';
import { sendMessengerImage, sendMessengerMessage, sendMessengerCarousel, getUserProfile } from '@/lib/meta';
import { sendFacebookCommentReply, sendFacebookPrivateReply } from '@/lib/meta-comments';
import { getErrorMessage } from '@/lib/error-message';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { logDebug, logError } from '@/lib/app-log';
import { logRuntimeWarnings } from '@/lib/runtime-config';
import { normalizeMessengerEvent, normalizeFacebookComment } from '@/lib/meta-normalize';
import { getAiCommentReply } from '@/lib/ai';
import prisma from '@/lib/prisma';

const IS_CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === '1';

function summarizeMessagingEvent(webhookEvent: Record<string, unknown>, pageId: string) {
  const message =
    typeof webhookEvent.message === 'object' && webhookEvent.message !== null
      ? (webhookEvent.message as Record<string, unknown>)
      : null;
  const postback =
    typeof webhookEvent.postback === 'object' && webhookEvent.postback !== null
      ? (webhookEvent.postback as Record<string, unknown>)
      : null;
  const quickReply =
    message &&
    typeof message.quick_reply === 'object' &&
    message.quick_reply !== null
      ? (message.quick_reply as Record<string, unknown>)
      : null;
  const senderId =
    typeof webhookEvent.sender === 'object' &&
    webhookEvent.sender !== null &&
    'id' in webhookEvent.sender &&
    typeof webhookEvent.sender.id === 'string'
      ? webhookEvent.sender.id
      : null;
  const hasMessage = Boolean(message);
  const hasPostback = Boolean(postback);
  const messageText =
    message && typeof message.text === 'string'
      ? message.text
      : null;
  const quickReplyPayload =
    quickReply && typeof quickReply.payload === 'string'
      ? quickReply.payload
      : null;
  const postbackPayload =
    postback && typeof postback.payload === 'string'
      ? postback.payload
      : null;
  const postbackTitle =
    postback && typeof postback.title === 'string'
      ? postback.title
      : null;

  return {
    senderId,
    senderMatchesPage: senderId === pageId,
    hasMessage,
    hasPostback,
    messageText,
    quickReplyPayload,
    postbackTitle,
    postbackPayload,
    keys: Object.keys(webhookEvent),
  };
}

// Map each Facebook Page ID to its brand
function getPageBrand(pageId: string): string | null {
  const PAGE_BRAND_MAP: Record<string, string> = {};
  
  if (process.env.HAPPYBY_PAGE_ID) PAGE_BRAND_MAP[process.env.HAPPYBY_PAGE_ID] = 'Happyby';
  if (process.env.CLEOPATRA_PAGE_ID) PAGE_BRAND_MAP[process.env.CLEOPATRA_PAGE_ID] = 'Cleopatra';
  if (process.env.MODABELLA_PAGE_ID) PAGE_BRAND_MAP[process.env.MODABELLA_PAGE_ID] = 'Modabella';

  return PAGE_BRAND_MAP[pageId] || null;
}

export async function GET(request: Request) {
  logRuntimeWarnings('Meta Webhook');
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logDebug('Meta Webhook', 'Verification successful.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      logError('Meta Webhook', 'Verification failed.');
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  return new NextResponse('Bad Request', { status: 400 });
}

export async function POST(request: Request) {
  try {
    logRuntimeWarnings('Meta Webhook');
    const body = await request.json();
    logDebug('Meta Webhook', 'Received webhook body summary.', {
      object: body?.object,
      entryCount: Array.isArray(body?.entry) ? body.entry.length : 0,
    });
    
    if (body.object === 'page') {
      for (const entry of body.entry) {
        const pageId = entry.id;
        const brand = getPageBrand(pageId);

        // 1. Process standard messaging events
        if (entry.messaging) {
          for (const webhookEvent of entry.messaging) {
            logDebug(
              'Meta Webhook',
              `Page ${brand || 'unknown'} received a raw messaging event.`,
              summarizeMessagingEvent(webhookEvent, pageId)
            );

            const normalized = normalizeMessengerEvent(webhookEvent, pageId);

            if (!normalized) {
              logDebug(
                'Meta Webhook',
                `Skipped Messenger event for page ${brand || 'unknown'} because it did not normalize.`,
                summarizeMessagingEvent(webhookEvent, pageId)
              );
              continue;
            }

            logDebug('Meta Webhook', `Page ${brand || 'unknown'} received a message from ${normalized.senderId}.${normalized.imageUrl ? ' (with image)' : ''}${normalized.isPostback ? ' (postback)' : ''}`);
        
            // Fetch customer's Facebook profile for personalization
            const profile = IS_CHAT_TEST_MODE ? null : await getUserProfile(normalized.senderId);
            const customerName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : undefined;
            const customerGender = profile?.gender;

            const result = await routeCustomerMessage({
              senderId: normalized.senderId,
              channel: normalized.channel,
              currentMessage: normalized.messageText,
              brand: brand || undefined,
              customerName,
              customerGender,
              imageUrl: normalized.imageUrl,
            });

            if (!IS_CHAT_TEST_MODE && result.reply) {
              await sendMessengerMessage(normalized.senderId, result.reply);

              if (result.carouselProducts && result.carouselProducts.length > 0) {
                await sendMessengerCarousel(normalized.senderId, result.carouselProducts);
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
            const normalized = normalizeFacebookComment(change.value, pageId);
            if (!normalized) continue;

            // Check if we already replied to this comment
            const existingLog = await prisma.commentLog.findUnique({
              where: { id: normalized.commentId }
            });

            if (existingLog) {
              logDebug('Meta Webhook', `Already processed comment ${normalized.commentId}. Skipping.`);
              continue;
            }

            logDebug('Meta Webhook', `Page ${brand || 'unknown'} received a comment: "${normalized.message}"`);

            const replyText = await getAiCommentReply(normalized.message, brand || undefined);

            if (!IS_CHAT_TEST_MODE) {
              // Send public reply
              await sendFacebookCommentReply(normalized.commentId, replyText);
              // Send private DM
              await sendFacebookPrivateReply(normalized.commentId, replyText);

              // Log to prevent loops
              await prisma.commentLog.create({
                data: {
                  id: normalized.commentId,
                  channel: 'facebook',
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
    logError('Meta Webhook', 'Webhook request failed.', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
