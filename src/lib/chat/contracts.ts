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
  }>;
  orderId?: number | null;
  language?: CustomerLanguage;
}
