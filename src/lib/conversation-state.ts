import type { ResolvedOrderDraft } from '@/lib/order-draft';
import type { SizeChartCategory } from '@/lib/size-charts';
import prisma from '@/lib/prisma';

export type PendingConversationStep =
  | 'none'
  | 'size_chart_selection'
  | 'order_draft'
  | 'contact_collection'
  | 'contact_confirmation'
  | 'order_confirmation'
  | 'quantity_update_confirmation';

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

export const DEFAULT_CONVERSATION_STATE: ConversationStateData = {
  pendingStep: 'none',
  orderDraft: null,
  quantityUpdate: null,
  lastReferencedOrderId: null,
  lastMissingOrderId: null,
  lastSizeChartCategory: null,
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
  };
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
      stateJson: JSON.stringify(normalizedState),
    },
    update: {
      stateJson: JSON.stringify(normalizedState),
    },
  });

  return normalizedState;
}

export function clearPendingConversationState(
  state: ConversationStateData
): ConversationStateData {
  return {
    ...DEFAULT_CONVERSATION_STATE,
    lastReferencedOrderId: state.lastReferencedOrderId,
    lastSizeChartCategory: state.lastSizeChartCategory,
  };
}
