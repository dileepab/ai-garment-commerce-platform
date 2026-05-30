export interface SupportThreadCustomer {
  id: number;
  name: string;
}

export interface SupportThreadOrder {
  id: number;
  orderStatus: string;
  totalAmount: number;
  paymentMethod: string | null;
  deliveryAddress: string | null;
  trackingNumber: string | null;
  courier: string | null;
  brand: string | null;
  createdAt: string;
  items: Array<{
    id: number;
    productName: string;
    style: string | null;
    size: string | null;
    color: string | null;
    quantity: number;
  }>;
  returnRequests: Array<{
    id: number;
    type: string;
    status: string;
    reason: string;
  }>;
}

export interface SupportThreadMessage {
  id: number;
  role: string;
  message: string;
  createdAt: string;
  createdAtLabel: string;
}

export interface SupportThread {
  id: number;
  senderId: string;
  channel: string;
  customerId: number | null;
  customer: SupportThreadCustomer | null;
  orderId: number | null;
  order: SupportThreadOrder | null;
  recentOrders: SupportThreadOrder[];
  brand: string | null;
  reason: string;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  latestCustomerMessage: string | null;
  summary: string;
  createdAt: string;
  updatedAt: string;
  updatedAtLabel: string;
  resolvedAt: string | null;
  wait?: string | null;
  hasOlderMessages: boolean;
  messages: SupportThreadMessage[];
}

export interface SupportStats {
  open: number;
  linkedOrders: number;
  dateLabel: string;
}
