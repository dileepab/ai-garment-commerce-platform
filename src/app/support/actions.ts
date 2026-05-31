'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import {
  resolveFacebookConfigForBrand,
  resolveInstagramConfigForBrand,
} from '@/lib/brand-channel-config';
import { loadConversationState, saveConversationState } from '@/lib/conversation-state';
import {
  sendInstagramMessage,
  sendMessengerMessage,
  type MetaSendResult,
} from '@/lib/meta';
import { logInfo, logWarn } from '@/lib/app-log';
import { logAdminAudit } from '@/lib/admin-audit';
import { createReturnRequest, ReturnRequestError } from '@/lib/returns-service';
import {
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import type { UserScope } from '@/lib/access-control';

function supportDeliveryFailureNote(channel: string, error: string): string {
  const channelLabel =
    channel === 'instagram'
      ? 'Instagram'
      : channel === 'messenger'
        ? 'Messenger'
        : channel.charAt(0).toUpperCase() + channel.slice(1);

  return [
    `${channelLabel} delivery failed: ${error}`,
    'The reply was saved in Support, but Meta did not deliver it to the customer. Update/test the brand token in Settings > Meta Channels, then resend the message.',
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

      logWarn('Support Actions', 'Support reply was saved, but outbound Meta delivery failed.', {
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
