import { cleanStoredContactValue } from '@/lib/contact-profile';
import type { ResolvedOrderDraft } from '@/lib/order-draft';
import type { QuantityUpdateSummary } from '@/lib/order-details';

interface OrderProductLike {
  id: number;
  name: string;
  brand?: string | null;
  inventory?: {
    availableQty: number;
  } | null;
}

interface OrderItemLike {
  productId: number;
  quantity: number;
  size?: string | null;
  color?: string | null;
  price: number;
  product: OrderProductLike;
}

interface CustomerLike {
  name?: string | null;
  phone?: string | null;
}

interface OrderLike {
  id: number;
  brand?: string | null;
  orderStatus: string;
  totalAmount: number;
  deliveryAddress?: string | null;
  paymentMethod?: string | null;
  giftWrap: boolean;
  giftNote?: string | null;
  customer: {
    name: string;
    phone?: string | null;
  };
  orderItems: OrderItemLike[];
}

interface ResolveTargetOrderParams {
  explicitOrderId?: number | null;
  followUpMissingOrderId?: number | null;
  aiOrderId?: number | null;
  lastReferencedOrderId?: number | null;
  latestOrder?: OrderLike | null;
  latestActiveOrder?: OrderLike | null;
  preferLatestActive?: boolean;
  preferLatestOrderReference?: boolean;
  findCustomerOrderById: (orderId?: number | null) => Promise<OrderLike | null>;
}

export function getRequestedOrderId(params: {
  explicitOrderId?: number | null;
  followUpMissingOrderId?: number | null;
  aiOrderId?: number | null;
  lastReferencedOrderId?: number | null;
  latestOrderId?: number | null;
}): number | null {
  return (
    params.explicitOrderId ??
    params.followUpMissingOrderId ??
    params.aiOrderId ??
    params.lastReferencedOrderId ??
    params.latestOrderId ??
    null
  );
}

export async function resolveCustomerTargetOrder(
  params: ResolveTargetOrderParams
): Promise<OrderLike | null> {
  if (params.explicitOrderId !== null && params.explicitOrderId !== undefined) {
    return params.findCustomerOrderById(params.explicitOrderId);
  }

  if (params.followUpMissingOrderId !== null && params.followUpMissingOrderId !== undefined) {
    return params.findCustomerOrderById(params.followUpMissingOrderId);
  }

  if (params.aiOrderId !== null && params.aiOrderId !== undefined) {
    return params.findCustomerOrderById(params.aiOrderId);
  }

  if (params.preferLatestOrderReference) {
    if (params.preferLatestActive) {
      return params.latestActiveOrder ?? params.latestOrder ?? null;
    }

    return params.latestOrder ?? params.latestActiveOrder ?? null;
  }

  const referencedOrder = await params.findCustomerOrderById(params.lastReferencedOrderId);

  if (referencedOrder) {
    return referencedOrder;
  }

  if (params.preferLatestActive) {
    return params.latestActiveOrder ?? null;
  }

  return params.latestOrder ?? params.latestActiveOrder ?? null;
}

export function buildReorderDraftFromOrder(params: {
  sourceOrder: OrderLike;
  customer: CustomerLike | null;
  getDeliveryChargeForAddress: (address: string) => number;
  getDeliveryEstimateForAddress: (address: string) => string;
  defaultPaymentMethod?: string;
}): ResolvedOrderDraft {
  const sourceItem = params.sourceOrder.orderItems[0];
  const deliveryAddress = params.sourceOrder.deliveryAddress || '';
  const deliveryCharge = params.getDeliveryChargeForAddress(deliveryAddress);

  return {
    productId: sourceItem.productId,
    productName: sourceItem.product.name,
    brand: params.sourceOrder.brand || sourceItem.product.brand || '',
    quantity: sourceItem.quantity,
    size: sourceItem.size || undefined,
    color: sourceItem.color || undefined,
    price: sourceItem.price,
    deliveryCharge,
    total: sourceItem.price * sourceItem.quantity + deliveryCharge,
    paymentMethod: params.sourceOrder.paymentMethod || params.defaultPaymentMethod || 'COD',
    giftWrap: params.sourceOrder.giftWrap,
    giftNote: params.sourceOrder.giftNote || undefined,
    deliveryEstimate: params.getDeliveryEstimateForAddress(deliveryAddress),
    name: cleanStoredContactValue(params.customer?.name) || params.sourceOrder.customer.name,
    address: deliveryAddress,
    phone:
      cleanStoredContactValue(params.customer?.phone) ||
      params.sourceOrder.customer.phone ||
      '',
  };
}

export function buildQuantityUpdateSummaryFromOrder(params: {
  targetOrder: OrderLike;
  quantity: number;
  deliveryCharge: number;
  defaultPaymentMethod?: string;
}): QuantityUpdateSummary {
  const item = params.targetOrder.orderItems[0];

  return {
    orderId: params.targetOrder.id,
    productName: item.product.name,
    quantity: params.quantity,
    size: item.size,
    color: item.color,
    price: item.price,
    deliveryCharge: params.deliveryCharge,
    total: item.price * params.quantity + params.deliveryCharge,
    paymentMethod: params.targetOrder.paymentMethod || params.defaultPaymentMethod || 'COD',
    name: params.targetOrder.customer.name,
    address: params.targetOrder.deliveryAddress || '',
    phone: params.targetOrder.customer.phone || '',
    giftWrap: params.targetOrder.giftWrap,
    giftNote: params.targetOrder.giftNote,
  };
}
