export interface CustomerMessageInput {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
  customerName?: string;
  customerGender?: string;
  imageUrl?: string;
}

export interface CustomerMessageResult {
  reply: string | null;
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
}
