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

export interface ResolvedOrderDraft {
  productId: number;
  productName: string;
  brand: string;
  variantId?: number;
  requiresExplicitVariantChoice?: boolean;
  /**
   * Set when this draft is the next item off a cart, naming the order already
   * confirmed in the same run. Declining this draft must not read as if that
   * order went away too.
   */
  precededByOrderId?: number;
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
