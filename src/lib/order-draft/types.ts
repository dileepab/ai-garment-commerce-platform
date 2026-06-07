import { ConversationMessage } from '@/lib/contact-profile';

export interface CatalogProduct {
  id: number;
  name: string;
  brand: string;
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
