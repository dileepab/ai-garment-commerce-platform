export interface SupportThreadCustomer {
  id: number;
  name: string;
}

export interface SupportThreadOrder {
  id: number;
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
