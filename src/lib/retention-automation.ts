import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logInfo, logWarn } from '@/lib/app-log';
import { sendMessengerMessage } from '@/lib/meta';
import {
  buildCartRecoveryMessage,
  buildPostOrderFollowUpMessage,
  buildReorderReminderMessage,
  buildSupportTimeoutMessage,
  CART_RECOVERY_DELAY_MS,
  getSupportAutomationBlockReason,
  POST_ORDER_FOLLOW_UP_DELAY_MS,
  POST_ORDER_FOLLOW_UP_WINDOW_MS,
  REORDER_REMINDER_DELAY_MS,
  REORDER_REMINDER_WINDOW_MS,
  RETENTION_SUPPORTED_CHANNELS,
  shouldSendCartRecoveryReminder,
  shouldSendPurchaseRetentionMessage,
  shouldSendSupportTimeoutFollowUp,
  SUPPORT_TIMEOUT_DELAY_MS,
  type RetentionAutomationAction,
} from '@/lib/retention-policy';
import {
  DEFAULT_CONVERSATION_STATE,
  normalizeConversationState,
  saveConversationState,
} from '@/lib/conversation-state';

export interface AutomationRunStats {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  deduped: number;
}

export interface CartRecoveryRunResult extends AutomationRunStats {
  recovered: number;
}

export interface OrderRetentionRunResult {
  postOrderFollowUp: AutomationRunStats;
  reorderReminder: AutomationRunStats;
}

const NORMAL_RETENTION_ACTIONS: RetentionAutomationAction[] = [
  'cart_recovery',
  'post_order_follow_up',
  'reorder_reminder',
];

function emptyStats(): AutomationRunStats {
  return {
    scanned: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    deduped: 0,
  };
}

function incrementForSendResult(stats: AutomationRunStats, result: AutomationSendResult) {
  if (result === 'sent') {
    stats.sent += 1;
  } else if (result === 'failed') {
    stats.failed += 1;
  } else {
    stats.deduped += 1;
  }
}

function parseStateJson(value?: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function truncateForLog(value: string, maxLength = 220): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function getLatestSentAutomationAt(params: {
  senderId: string;
  channel: string;
  actions: RetentionAutomationAction[];
}): Promise<Date | null> {
  const latest = await prisma.automationActionLog.findFirst({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      action: {
        in: params.actions,
      },
      status: 'sent',
      sentAt: {
        not: null,
      },
    },
    orderBy: {
      sentAt: 'desc',
    },
    select: {
      sentAt: true,
    },
  });

  return latest?.sentAt ?? null;
}

