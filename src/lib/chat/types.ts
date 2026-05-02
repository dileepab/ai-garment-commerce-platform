import type {
  Customer,
  Inventory,
  Order,
  OrderItem,
  Product,
} from '@prisma/client';
import type { AiRoutedAction } from '@/lib/ai-action-router';
import type {
  AssistantReplyKind,
  ConversationStateData,
} from '@/lib/conversation-state';
import type {
  ContactDetails,
} from '@/lib/contact-profile';
import type { SupportIssueReason } from '@/lib/customer-support';
import type { ResolvedOrderDraft } from '@/lib/order-draft';
import type { MerchantSettings } from '@/lib/runtime-config';
import type { SizeChartCategory } from '@/lib/size-charts';
import type {
  CustomerMessageInput,
  CustomerMessageResult,
} from './contracts';

export type ChatProduct = Product & {
  inventory: Inventory | null;
};

export type ChatOrderItem = OrderItem & {
  product: ChatProduct;
};

export type ChatOrder = Order & {
  customer: Customer;
  orderItems: ChatOrderItem[];
};

export type ChatCustomer = Customer & {
  orders: ChatOrder[];
};

export interface FinalizeReplyParams {
  reply: string | null;
  nextState?: Partial<ConversationStateData>;
  imagePath?: string;
  imagePaths?: string[];
  carouselProducts?: Array<{
    id: number;
    name: string;
    price: number;
    sizes: string;
    colors: string;
    imageUrl?: string;
  }>;
  orderId?: number | null;
  assistantReplyKind?: AssistantReplyKind;
}

export interface ChatHelpers {
  findProductByName: (name: string | null) => ChatProduct | null;
  findCustomerOrderById: (orderId?: number | null) => Promise<ChatOrder | null>;
  buildDraftFromSource: (
    product: ChatProduct,
    previousDraft?: ResolvedOrderDraft | null
  ) => ResolvedOrderDraft;
  finalizeReply: (params: FinalizeReplyParams) => Promise<CustomerMessageResult>;
  escalateToSupport: (
    reason: SupportIssueReason,
    orderId?: number | null
  ) => Promise<CustomerMessageResult>;
  clearPendingConversationState: (
    state: ConversationStateData
  ) => ConversationStateData;
}

export interface ChatContext {
  input: CustomerMessageInput;
  state: ConversationStateData;
  customer: ChatCustomer | null;
  brandFilter: string | undefined;
  globalProducts: ChatProduct[];
  products: ChatProduct[];
  latestOrder: ChatOrder | null;
  latestActiveOrder: ChatOrder | null;
  latestAssistantText: string;
  explicitOrderId: number | null;
  requestedProductTypes: SizeChartCategory[];
  followUpMissingOrderId: number | null;
  mergedContact: ContactDetails;
  aiAction: AiRoutedAction;
  settings: MerchantSettings;
  helpers: ChatHelpers;
}
