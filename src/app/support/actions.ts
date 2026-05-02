'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { loadConversationState, saveConversationState } from '@/lib/conversation-state';
import { sendMessengerMessage } from '@/lib/meta';
import { logInfo, logWarn } from '@/lib/app-log';
import {
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import type { UserScope } from '@/lib/access-control';

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

  if (!Number.isInteger(escalationId) || !['open', 'in_progress', 'resolved'].includes(nextStatus)) {
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

  await setConversationSupportMode({
    senderId: escalation.senderId,
    channel: escalation.channel,
    orderId: escalation.orderId,
    supportMode:
      nextStatus === 'resolved'
        ? 'resolved'
        : nextStatus === 'in_progress'
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
    const delivery = await sendMessengerMessage(escalation.senderId, reply);

    if (!delivery.ok) {
      logWarn('Support Actions', 'Support reply was saved, but outbound Meta delivery failed.', {
        escalationId,
        senderId: escalation.senderId,
        channel: escalation.channel,
        error: delivery.error || delivery.status || 'unknown',
      });
    } else {
      logInfo('Support Actions', 'Delivered support reply to customer.', {
        escalationId,
        senderId: escalation.senderId,
        channel: escalation.channel,
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

  revalidatePath('/support');
}