async function recordAutomationSkip(params: {
  action: RetentionAutomationAction;
  senderId: string;
  channel: string;
  brand?: string | null;
  customerId?: number | null;
  orderId?: number | null;
  reason: string;
  target: unknown;
  now: Date;
}) {
  const day = params.now.toISOString().slice(0, 10);
  const dedupeKey = [
    'skip',
    params.action,
    params.channel,
    params.senderId,
    hashValue(params.target),
    params.reason,
    day,
  ].join(':');

  try {
    await prisma.automationActionLog.create({
      data: {
        action: params.action,
        dedupeKey,
        senderId: params.senderId,
        channel: params.channel,
        brand: params.brand ?? null,
        customerId: params.customerId ?? null,
        orderId: params.orderId ?? null,
        status: 'skipped',
        reason: params.reason,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      logWarn('Retention Automation', 'Could not record automation skip.', {
        action: params.action,
        senderId: params.senderId,
        channel: params.channel,
        reason: params.reason,
        error,
      });
    }
  }
}

type AutomationSendResult = 'sent' | 'failed' | 'deduped';

async function sendAutomationMessage(params: {
  action: RetentionAutomationAction;
  dedupeKey: string;
  senderId: string;
  channel: string;
  brand?: string | null;
  customerId?: number | null;
  orderId?: number | null;
  message: string;
  now: Date;
}): Promise<AutomationSendResult> {
  let logId: number;

  try {
    const log = await prisma.automationActionLog.create({
      data: {
        action: params.action,
        dedupeKey: params.dedupeKey,
        senderId: params.senderId,
        channel: params.channel,
        brand: params.brand ?? null,
        customerId: params.customerId ?? null,
        orderId: params.orderId ?? null,
        status: 'pending',
        messagePreview: truncateForLog(params.message),
      },
      select: {
        id: true,
      },
    });
    logId = log.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return 'deduped';
    }

    throw error;
  }

  const delivery = await sendMessengerMessage(params.senderId, params.message);
  if (!delivery.ok) {
    await prisma.automationActionLog.update({
      where: {
        id: logId,
      },
      data: {
        status: 'failed',
        deliveryStatus: delivery.status ? String(delivery.status) : null,
        error: delivery.error || 'Unknown delivery failure.',
      },
    });

    logWarn('Retention Automation', 'Automation message delivery failed.', {
      action: params.action,
      senderId: params.senderId,
      channel: params.channel,
      orderId: params.orderId ?? null,
      error: delivery.error || delivery.status || 'unknown',
    });

    return 'failed';
  }

  await prisma.chatMessage.create({
    data: {
      senderId: params.senderId,
      channel: params.channel,
      role: 'assistant',
      message: params.message,
      createdAt: params.now,
    },
  });

  await prisma.automationActionLog.update({
    where: {
      id: logId,
    },
    data: {
      status: 'sent',
      deliveryStatus: delivery.status ? String(delivery.status) : 'ok',
      sentAt: params.now,
    },
  });

  logInfo('Retention Automation', 'Automation message sent.', {
    action: params.action,
    senderId: params.senderId,
    channel: params.channel,
    brand: params.brand ?? null,
    orderId: params.orderId ?? null,
  });

  return 'sent';
}

async function getSupportContext(senderId: string, channel: string) {
  const [conversationState, escalation] = await Promise.all([
    prisma.conversationState.findUnique({
      where: {
        senderId_channel: {
          senderId,
          channel,
        },
      },
      select: {
        stateJson: true,
      },
    }),
    prisma.supportEscalation.findFirst({
      where: {
        senderId,
        channel,
        status: {
          not: 'resolved',
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        status: true,
        brand: true,
      },
    }),
  ]);

  return {
    state: normalizeConversationState(parseStateJson(conversationState?.stateJson)),
    escalation,
  };
}

async function touchConversationState(id: number, stateJson: string) {
  await prisma.conversationState.update({
    where: {
      id,
    },
    data: {
      stateJson,
    },
  });
}

function buildCartRecoveryDedupeKey(params: {
  senderId: string;
  channel: string;
  draft: unknown;
}) {
  return `cart_recovery:${params.channel}:${params.senderId}:${hashValue(params.draft)}`;
}

function buildOrderDedupeKey(action: RetentionAutomationAction, orderId: number) {
  return `${action}:order:${orderId}`;
}

export async function runCartRecoveryAutomation(now = new Date()): Promise<CartRecoveryRunResult> {
  const stats = emptyStats();
  const staleBefore = new Date(now.getTime() - CART_RECOVERY_DELAY_MS);
  const staleStates = await prisma.conversationState.findMany({
    where: {
      updatedAt: {
        lte: staleBefore,
      },
      channel: {
        in: [...RETENTION_SUPPORTED_CHANNELS],
      },
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: 100,
  });

  for (const stateRecord of staleStates) {
    stats.scanned += 1;

    const rawState = parseStateJson(stateRecord.stateJson);
    const state = normalizeConversationState(rawState);
    const supportContext = await getSupportContext(stateRecord.senderId, stateRecord.channel);
    const supportBlockReason = getSupportAutomationBlockReason({
      supportMode: supportContext.state.supportMode,
      escalationStatus: supportContext.escalation?.status,
    });
    const recentSentAt = await getLatestSentAutomationAt({
      senderId: stateRecord.senderId,
      channel: stateRecord.channel,
      actions: NORMAL_RETENTION_ACTIONS,
    });
    const decision = shouldSendCartRecoveryReminder({
      channel: stateRecord.channel,
      hasOrderDraft: Boolean(state.orderDraft),
      pendingStep: state.pendingStep,
      stateUpdatedAt: stateRecord.updatedAt,
      now,
      recentSentAt,
      supportBlockReason,
    });

    if (!decision.send || !state.orderDraft) {
      stats.skipped += 1;
      await recordAutomationSkip({
        action: 'cart_recovery',
        senderId: stateRecord.senderId,
        channel: stateRecord.channel,
        brand: state.orderDraft?.brand ?? null,
        reason: decision.reason || 'not_eligible',
        target: {
          stateId: stateRecord.id,
          draft: state.orderDraft,
        },
        now,
      });
      continue;
    }

    const customer = await prisma.customer.findUnique({
      where: {
        externalId: stateRecord.senderId,
      },
      select: {
        id: true,
        name: true,
      },
    });
    const message = buildCartRecoveryMessage({
      customerName: customer?.name || state.orderDraft.name,
      productName: state.orderDraft.productName,
    });
    const result = await sendAutomationMessage({
      action: 'cart_recovery',
      dedupeKey: buildCartRecoveryDedupeKey({
        senderId: stateRecord.senderId,
        channel: stateRecord.channel,
        draft: {
          productId: state.orderDraft.productId,
          productName: state.orderDraft.productName,
          size: state.orderDraft.size,
          color: state.orderDraft.color,
          quantity: state.orderDraft.quantity,
        },
      }),
      senderId: stateRecord.senderId,
      channel: stateRecord.channel,
      brand: state.orderDraft.brand,
      customerId: customer?.id,
      message,
      now,
    });

    incrementForSendResult(stats, result);

    if (result === 'sent') {
      await touchConversationState(stateRecord.id, stateRecord.stateJson);
    }
  }

  return {
    ...stats,
    recovered: stats.sent,
  };
}

function getPrimaryProductName(order: {
  orderItems: Array<{ product?: { name: string } | null }>;
}): string | null {
  return order.orderItems[0]?.product?.name ?? null;
}

function getOrderBrand(order: {
  brand?: string | null;
  orderItems: Array<{ product?: { brand: string } | null }>;
}): string | null {
  return order.brand || order.orderItems[0]?.product?.brand || null;
}

async function runPostOrderFollowUps(now: Date): Promise<AutomationRunStats> {
  const stats = emptyStats();
  const latestCreatedAt = new Date(now.getTime() - POST_ORDER_FOLLOW_UP_DELAY_MS);
  const earliestCreatedAt = new Date(now.getTime() - POST_ORDER_FOLLOW_UP_WINDOW_MS);
  const orders = await prisma.order.findMany({
    where: {
      orderStatus: 'delivered',
      createdAt: {
        gte: earliestCreatedAt,
        lte: latestCreatedAt,
      },
    },
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 100,
  });

  for (const order of orders) {
    stats.scanned += 1;

    const senderId = order.customer.externalId;
    const channel = order.customer.channel || 'messenger';
    const brand = getOrderBrand(order);
    const supportContext = senderId ? await getSupportContext(senderId, channel) : null;
    const supportBlockReason = supportContext
      ? getSupportAutomationBlockReason({
          supportMode: supportContext.state.supportMode,
          escalationStatus: supportContext.escalation?.status,
        })
      : null;
    const recentSentAt = senderId
      ? await getLatestSentAutomationAt({
          senderId,
          channel,
          actions: NORMAL_RETENTION_ACTIONS,
        })
      : null;
    const decision = shouldSendPurchaseRetentionMessage({
      channel,
      hasCustomerTarget: Boolean(senderId),
      supportBlockReason,
      recentSentAt,
      now,
    });

    if (!decision.send || !senderId) {
      stats.skipped += 1;
      if (senderId) {
        await recordAutomationSkip({
          action: 'post_order_follow_up',
          senderId,
          channel,
          brand,
          customerId: order.customerId,
          orderId: order.id,
          reason: decision.reason || 'not_eligible',
          target: {
            orderId: order.id,
          },
          now,
        });
      }
      continue;
    }

    const result = await sendAutomationMessage({
      action: 'post_order_follow_up',
      dedupeKey: buildOrderDedupeKey('post_order_follow_up', order.id),
      senderId,
      channel,
      brand,
      customerId: order.customerId,
      orderId: order.id,
      message: buildPostOrderFollowUpMessage({
        customerName: order.customer.name,
        orderId: order.id,
      }),
      now,
    });

    incrementForSendResult(stats, result);
  }

  return stats;
}

async function runReorderReminders(now: Date): Promise<AutomationRunStats> {
  const stats = emptyStats();
  const latestCreatedAt = new Date(now.getTime() - REORDER_REMINDER_DELAY_MS);
  const earliestCreatedAt = new Date(now.getTime() - REORDER_REMINDER_WINDOW_MS);
  const orders = await prisma.order.findMany({
    where: {
      orderStatus: 'delivered',
      createdAt: {
        gte: earliestCreatedAt,
        lte: latestCreatedAt,
      },
    },
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 100,
  });

  for (const order of orders) {
    stats.scanned += 1;

    const senderId = order.customer.externalId;
    const channel = order.customer.channel || 'messenger';
    const brand = getOrderBrand(order);
    const laterOrderCount = await prisma.order.count({
      where: {
        customerId: order.customerId,
        createdAt: {
          gt: order.createdAt,
        },
        orderStatus: {
          not: 'cancelled',
        },
      },
    });

    if (laterOrderCount > 0) {
      stats.skipped += 1;
      if (senderId) {
        await recordAutomationSkip({
          action: 'reorder_reminder',
          senderId,
          channel,
          brand,
          customerId: order.customerId,
          orderId: order.id,
          reason: 'customer_already_ordered_again',
          target: {
            orderId: order.id,
          },
          now,
        });
      }
      continue;
    }

    const supportContext = senderId ? await getSupportContext(senderId, channel) : null;
    const supportBlockReason = supportContext
      ? getSupportAutomationBlockReason({
          supportMode: supportContext.state.supportMode,
          escalationStatus: supportContext.escalation?.status,
        })
      : null;
    const recentSentAt = senderId
      ? await getLatestSentAutomationAt({
          senderId,
          channel,
          actions: NORMAL_RETENTION_ACTIONS,
        })
      : null;
    const decision = shouldSendPurchaseRetentionMessage({
      channel,
      hasCustomerTarget: Boolean(senderId),
      supportBlockReason,
      recentSentAt,
      now,
    });

    if (!decision.send || !senderId) {
      stats.skipped += 1;
      if (senderId) {
        await recordAutomationSkip({
          action: 'reorder_reminder',
          senderId,
          channel,
          brand,
          customerId: order.customerId,
          orderId: order.id,
          reason: decision.reason || 'not_eligible',
          target: {
            orderId: order.id,
          },
          now,
        });
      }
      continue;
    }

    const result = await sendAutomationMessage({
      action: 'reorder_reminder',
      dedupeKey: buildOrderDedupeKey('reorder_reminder', order.id),
      senderId,
      channel,
      brand,
      customerId: order.customerId,
      orderId: order.id,
      message: buildReorderReminderMessage({
        customerName: order.customer.name,
        productName: getPrimaryProductName(order),
      }),
      now,
    });

    incrementForSendResult(stats, result);
  }

  return stats;
}

export async function runOrderRetentionAutomations(
  now = new Date()
): Promise<OrderRetentionRunResult> {
  const postOrderFollowUp = await runPostOrderFollowUps(now);
  const reorderReminder = await runReorderReminders(now);

  return {
    postOrderFollowUp,
    reorderReminder,
  };
}

export async function runSupportTimeoutAutomation(now = new Date()): Promise<AutomationRunStats> {
  const stats = emptyStats();
  const staleBefore = new Date(now.getTime() - SUPPORT_TIMEOUT_DELAY_MS);
  const staleEscalations = await prisma.supportEscalation.findMany({
    where: {
      status: 'open',
      updatedAt: {
        lte: staleBefore,
      },
      channel: {
        in: [...RETENTION_SUPPORTED_CHANNELS],
      },
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: 100,
  });

  for (const escalation of staleEscalations) {
    stats.scanned += 1;

    const supportContext = await getSupportContext(escalation.senderId, escalation.channel);
    const supportBlockReason = getSupportAutomationBlockReason({
      supportMode: supportContext.state.supportMode,
      escalationStatus: supportContext.escalation?.status ?? escalation.status,
      allowStaleHandoffResume: true,
    });
    const recentSentAt = await getLatestSentAutomationAt({
      senderId: escalation.senderId,
      channel: escalation.channel,
      actions: ['support_timeout'],
    });
    const decision = shouldSendSupportTimeoutFollowUp({
      channel: escalation.channel,
      escalationStatus: escalation.status,
      escalationUpdatedAt: escalation.updatedAt,
      now,
      recentSentAt,
      supportBlockReason,
    });

    if (!decision.send) {
      stats.skipped += 1;
      await recordAutomationSkip({
        action: 'support_timeout',
        senderId: escalation.senderId,
        channel: escalation.channel,
        brand: escalation.brand,
        customerId: escalation.customerId,
        orderId: escalation.orderId,
        reason: decision.reason || 'not_eligible',
        target: {
          escalationId: escalation.id,
        },
        now,
      });
      continue;
    }

    const result = await sendAutomationMessage({
      action: 'support_timeout',
      dedupeKey: `support_timeout:escalation:${escalation.id}`,
      senderId: escalation.senderId,
      channel: escalation.channel,
      brand: escalation.brand,
      customerId: escalation.customerId,
      orderId: escalation.orderId,
      message: buildSupportTimeoutMessage(),
      now,
    });

    incrementForSendResult(stats, result);

    if (result === 'sent') {
      await saveConversationState(escalation.senderId, escalation.channel, {
        ...DEFAULT_CONVERSATION_STATE,
        ...supportContext.state,
        supportMode: 'bot_active',
        lastAssistantReplyKind: 'support_waiting',
      });
    }
  }

  return stats;
}
