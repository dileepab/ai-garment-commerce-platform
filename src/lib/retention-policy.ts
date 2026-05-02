export type RetentionAutomationAction =
  | 'cart_recovery'
  | 'support_timeout'
  | 'post_order_follow_up'
  | 'reorder_reminder';

export interface RetentionDecision {
  send: boolean;
  reason?: string;
}

export const RETENTION_SUPPORTED_CHANNELS = ['messenger', 'instagram'] as const;

export const CART_RECOVERY_DELAY_MS = 12 * 60 * 60 * 1000;
export const CART_RECOVERY_COOLDOWN_MS = 72 * 60 * 60 * 1000;
export const SUPPORT_TIMEOUT_DELAY_MS = 24 * 60 * 60 * 1000;
export const SUPPORT_TIMEOUT_COOLDOWN_MS = 48 * 60 * 60 * 1000;
export const POST_ORDER_FOLLOW_UP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
export const POST_ORDER_FOLLOW_UP_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
export const REORDER_REMINDER_DELAY_MS = 45 * 24 * 60 * 60 * 1000;
export const REORDER_REMINDER_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;
export const PURCHASE_NUDGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export interface RetentionAutomationPolicy {
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayMs: number;
  cartRecoveryCooldownMs: number;
  supportTimeoutEnabled: boolean;
  supportTimeoutDelayMs: number;
  supportTimeoutCooldownMs: number;
  postOrderFollowUpEnabled: boolean;
  postOrderFollowUpDelayMs: number;
  postOrderFollowUpWindowMs: number;
  reorderReminderEnabled: boolean;
  reorderReminderDelayMs: number;
  reorderReminderWindowMs: number;
  purchaseNudgeCooldownMs: number;
}

export const DEFAULT_RETENTION_AUTOMATION_POLICY: RetentionAutomationPolicy = {
  cartRecoveryEnabled: true,
  cartRecoveryDelayMs: CART_RECOVERY_DELAY_MS,
  cartRecoveryCooldownMs: CART_RECOVERY_COOLDOWN_MS,
  supportTimeoutEnabled: true,
  supportTimeoutDelayMs: SUPPORT_TIMEOUT_DELAY_MS,
  supportTimeoutCooldownMs: SUPPORT_TIMEOUT_COOLDOWN_MS,
  postOrderFollowUpEnabled: true,
  postOrderFollowUpDelayMs: POST_ORDER_FOLLOW_UP_DELAY_MS,
  postOrderFollowUpWindowMs: POST_ORDER_FOLLOW_UP_WINDOW_MS,
  reorderReminderEnabled: true,
  reorderReminderDelayMs: REORDER_REMINDER_DELAY_MS,
  reorderReminderWindowMs: REORDER_REMINDER_WINDOW_MS,
  purchaseNudgeCooldownMs: PURCHASE_NUDGE_COOLDOWN_MS,
};

const PENDING_ORDER_STEPS = new Set([
  'order_draft',
  'contact_collection',
  'contact_confirmation',
  'order_confirmation',
]);

function block(reason: string): RetentionDecision {
  return { send: false, reason };
}

function getAutomationPolicy(policy?: Partial<RetentionAutomationPolicy>): RetentionAutomationPolicy {
  return {
    ...DEFAULT_RETENTION_AUTOMATION_POLICY,
    ...policy,
  };
}

export function normalizeRetentionChannel(channel?: string | null): string {
  return channel?.trim().toLowerCase() || '';
}

export function isRetentionSupportedChannel(channel?: string | null): boolean {
  return RETENTION_SUPPORTED_CHANNELS.includes(
    normalizeRetentionChannel(channel) as (typeof RETENTION_SUPPORTED_CHANNELS)[number]
  );
}

export function getSupportAutomationBlockReason(params: {
  supportMode?: string | null;
  escalationStatus?: string | null;
  allowStaleHandoffResume?: boolean;
}): string | null {
  const supportMode = params.supportMode?.trim().toLowerCase() || 'bot_active';
  const escalationStatus = params.escalationStatus?.trim().toLowerCase() || null;

  if (supportMode === 'human_active' || escalationStatus === 'in_progress') {
    return 'human_support_active';
  }

  if (params.allowStaleHandoffResume) {
    return null;
  }

  if (supportMode === 'handoff_requested') {
    return 'support_handoff_requested';
  }

  if (escalationStatus && escalationStatus !== 'resolved') {
    return 'support_case_open';
  }

  return null;
}

export function shouldSendCartRecoveryReminder(params: {
  channel?: string | null;
  hasOrderDraft: boolean;
  pendingStep?: string | null;
  stateUpdatedAt: Date;
  now: Date;
  recentSentAt?: Date | null;
  supportBlockReason?: string | null;
  automation?: Partial<RetentionAutomationPolicy>;
}): RetentionDecision {
  const automation = getAutomationPolicy(params.automation);

  if (!automation.cartRecoveryEnabled) {
    return block('cart_recovery_disabled');
  }

  if (!isRetentionSupportedChannel(params.channel)) {
    return block('unsupported_channel');
  }

  if (params.supportBlockReason) {
    return block(params.supportBlockReason);
  }

  if (!params.hasOrderDraft) {
    return block('no_order_draft');
  }

  if (!PENDING_ORDER_STEPS.has(params.pendingStep || '')) {
    return block('no_pending_order_flow');
  }

  if (params.now.getTime() - params.stateUpdatedAt.getTime() < automation.cartRecoveryDelayMs) {
    return block('not_stale_enough');
  }

  if (
    params.recentSentAt &&
    params.now.getTime() - params.recentSentAt.getTime() < automation.cartRecoveryCooldownMs
  ) {
    return block('cart_recovery_cooldown');
  }

  return { send: true };
}

