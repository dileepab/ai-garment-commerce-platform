export interface CatalogProduct {
  /**
   * Optional because several matchers are handed trimmed product shapes. Set it
   * wherever the chart is sent: without it a customer asking about one dress is
   * answered with the chart for every dress the brand sells.
   */
  id?: number;
  name: string;
  price: number;
  sizes: string;
  colors?: string;
  style?: string;
}

export type SupportIntent =
  | 'order_intake'
  | 'size_chart'
  | 'delivery_charge'
  | 'total'
  | 'online_transfer'
  | 'order_online'
  | 'exchange'
  | 'gift'
  | 'delivery_timing';

export interface ShoppingSupportParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface ShoppingSupportResult {
  handled: boolean;
  reply?: string;
  imagePath?: string;
}
