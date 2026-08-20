'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import {
  resolveFacebookConfigForBrand,
  resolveInstagramConfigForBrand,
  resolveWhatsAppConfigForBrand,
} from '@/lib/brand-channel-config';
import { loadConversationState, saveConversationState } from '@/lib/conversation-state';
import {
  sendInstagramMessage,
  sendMessengerMessage,
  type MetaSendResult,
} from '@/lib/meta';
import { sendMessengerImage } from '@/lib/meta';
import { resolveSupportAttachment } from '@/lib/support-attachments';
import { personaAssetOrigin } from '@/lib/persona-asset';
import { sendWhatsAppImage, sendWhatsAppMessage } from '@/lib/whatsapp';
import { logInfo, logWarn } from '@/lib/app-log';
import { parseSupportConversationKey } from '@/lib/support-inbox-core';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { logAdminAudit } from '@/lib/admin-audit';
import { createReturnRequest, ReturnRequestError } from '@/lib/returns-service';
import {
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import type { UserScope } from '@/lib/access-control';
import { resolveTikTokAccountConnection } from '@/lib/tiktok-account-connection';
import {
  sendTikTokCommentReply,
  sendTikTokDirectMessage,
} from '@/lib/tiktok-account-api';

function supportDeliveryFailureNote(channel: string, error: string): string {
  const channelLabel =
    channel === 'instagram'
      ? 'Instagram'
      : channel === 'messenger'
        ? 'Messenger'
        : channel === 'tiktok_dm'
          ? 'TikTok DM'
          : channel === 'tiktok_comment'
            ? 'TikTok Comment'
        : channel.charAt(0).toUpperCase() + channel.slice(1);

  const settingsPath = channel.startsWith('tiktok_')
    ? 'Settings > TikTok'
    : 'Settings > Meta Channels';
  return [
    `${channelLabel} delivery failed: ${error}`,
    `The reply was saved in Support, but the provider did not deliver it to the customer. Update/test the brand connection in ${settingsPath}, then resend the message.`,
  ].join('\n');
}

async function deliverSupportReply(params: {
  senderId: string;
  channel: string;
  brand?: string | null;
  reply: string;
}): Promise<MetaSendResult> {
  if (params.channel === 'messenger') {
    const config = params.brand ? await resolveFacebookConfigForBrand(params.brand) : null;

    if (params.brand && !config) {
      return {
        ok: false,
        error: `Missing Facebook Page ID or Page access token for ${params.brand}.`,
      };
    }

    return sendMessengerMessage(params.senderId, params.reply, {
      pageAccessToken: config?.pageAccessToken,
    });
  }

  if (params.channel === 'instagram') {
    const config = params.brand ? await resolveInstagramConfigForBrand(params.brand) : null;

    if (!config) {
      return {
        ok: false,
        error: params.brand
          ? `Missing Instagram account ID or access token for ${params.brand}.`
          : 'Missing Instagram account ID or access token for this support case.',
      };
    }

    return sendInstagramMessage(params.senderId, config.accountId, params.reply, {
      pageAccessToken: config.accessToken,
    });
  }

  if (params.channel === 'whatsapp') {
    const config = params.brand ? await resolveWhatsAppConfigForBrand(params.brand) : null;

    if (!config) {
      return {
        ok: false,
        error: params.brand
          ? `Missing WhatsApp Phone Number ID or access token for ${params.brand}.`
          : 'Missing WhatsApp Phone Number ID or access token for this support case.',
      };
    }

    return sendWhatsAppMessage(params.senderId, params.reply, {
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
    });
  }

  if (params.channel === 'tiktok_dm' || params.channel === 'tiktok_comment') {
    if (!params.brand) {
      return { ok: false, error: 'Missing brand for this TikTok support case.' };
    }
    const [connection, context] = await Promise.all([
      resolveTikTokAccountConnection(params.brand),
      prisma.tikTokInboxContext.findUnique({
        where: {
          brand_channel_senderId: {
            brand: params.brand,
            channel: params.channel,
            senderId: params.senderId,
          },
        },
      }),
    ]);
    if (!connection || !context) {
      return {
        ok: false,
        error: `Missing TikTok Business Account or conversation context for ${params.brand}.`,
      };
    }
    if (context.businessOpenId !== connection.openId) {
      return {
        ok: false,
        error: 'This TikTok conversation belongs to a previously connected account. Reconnect the matching account before replying.',
      };
    }

    if (params.channel === 'tiktok_dm') {
      if (!context.conversationId) {
        return { ok: false, error: 'TikTok conversation ID is missing.' };
      }
      if (!connection.grantedScopes.includes('message.list.send')) {
        return { ok: false, error: 'TikTok Business Messaging Send permission is missing.' };
      }
      return sendTikTokDirectMessage({
        accessToken: connection.accessToken,
        businessId: connection.openId,
        conversationId: context.conversationId,
        text: params.reply,
      });
    }

    if (!context.videoId || !context.commentId) {
      return { ok: false, error: 'TikTok video or comment ID is missing.' };
    }
    if (!connection.grantedScopes.includes('comment.list.manage')) {
      return { ok: false, error: 'TikTok Manage Account Comment permission is missing.' };
    }
    return sendTikTokCommentReply({
      accessToken: connection.accessToken,
      businessId: connection.openId,
      videoId: context.videoId,
      commentId: context.commentId,
      text: params.reply,
    });
  }

  return {
    ok: false,
    error: `Outbound support replies are not configured for ${params.channel}.`,
  };
}

async function setConversationSupportMode(params: {
  senderId: string;
  channel: string;
  orderId?: number | null;
  supportMode: 'handoff_requested' | 'human_active' | 'resolved';
}) {
  const state = await loadConversationState(params.senderId, params.channel);

  await saveConversationState(params.senderId, params.channel, {
    ...state,
    supportMode: params.supportMode,
    lastReferencedOrderId: params.orderId ?? state.lastReferencedOrderId ?? null,
  });
}

export async function takeOverConversationAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const senderId = String(formData.get('senderId') || '').trim();
  const channel = String(formData.get('channel') || '').trim().toLowerCase();
  const brand = String(formData.get('brand') || '').trim();

  if (!senderId || !channel || !brand) {
    return;
  }

  try {
    assertBrandAccess(scope, brand, 'conversation');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const [latestCustomerMessage, customer, activeEscalation] = await Promise.all([
    prisma.chatMessage.findFirst({
      where: {
        senderId,
        channel,
        brand,
        role: 'user',
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    }),
    prisma.customer.findUnique({
      where: { externalId: senderId },
    }),
    prisma.supportEscalation.findFirst({
      where: {
        senderId,
        channel,
        brand,
        status: { not: 'resolved' },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  if (!latestCustomerMessage) {
    return;
  }

  const summary = [
    'Manual takeover from Support Inbox.',
    `Latest customer message: ${latestCustomerMessage.message}`,
  ].join('\n');

  const escalation = activeEscalation
    ? await prisma.supportEscalation.update({
        where: { id: activeEscalation.id },
        data: {
          customerId: activeEscalation.customerId ?? customer?.id ?? null,
          contactName: activeEscalation.contactName ?? customer?.name ?? null,
          contactPhone: activeEscalation.contactPhone ?? customer?.phone ?? null,
          latestCustomerMessage: latestCustomerMessage.message,
          summary,
          status: 'in_progress',
          resolvedAt: null,
        },
      })
    : await prisma.supportEscalation.create({
        data: {
          senderId,
          channel,
          customerId: customer?.id ?? null,
          brand,
          reason: 'manual_takeover',
          status: 'in_progress',
          contactName: customer?.name ?? null,
          contactPhone: customer?.phone ?? null,
          latestCustomerMessage: latestCustomerMessage.message,
          summary,
        },
      });

  await setConversationSupportMode({
    senderId,
    channel,
    orderId: escalation.orderId,
    supportMode: 'human_active',
  });

  await logAdminAudit({
    action: 'support_conversation_taken_over',
    entityType: 'support_escalation',
    entityId: escalation.id,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Manually took over ${channel} conversation for ${brand}.`,
    metadata: {
      senderId,
      channel,
      previousStatus: activeEscalation?.status ?? 'bot_active',
    },
  });

  revalidatePath('/support');
}

export async function updateEscalationWorkflowAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const escalationId = Number.parseInt(String(formData.get('escalationId') || ''), 10);
  const nextStatus = String(formData.get('nextStatus') || '');

  if (
    !Number.isInteger(escalationId) ||
    !['open', 'in_progress', 'waiting_customer', 'waiting_team', 'resolved'].includes(nextStatus)
  ) {
    return;
  }

  const escalation = await prisma.supportEscalation.findUnique({
    where: {
      id: escalationId,
    },
  });

  if (!escalation) {
    return;
  }

  try {
    assertBrandAccess(scope, escalation.brand, 'support case');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  await prisma.supportEscalation.update({
    where: {
      id: escalationId,
    },
    data: {
      status: nextStatus,
      resolvedAt: nextStatus === 'resolved' ? new Date() : null,
    },
  });

  await logAdminAudit({
    action: 'support_status_updated',
    entityType: 'support_escalation',
    entityId: escalationId,
    brand: escalation.brand,
    actorEmail: scope.email ?? null,
    summary: `Support case #${escalationId} moved to ${nextStatus}.`,
    metadata: {
      previousStatus: escalation.status,
      nextStatus,
      senderId: escalation.senderId,
      channel: escalation.channel,
    },
  });

  await setConversationSupportMode({
    senderId: escalation.senderId,
    channel: escalation.channel,
    orderId: escalation.orderId,
    supportMode:
      nextStatus === 'resolved'
        ? 'resolved'
        : nextStatus === 'in_progress'
          ? 'human_active'
          : nextStatus === 'waiting_customer'
            ? 'human_active'
            : 'handoff_requested',
  });

  revalidatePath('/support');
  revalidatePath('/orders');
}

export async function sendSupportReplyAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const escalationId = Number.parseInt(String(formData.get('escalationId') || ''), 10);
  const reply = String(formData.get('reply') || '').trim();

  if (!Number.isInteger(escalationId) || !reply) {
    return;
  }

  const escalation = await prisma.supportEscalation.findUnique({
    where: {
      id: escalationId,
    },
  });

  if (!escalation) {
    return;
  }

  try {
    assertBrandAccess(scope, escalation.brand, 'support case');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  await prisma.chatMessage.create({
    data: {
      senderId: escalation.senderId,
      channel: escalation.channel,
      brand: escalation.brand,
      role: 'operator',
      message: reply,
    },
  });

  await logAdminAudit({
    action: 'support_reply_saved',
    entityType: 'support_escalation',
    entityId: escalationId,
    brand: escalation.brand,
    actorEmail: scope.email ?? null,
    summary: `Support reply saved for case #${escalationId}.`,
    metadata: {
      channel: escalation.channel,
      senderId: escalation.senderId,
      replyLength: reply.length,
    },
  });

  await prisma.supportEscalation.update({
    where: {
      id: escalationId,
    },
    data: {
      status: 'in_progress',
    },
  });

  await setConversationSupportMode({
    senderId: escalation.senderId,
    channel: escalation.channel,
    orderId: escalation.orderId,
    supportMode: 'human_active',
  });

  if (process.env.CHAT_TEST_MODE !== '1') {
    const delivery = await deliverSupportReply({
      senderId: escalation.senderId,
      channel: escalation.channel,
      brand: escalation.brand,
      reply,
    });

    if (!delivery.ok) {
      const error = delivery.error || String(delivery.status || 'unknown');

      logWarn('Support Actions', 'Support reply was saved, but outbound provider delivery failed.', {
        escalationId,
        senderId: escalation.senderId,
        channel: escalation.channel,
        brand: escalation.brand || null,
        error,
      });

      await prisma.chatMessage.create({
        data: {
          senderId: escalation.senderId,
          channel: escalation.channel,
          brand: escalation.brand,
          role: 'support_note',
          message: supportDeliveryFailureNote(escalation.channel, error),
        },
      });
    } else {
      logInfo('Support Actions', 'Delivered support reply to customer.', {
        escalationId,
        senderId: escalation.senderId,
        channel: escalation.channel,
        brand: escalation.brand || null,
      });
    }
  }

  revalidatePath('/support');
  revalidatePath('/orders');
}

export async function addSupportNoteAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const escalationId = Number.parseInt(String(formData.get('escalationId') || ''), 10);
  const note = String(formData.get('note') || '').trim();

  if (!Number.isInteger(escalationId) || !note) {
    return;
  }

  const escalation = await prisma.supportEscalation.findUnique({
    where: {
      id: escalationId,
    },
  });

  if (!escalation) {
    return;
  }

  try {
    assertBrandAccess(scope, escalation.brand, 'support case');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  await prisma.chatMessage.create({
    data: {
      senderId: escalation.senderId,
      channel: escalation.channel,
      brand: escalation.brand,
      role: 'support_note',
      message: note,
    },
  });

  await logAdminAudit({
    action: 'support_note_added',
    entityType: 'support_escalation',
    entityId: escalationId,
    brand: escalation.brand,
    actorEmail: scope.email ?? null,
    summary: `Added internal note to support case #${escalationId}.`,
    metadata: {
      noteLength: note.length,
    },
  });

  revalidatePath('/support');
}

export async function startRefundDamageWorkflowAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const escalationId = Number.parseInt(String(formData.get('escalationId') || ''), 10);
  const orderId = Number.parseInt(String(formData.get('orderId') || ''), 10);
  const workflowType = String(formData.get('workflowType') || 'return') === 'exchange'
    ? 'exchange'
    : 'return';
  const reason = String(formData.get('reason') || '').trim() || 'Customer reported damaged item or refund request.';

  if (!Number.isInteger(escalationId) || !Number.isInteger(orderId)) {
    return;
  }

  const escalation = await prisma.supportEscalation.findUnique({
    where: { id: escalationId },
  });

  if (!escalation) {
    return;
  }

  try {
    assertBrandAccess(scope, escalation.brand, 'support case');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, brand: true, customerId: true },
  });

  if (!order) {
    return;
  }

  try {
    assertBrandAccess(scope, order.brand, 'order');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  if (escalation.customerId && order.customerId !== escalation.customerId) {
    await prisma.chatMessage.create({
      data: {
        senderId: escalation.senderId,
        channel: escalation.channel,
        brand: escalation.brand,
        role: 'support_note',
        message: `Could not start ${workflowType} workflow: order #${orderId} is not linked to this customer.`,
      },
    });
    revalidatePath('/support');
    return;
  }

  let workflowNote = '';
  try {
    const created = await createReturnRequest({
      orderId,
      type: workflowType,
      reason,
      requestedBy: 'customer',
      adminNote: `Started from support case #${escalationId}.`,
    });

    workflowNote = `${workflowType === 'exchange' ? 'Exchange' : 'Return/refund'} workflow started for order #${orderId}. Return request #${created.id} is now in requested status. Ask the customer for photos, package condition, and whether they prefer refund or replacement.`;

    await logAdminAudit({
      action: 'support_return_workflow_started',
      entityType: 'return_request',
      entityId: created.id,
      brand: order.brand,
      actorEmail: scope.email ?? null,
      summary: `Started ${workflowType} workflow from support case #${escalationId} for order #${orderId}.`,
      metadata: {
        escalationId,
        orderId,
        type: workflowType,
      },
    });
  } catch (error) {
    workflowNote =
      error instanceof ReturnRequestError
        ? `Could not create ${workflowType} workflow for order #${orderId}: ${error.message}`
        : `Could not create ${workflowType} workflow for order #${orderId}. Please retry from Returns.`;
  }

  await prisma.$transaction([
    prisma.supportEscalation.update({
      where: { id: escalationId },
      data: {
        status: 'in_progress',
        reason: workflowType === 'exchange' ? 'exchange_request' : 'refund_or_damage',
        orderId,
      },
    }),
    prisma.chatMessage.create({
      data: {
        senderId: escalation.senderId,
        channel: escalation.channel,
        brand: escalation.brand,
        role: 'support_note',
        message: workflowNote,
      },
    }),
  ]);

  await setConversationSupportMode({
    senderId: escalation.senderId,
    channel: escalation.channel,
    orderId,
    supportMode: 'human_active',
  });

  revalidatePath('/support');
  revalidatePath('/orders');
  revalidatePath('/returns');
}


/**
 * Sends a size chart or a product photo to the customer from the inbox.
 *
 * The bot's own size chart path promises an image and then sends nothing when
 * none resolves — a customer answered "🤔🤔" to exactly that. Until that is
 * trustworthy an operator needs to be able to send the chart by hand, and the
 * product photo is the same one-click need.
 *
 * The browser sends an identifier, never a URL: the option is looked up again
 * here, so a support login cannot push an arbitrary URL through the brand's
 * WhatsApp number.
 */
export async function sendSupportAttachmentAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const escalationId = Number.parseInt(String(formData.get('escalationId') || ''), 10);
  const attachmentId = String(formData.get('attachmentId') || '').trim();
  const caption = String(formData.get('caption') || '').trim();

  if (!Number.isInteger(escalationId) || !attachmentId) {
    return;
  }

  const escalation = await prisma.supportEscalation.findUnique({
    where: { id: escalationId },
  });

  if (!escalation) return;

  try {
    assertBrandAccess(scope, escalation.brand, 'support case');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const origin = personaAssetOrigin() ?? '';
  const attachment = await resolveSupportAttachment(attachmentId, escalation.brand, origin);

  if (!attachment) {
    logWarn('Support Actions', 'Support attachment could not be resolved.', {
      escalationId,
      attachmentId,
      brand: escalation.brand || null,
    });
    return;
  }

  const messageText = caption || attachment.label;

  await prisma.chatMessage.create({
    data: {
      senderId: escalation.senderId,
      channel: escalation.channel,
      brand: escalation.brand,
      role: 'operator',
      message: messageText,
      imageUrl: attachment.imageUrl,
    },
  });

  await logAdminAudit({
    action: 'support_attachment_sent',
    entityType: 'support_escalation',
    entityId: escalationId,
    brand: escalation.brand,
    actorEmail: scope.email ?? null,
    summary: `Support attachment sent for case #${escalationId}: ${attachment.label}.`,
    metadata: {
      channel: escalation.channel,
      attachmentId,
      imageUrl: attachment.imageUrl,
    },
  });

  await prisma.supportEscalation.update({
    where: { id: escalationId },
    data: { status: 'in_progress' },
  });

  if (process.env.CHAT_TEST_MODE !== '1') {
    const delivery = await deliverSupportAttachment({
      senderId: escalation.senderId,
      channel: escalation.channel,
      brand: escalation.brand,
      imageUrl: attachment.imageUrl,
      caption: messageText,
    });

    if (!delivery.ok) {
      logWarn('Support Actions', 'Support attachment was saved, but delivery failed.', {
        escalationId,
        channel: escalation.channel,
        brand: escalation.brand || null,
        error: delivery.error || String(delivery.status || 'unknown'),
      });
    }
  }

  revalidatePath('/support');
}

/**
 * Only Messenger and WhatsApp can carry an image today. Instagram has no image
 * sender in this codebase, so it is refused loudly rather than silently saving
 * a message the customer will never see.
 */
async function deliverSupportAttachment(params: {
  senderId: string;
  channel: string;
  brand?: string | null;
  imageUrl: string;
  caption: string;
}): Promise<MetaSendResult> {
  if (params.channel === 'messenger') {
    const config = params.brand ? await resolveFacebookConfigForBrand(params.brand) : null;

    if (params.brand && !config) {
      return { ok: false, error: `Missing Facebook Page ID or Page access token for ${params.brand}.` };
    }

    return sendMessengerImage(params.senderId, params.imageUrl, {
      pageAccessToken: config?.pageAccessToken,
    });
  }

  if (params.channel === 'whatsapp') {
    const config = params.brand ? await resolveWhatsAppConfigForBrand(params.brand) : null;

    if (!config) {
      return {
        ok: false,
        error: params.brand
          ? `Missing WhatsApp Phone Number ID or access token for ${params.brand}.`
          : 'Missing WhatsApp Phone Number ID or access token for this support case.',
      };
    }

    return sendWhatsAppImage(
      params.senderId,
      params.imageUrl,
      { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken },
      params.caption
    );
  }

  return {
    ok: false,
    error: `Images cannot be sent on ${params.channel} yet. Send a link in a text reply instead.`,
  };
}

/**
 * Lets an operator finish an order the bot has already drafted.
 *
 * A customer confirmed twice — "Yes confirm❤️", then "Correct details" — and
 * the bot asked a third time. From her side the order was placed; there was no
 * order. An operator could message her and could not act, because the only way
 * to create an order was for the customer to type the right word.
 *
 * This runs the bot's own confirmation rather than reimplementing it, so stock,
 * the waybill, the ad conversion and the customer's message are exactly what
 * they would have been. The customer is not recorded as having said anything:
 * the transcript keeps an operator line naming who placed it.
 */
export async function placeDraftedOrderAction(formData: FormData) {
  let scope: UserScope;
  try {
    scope = await requireActionPermission('support:reply');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  const conversationKey = String(formData.get('conversationKey') || '').trim();
  if (!conversationKey) return;

  let identity;
  try {
    identity = parseSupportConversationKey(conversationKey);
  } catch {
    return;
  }

  try {
    assertBrandAccess(scope, identity.brand, 'support case');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }

  // The bot's own path. `transcriptMessage` is empty so the confirmation is
  // never written into the transcript as the customer's words — she did not
  // send it, and a support record that says otherwise is worse than useless.
  const result = await routeCustomerMessage({
    senderId: identity.senderId,
    channel: identity.channel,
    brand: identity.brand || undefined,
    currentMessage: 'yes',
    transcriptMessage: '',
  });

  const placedOrderId = result.orderId ?? null;

  await prisma.chatMessage.create({
    data: {
      senderId: identity.senderId,
      channel: identity.channel,
      brand: identity.brand,
      role: 'operator',
      message: placedOrderId
        ? `Placed order #${placedOrderId} for the customer.`
        : 'Tried to place the drafted order; the bot did not have a complete draft.',
    },
  });

  if (result.reply) {
    const delivery = await deliverSupportReply({
      senderId: identity.senderId,
      channel: identity.channel,
      brand: identity.brand,
      reply: result.reply,
    });

    if (!delivery.ok) {
      // Saved but undelivered is the state worth shouting about: the order may
      // exist while the customer is still waiting to hear anything.
      logWarn('Support Actions', 'Placed the order but could not tell the customer.', {
        channel: identity.channel,
        orderId: placedOrderId,
        error: delivery.error || String(delivery.status || 'unknown'),
      });
    }
  }

  await logAdminAudit({
    action: 'support_order_placed',
    entityType: 'order',
    entityId: placedOrderId,
    brand: identity.brand,
    actorEmail: scope.email ?? null,
    summary: placedOrderId
      ? `Operator placed order #${placedOrderId} from the support inbox.`
      : 'Operator tried to place a drafted order with no complete draft.',
    metadata: {
      channel: identity.channel,
      senderId: identity.senderId,
      conversationKey,
    },
  });

  revalidatePath('/support');
}
