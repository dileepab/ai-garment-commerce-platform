import type { PendingConversationStep } from '@/lib/conversation-state';
import type { SizeChartCategory } from '@/lib/size-charts';

export const ROUTED_ACTIONS = [
  'greeting',
  'catalog_list',
  'product_question',
  'size_chart',
  'place_order',
  'confirm_pending',
  'cancel_order',
  'reorder_last',
  'order_status',
  'order_details',
  'update_order_contact',
  'update_order_quantity',
  'delivery_question',
  'payment_question',
  'exchange_question',
  'gift_request',
  'support_contact_request',
  'thanks_acknowledgement',
  'fallback',
] as const;

export const PRODUCT_QUESTION_TYPES = ['colors', 'sizes', 'price', 'availability'] as const;
export const PAYMENT_METHODS = ['COD', 'Online Transfer'] as const;
export const PRODUCT_TYPES = ['tops', 'dresses', 'pants', 'skirts'] as const;

export type RoutedActionType = (typeof ROUTED_ACTIONS)[number];

export interface AiRoutedAction {
  action: RoutedActionType;
  confidence: number;
  orderId: number | null;
  productName: string | null;
  productType: SizeChartCategory | null;
  questionType: (typeof PRODUCT_QUESTION_TYPES)[number] | null;
  quantity: number | null;
  size: string | null;
  color: string | null;
  paymentMethod: (typeof PAYMENT_METHODS)[number] | null;
  giftWrap: boolean | null;
  giftNote: string | null;
  requestedDate: string | null;
  deliveryLocation: string | null;
  contact: {
    name: string | null;
    address: string | null;
    phone: string | null;
  };
}

export interface RouterProductContext {
  name: string;
  style: string;
  price: number;
  sizes: string;
  colors: string;
  availableQty: number;
}

export interface RouterInput {
  brand?: string;
  currentMessage: string;
  pendingStep: PendingConversationStep;
  knownContact: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  lastReferencedOrderId?: number | null;
  latestOrderId?: number | null;
  latestActiveOrderId?: number | null;
  recentMessages: Array<{
    role: string;
    message: string;
  }>;
  products: RouterProductContext[];
  imageUrl?: string;
}

export interface ModelError {
  status?: number;
}
