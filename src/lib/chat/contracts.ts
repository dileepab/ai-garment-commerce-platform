import type { CustomerLanguage } from './language';

export interface CustomerPageContext {
  path?: string | null;
  product?: {
    slug?: string | null;
    title?: string | null;
    price?: string | number | null;
    selectedSize?: string | null;
    sizes?: string[] | null;
    colors?: string[] | null;
    stock?: string | null;
    soldOut?: boolean | null;
    image?: string | null;
    was?: string | number | null;
  } | null;
}

export interface CustomerMessageInput {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
  customerName?: string;
  customerGender?: string;
  imageUrl?: string;
  /** What the shopper is currently viewing on the storefront (e.g. a PDP), so
   *  references like "this item" can be resolved to the right product. */
  pageContext?: CustomerPageContext | null;
  /**
   * Catalog items the customer put in their cart. These name exact catalog
   * rows, so they override anything inferred from message text — a cart is the
   * least ambiguous thing a shopper can send.
   */
  cart?: Array<{ retailerId: string; quantity: number }>;
}

export interface CustomerQuickReply {
  title: string;
  payload: string;
}

export interface CustomerMessageResult {
  reply: string | null;
  silentReason?: 'support_handoff' | 'human_active';
  imagePath?: string;
  imagePaths?: string[];
  quickReplies?: CustomerQuickReply[];
  carouselProducts?: Array<{
    id: number;
    name: string;
    price: number;
    sizes: string;
    colors: string;
    imageUrl?: string;
    // Catalog retailer id, when the product has a sellable variant. Lets
    // WhatsApp render a real product card instead of a text list.
    retailerId?: string;
  }>;
  orderId?: number | null;
  language?: CustomerLanguage;
}
