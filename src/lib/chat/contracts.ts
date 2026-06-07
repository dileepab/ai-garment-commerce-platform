import type { CustomerLanguage } from './language';

export interface CustomerMessageInput {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
  customerName?: string;
  customerGender?: string;
  imageUrl?: string;
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
