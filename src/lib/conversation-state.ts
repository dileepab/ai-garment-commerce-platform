import type { ResolvedOrderDraft } from '@/lib/order-draft';
import type { SizeChartCategory } from '@/lib/size-charts';
import type { CustomerLanguage } from '@/lib/chat/language';
import prisma from '@/lib/prisma';

export type PendingConversationStep =
  | 'none'
  | 'size_chart_selection'
  | 'order_draft'
  | 'contact_collection'
  | 'contact_confirmation'
  | 'order_confirmation'
  | 'quantity_update_confirmation';

export type SupportWorkflowMode =
  | 'bot_active'
  | 'handoff_requested'
  | 'human_active'
  | 'resolved';

export type AssistantReplyKind =
  | 'generic'
  | 'greeting'
  | 'support_contact'
  | 'support_handoff'
  | 'support_waiting'
  | 'contact_confirmation'
  | 'order_summary'
  | 'order_confirmed'
  | 'order_status'
  | 'order_details'
  | 'quantity_prompt'
  | 'quantity_update_summary'
  | 'fallback';

export interface PendingQuantityUpdate {
  orderId: number;
  productName: string;
  quantity: number;
  size?: string | null;
  color?: string | null;
  price: number;
  deliveryCharge: number;
  total: number;
  paymentMethod?: string | null;
  name: string;
  address: string;
  phone: string;
  giftWrap: boolean;
  giftNote?: string | null;
}

export interface ConversationStateData {
  pendingStep: PendingConversationStep;
  orderDraft: ResolvedOrderDraft | null;
  quantityUpdate: PendingQuantityUpdate | null;
  lastReferencedOrderId: number | null;
  lastMissingOrderId: number | null;
  lastSizeChartCategory: SizeChartCategory | null;
  supportMode: SupportWorkflowMode;
  lastAssistantReplyKind: AssistantReplyKind;
  unclearMessageCount: number;
  preferredLanguage: CustomerLanguage;
}

const VALID_PENDING_STEPS = new Set<PendingConversationStep>([
  'none',
  'size_chart_selection',
  'order_draft',
  'contact_collection',
  'contact_confirmation',
  'order_confirmation',
  'quantity_update_confirmation',
]);

const VALID_SIZE_CHART_CATEGORIES = new Set<SizeChartCategory>([
  'tops',
  'dresses',
  'pants',
  'skirts',
]);

const VALID_ASSISTANT_REPLY_KINDS = new Set<AssistantReplyKind>([
  'generic',
  'greeting',
  'support_contact',
  'support_handoff',
  'support_waiting',
  'contact_confirmation',
  'order_summary',
  'order_confirmed',
  'order_status',
  'order_details',
  'quantity_prompt',
  'quantity_update_summary',
  'fallback',
]);

const VALID_SUPPORT_MODES = new Set<SupportWorkflowMode>([
  'bot_active',
  'handoff_requested',
  'human_active',
  'resolved',
]);
const VALID_LANGUAGES = new Set<CustomerLanguage>(['english', 'sinhala', 'tamil']);

export const DEFAULT_CONVERSATION_STATE: ConversationStateData = {
  pendingStep: 'none',
  orderDraft: null,
  quantityUpdate: null,
  lastReferencedOrderId: null,
  lastMissingOrderId: null,
  lastSizeChartCategory: null,
  supportMode: 'bot_active',
  lastAssistantReplyKind: 'generic',
  unclearMessageCount: 0,
  preferredLanguage: 'english',
};

function parseConversationState(value?: string | null): Partial<ConversationStateData> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Partial<ConversationStateData>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePendingStep(value?: string | null): PendingConversationStep {
  return VALID_PENDING_STEPS.has(value as PendingConversationStep)
    ? (value as PendingConversationStep)
    : 'none';
}

function normalizeSizeChartCategory(value?: string | null): SizeChartCategory | null {
  if (!value) {
    return null;
  }

  return VALID_SIZE_CHART_CATEGORIES.has(value as SizeChartCategory)
    ? (value as SizeChartCategory)
    : null;
}

function normalizeAssistantReplyKind(value?: string | null): AssistantReplyKind {
  return VALID_ASSISTANT_REPLY_KINDS.has(value as AssistantReplyKind)
    ? (value as AssistantReplyKind)
    : 'generic';
}

function normalizeSupportMode(value?: string | null): SupportWorkflowMode {
  return VALID_SUPPORT_MODES.has(value as SupportWorkflowMode)
    ? (value as SupportWorkflowMode)
    : 'bot_active';
}

