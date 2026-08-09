import { ConversationMessage } from '@/lib/contact-profile';

export interface CatalogProduct {
  id: number;
  name: string;
  brand: string;
  sku?: string | null;
  price: number;
  sizes: string;
  colors: string;
}

/** One line of an order: a product, a variant of it, and how many. */
export interface OrderDraftItem {
  productId: number;
  productName: string;
  brand: string;
  variantId?: number;
  quantity: number;
  size?: string;
  color?: string;
  price: number;
}

export interface ResolvedOrderDraft {
  productId: number;
  productName: string;
  brand: string;
  variantId?: number;
  requiresExplicitVariantChoice?: boolean;
  /**
   * Items already settled in this order.
   *
   * The top-level product fields describe the item currently being specified,
   * and it comes *after* these — so every prompt, variant check and quantity
   * rule keeps working on one item, while the order as a whole can hold
   * several. Read the full list with draftItems() rather than reaching in here.
   */
  previousItems?: OrderDraftItem[];
  quantity: number;
  size?: string;
  color?: string;
  price: number;
  deliveryCharge: number;
  total: number;
  paymentMethod: string;
  giftWrap: boolean;
  giftNote?: string;
  deliveryEstimate: string;
  name: string;
  address: string;
  streetAddress: string;
  city: string;
  district: string;
  phone: string;
}

export interface ConversationContext {
  messages: ConversationMessage[];
  customerId?: number;
}