export function shouldSendSupportTimeoutFollowUp(params: {
  channel?: string | null;
  escalationStatus?: string | null;
  escalationUpdatedAt: Date;
  now: Date;
  recentSentAt?: Date | null;
  supportBlockReason?: string | null;
  automation?: Partial<RetentionAutomationPolicy>;
}): RetentionDecision {
  const automation = getAutomationPolicy(params.automation);

  if (!automation.supportTimeoutEnabled) {
    return block('support_timeout_disabled');
  }

  if (!isRetentionSupportedChannel(params.channel)) {
    return block('unsupported_channel');
  }

  if ((params.escalationStatus || '').trim().toLowerCase() !== 'open') {
    return block('support_case_not_open');
  }

  if (params.supportBlockReason) {
    return block(params.supportBlockReason);
  }

  if (params.now.getTime() - params.escalationUpdatedAt.getTime() < automation.supportTimeoutDelayMs) {
    return block('support_case_not_stale_enough');
  }

  if (
    params.recentSentAt &&
    params.now.getTime() - params.recentSentAt.getTime() < automation.supportTimeoutCooldownMs
  ) {
    return block('support_timeout_cooldown');
  }

  return { send: true };
}

export function shouldSendPurchaseRetentionMessage(params: {
  channel?: string | null;
  hasCustomerTarget: boolean;
  supportBlockReason?: string | null;
  recentSentAt?: Date | null;
  now: Date;
  automation?: Partial<RetentionAutomationPolicy>;
}): RetentionDecision {
  const automation = getAutomationPolicy(params.automation);

  if (!isRetentionSupportedChannel(params.channel)) {
    return block('unsupported_channel');
  }

  if (!params.hasCustomerTarget) {
    return block('missing_customer_target');
  }

  if (params.supportBlockReason) {
    return block(params.supportBlockReason);
  }

  if (
    params.recentSentAt &&
    params.now.getTime() - params.recentSentAt.getTime() < automation.purchaseNudgeCooldownMs
  ) {
    return block('purchase_nudge_cooldown');
  }

  return { send: true };
}

export function shouldSendPostOrderFollowUp(params: {
  channel?: string | null;
  hasCustomerTarget: boolean;
  supportBlockReason?: string | null;
  recentSentAt?: Date | null;
  now: Date;
  orderCreatedAt: Date;
  automation?: Partial<RetentionAutomationPolicy>;
}): RetentionDecision {
  const automation = getAutomationPolicy(params.automation);

  if (!automation.postOrderFollowUpEnabled) {
    return block('post_order_follow_up_disabled');
  }

  const baseDecision = shouldSendPurchaseRetentionMessage(params);
  if (!baseDecision.send) {
    return baseDecision;
  }

  const ageMs = params.now.getTime() - params.orderCreatedAt.getTime();

  if (ageMs < automation.postOrderFollowUpDelayMs) {
    return block('post_order_follow_up_not_due');
  }

  if (ageMs > automation.postOrderFollowUpWindowMs) {
    return block('post_order_follow_up_window_expired');
  }

  return { send: true };
}

export function shouldSendReorderReminder(params: {
  channel?: string | null;
  hasCustomerTarget: boolean;
  supportBlockReason?: string | null;
  recentSentAt?: Date | null;
  now: Date;
  orderCreatedAt: Date;
  automation?: Partial<RetentionAutomationPolicy>;
}): RetentionDecision {
  const automation = getAutomationPolicy(params.automation);

  if (!automation.reorderReminderEnabled) {
    return block('reorder_reminder_disabled');
  }

  const baseDecision = shouldSendPurchaseRetentionMessage(params);
  if (!baseDecision.send) {
    return baseDecision;
  }

  const ageMs = params.now.getTime() - params.orderCreatedAt.getTime();

  if (ageMs < automation.reorderReminderDelayMs) {
    return block('reorder_reminder_not_due');
  }

  if (ageMs > automation.reorderReminderWindowMs) {
    return block('reorder_reminder_window_expired');
  }

  return { send: true };
}

function getFriendlyName(name?: string | null): string {
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? firstName : 'there';
}

export function buildCartRecoveryMessage(params: {
  customerName?: string | null;
  productName?: string | null;
}): string {
  const productText = params.productName?.trim()
    ? ` your ${params.productName.trim()} order`
    : ' your order';

  return `Hi ${getFriendlyName(params.customerName)}. We saved${productText}. Reply when you are ready, or send any change you need.`;
}

export function buildSupportTimeoutMessage(): string {
  return 'Hi again. Our support team still has your message. While you wait, I can help with simple order questions here.';
}

export function buildPostOrderFollowUpMessage(params: {
  customerName?: string | null;
  orderId: number;
}): string {
  return `Hi ${getFriendlyName(params.customerName)}. Hope order #${params.orderId} reached you safely. If anything needs fixing, reply here and we will help.`;
}

export function buildReorderReminderMessage(params: {
  customerName?: string | null;
  productName?: string | null;
}): string {
  const productText = params.productName?.trim()
    ? ` another ${params.productName.trim()}`
    : ' a repeat order';

  return `Hi ${getFriendlyName(params.customerName)}. If you would like${productText}, reply "reorder" and I will prepare the same details.`;
}
