import { cleanStoredContactName, cleanStoredContactValue } from '@/lib/contact-profile';
import { withDraftTotal, type ResolvedOrderDraft } from '@/lib/order-draft';
import type { QuantityUpdateSummary } from '@/lib/order-details';

interface OrderProductLike {
  id: number;
  name: string;
  brand?: string | null;
  inventory?: {
    availableQty: number;
  } | null;
  variants?: Array<{
    size: string;
    color: string;
    inventory?: { availableQty: number } | null;
  }>;
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
  courierProcessedAt?: Date | string | null;
  totalAmount: number;
  deliveryAddress?: string | null;
  deliveryStreetAddress?: string | null;
  deliveryCity?: string | null;
  deliveryDistrict?: string | null;
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
  // Reordering brings back the whole order. The last item takes the top-level
  // fields because that is the slot the draft flow edits; the earlier ones ride
  // along in order. Reordering only the first line of a two-dress order would
  // quietly halve it.
  const orderBrand = params.sourceOrder.brand || '';
  const sourceItems = params.sourceOrder.orderItems;
  const sourceItem = sourceItems[sourceItems.length - 1];
  const earlierItems = sourceItems.slice(0, -1).map((item) => ({
    productId: item.productId,
    productName: item.product.name,
    brand: orderBrand || item.product.brand || '',
    quantity: item.quantity,
    ...(item.size ? { size: item.size } : {}),
    ...(item.color ? { color: item.color } : {}),
    price: item.price,
  }));
  const deliveryAddress = params.sourceOrder.deliveryAddress || '';
  const streetAddress = params.sourceOrder.deliveryStreetAddress || '';
  const city = params.sourceOrder.deliveryCity || '';
  const district = params.sourceOrder.deliveryDistrict || '';
  const deliveryCharge = params.getDeliveryChargeForAddress(deliveryAddress);

  return withDraftTotal({
    productId: sourceItem.productId,
    productName: sourceItem.product.name,
    brand: orderBrand || sourceItem.product.brand || '',
    ...(earlierItems.length > 0 ? { previousItems: earlierItems } : {}),
    quantity: sourceItem.quantity,
    size: sourceItem.size || undefined,
    color: sourceItem.color || undefined,
    price: sourceItem.price,
    deliveryCharge,
    total: 0,
    paymentMethod: params.sourceOrder.paymentMethod || params.defaultPaymentMethod || 'COD',
    giftWrap: params.sourceOrder.giftWrap,
    giftNote: params.sourceOrder.giftNote || undefined,
    deliveryEstimate: params.getDeliveryEstimateForAddress(deliveryAddress),
    name:
      cleanStoredContactName(params.customer?.name) ||
      cleanStoredContactName(params.sourceOrder.customer.name),
    address: deliveryAddress,
    streetAddress,
    city,
    district,
    phone:
      cleanStoredContactValue(params.customer?.phone) ||
      params.sourceOrder.customer.phone ||
      '',
  });
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