function normalizeCustomerLanguage(value?: string | null): CustomerLanguage {
  return VALID_LANGUAGES.has(value as CustomerLanguage)
    ? (value as CustomerLanguage)
    : 'english';
}

export function normalizeConversationState(
  value?: Partial<ConversationStateData> | null
): ConversationStateData {
  const nextState = value ?? {};

  return {
    pendingStep: normalizePendingStep(nextState.pendingStep),
    orderDraft: nextState.orderDraft ?? null,
    quantityUpdate: nextState.quantityUpdate ?? null,
    lastReferencedOrderId:
      typeof nextState.lastReferencedOrderId === 'number'
        ? nextState.lastReferencedOrderId
        : null,
    lastMissingOrderId:
      typeof nextState.lastMissingOrderId === 'number'
        ? nextState.lastMissingOrderId
        : null,
    lastSizeChartCategory: normalizeSizeChartCategory(nextState.lastSizeChartCategory),
    supportMode: normalizeSupportMode(nextState.supportMode),
    lastAssistantReplyKind: normalizeAssistantReplyKind(nextState.lastAssistantReplyKind),
    unclearMessageCount:
      typeof nextState.unclearMessageCount === 'number' && nextState.unclearMessageCount > 0
        ? Math.floor(nextState.unclearMessageCount)
        : 0,
    preferredLanguage: normalizeCustomerLanguage(nextState.preferredLanguage),
  };
}

function stringifyConversationState(state: ConversationStateData): string {
  return JSON.stringify(state);
}

function stringifyLegacyConversationState(state: ConversationStateData): string {
  const legacyState = {
    pendingStep: state.pendingStep,
    orderDraft: state.orderDraft,
    quantityUpdate: state.quantityUpdate,
    lastReferencedOrderId: state.lastReferencedOrderId,
    lastMissingOrderId: state.lastMissingOrderId,
    lastSizeChartCategory: state.lastSizeChartCategory,
    supportMode: state.supportMode,
    lastAssistantReplyKind: state.lastAssistantReplyKind,
  };

  return JSON.stringify(legacyState);
}

export async function loadConversationState(
  senderId: string,
  channel: string
): Promise<ConversationStateData> {
  const record = await prisma.conversationState.findUnique({
    where: {
      senderId_channel: {
        senderId,
        channel,
      },
    },
    select: {
      stateJson: true,
    },
  });

  return normalizeConversationState(parseConversationState(record?.stateJson));
}

export async function saveConversationState(
  senderId: string,
  channel: string,
  state: Partial<ConversationStateData>
): Promise<ConversationStateData> {
  const normalizedState = normalizeConversationState(state);

  await prisma.conversationState.upsert({
    where: {
      senderId_channel: {
        senderId,
        channel,
      },
    },
    create: {
      senderId,
      channel,
      stateJson: stringifyConversationState(normalizedState),
    },
    update: {
      stateJson: stringifyConversationState(normalizedState),
    },
  });

  return normalizedState;
}

export async function saveConversationStateIfCurrent(
  senderId: string,
  channel: string,
  currentState: Partial<ConversationStateData>,
  nextState: Partial<ConversationStateData>
): Promise<boolean> {
  const normalizedCurrentState = normalizeConversationState(currentState);
  const normalizedNextState = normalizeConversationState(nextState);
  const currentStateJson = stringifyConversationState(normalizedCurrentState);
  const legacyCurrentStateJson = stringifyLegacyConversationState(normalizedCurrentState);

  const result = await prisma.conversationState.updateMany({
    where: {
      senderId,
      channel,
      OR: [
        { stateJson: currentStateJson },
        ...(legacyCurrentStateJson !== currentStateJson
          ? [{ stateJson: legacyCurrentStateJson }]
          : []),
      ],
    },
    data: {
      stateJson: stringifyConversationState(normalizedNextState),
    },
  });

  return result.count === 1;
}

export function clearPendingConversationState(
  state: ConversationStateData
): ConversationStateData {
  return {
    ...DEFAULT_CONVERSATION_STATE,
    lastReferencedOrderId: state.lastReferencedOrderId,
    lastSizeChartCategory: state.lastSizeChartCategory,
    supportMode: state.supportMode,
    lastAssistantReplyKind: state.lastAssistantReplyKind,
    preferredLanguage: state.preferredLanguage,
  };
}
