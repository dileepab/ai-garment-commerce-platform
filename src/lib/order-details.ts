import type { ResolvedOrderDraft } from '@/lib/order-draft';
import { getDeliveryChargeForAddress } from '@/lib/order-draft';
import {
  buildSupportContactLine,
  buildSupportContactLineFromConfig,
  type SupportContactConfig,
} from '@/lib/customer-support';
import type { MerchantDeliverySettings } from '@/lib/runtime-config';
import {
  getOrderStageLabel,
  getOrderStageNote,
  normalizeOrderStatus,
} from '@/lib/order-status-display';

interface OrderItemLike {
  product: {
    name: string;
  };
  quantity: number;
  size?: string | null;
  color?: string | null;
  price: number;
}

interface OrderLike {
  id: number;
  orderStatus: string;
  totalAmount: number;
  paymentMethod?: string | null;
  deliveryAddress?: string | null;
  trackingNumber?: string | null;
  courier?: string | null;
  giftWrap: boolean;
  giftNote?: string | null;
  customer: {
    name: string;
    phone?: string | null;
  };
  orderItems: OrderItemLike[];
}

export interface QuantityUpdateSummary {
  orderId: number;
  productName: string;
  quantity: number;
  size?: string | null;
  color?: string | null;
  price: number;
  deliveryCharge: number;
  total: number;
  paymentMethod?: string | null;
  name: string;
  address: string;
  phone: string;
  giftWrap: boolean;
  giftNote?: string | null;
}

interface OrderStatusLike {
  id: number;
  orderStatus: string;
  trackingNumber?: string | null;
  courier?: string | null;
}

function formatSizeForDisplay(size?: string | null): string {
  if (!size) {
    return 'Not specified';
  }

  const normalized = size.trim().toUpperCase();
  const labels: Record<string, string> = {
    XS: 'Extra Small',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    XL: 'Extra Large',
    XXL: 'Double Extra Large',
  };

  return labels[normalized] || size;
}

function formatColorForDisplay(color?: string | null): string {
  return color?.trim() || 'Not specified';
}

function buildSpecialInstructions(giftWrap: boolean, giftNote?: string | null): string[] {
  return [
    giftWrap ? 'Gift wrap requested' : '',
    giftNote ? `Gift Note: ${giftNote}` : '',
  ].filter(Boolean);
}

export function buildOrderStatusReply(orderId: number, status: string): string {
  return [
    `Order #${orderId} is currently at the ${getOrderStageLabel(status)} stage.`,
    getOrderStageNote(status),
  ].join(' ');
}

function buildTrackingLine(order: Pick<OrderStatusLike, 'orderStatus' | 'trackingNumber' | 'courier'>): string {
  const tracking = order.trackingNumber?.trim();
  const courier = order.courier?.trim();

  if (tracking && courier) {
    return `Tracking: ${tracking} via ${courier}.`;
  }

  if (tracking) {
    return `Tracking number: ${tracking}.`;
  }

  if (courier) {
    return `Courier: ${courier}.`;
  }

  const status = normalizeOrderStatus(order.orderStatus);
  return ['dispatched', 'delivered', 'delivery_failed'].includes(status)
    ? 'Tracking details are not available yet.'
    : '';
}

export function buildSelfServiceOrderStatusReply(order: OrderStatusLike): string {
  return [
    buildOrderStatusReply(order.id, order.orderStatus),
    buildTrackingLine(order),
  ].filter(Boolean).join(' ');
}

export function buildCancellationSuccessReply(orderId: number): string {
  return [
    'Your order has been cancelled successfully.',
    '',
    `Cancelled Order ID: #${orderId}`,
    'The reserved stock has been returned to inventory.',
  ].join('\n');
}

export function buildOrderAlreadyCancelledReply(orderId: number): string {
  return `Order #${orderId} is already cancelled.`;
}

export function calculateOrderDeliveryCharge(
  order: Pick<OrderLike, 'deliveryAddress'>,
  deliverySettings?: MerchantDeliverySettings
): number {
  return getDeliveryChargeForAddress(order.deliveryAddress || '', deliverySettings);
}

export function calculateOrderGrandTotal(
  order: Pick<OrderLike, 'totalAmount' | 'deliveryAddress'>,
  deliverySettings?: MerchantDeliverySettings
): number {
  return order.totalAmount + calculateOrderDeliveryCharge(order, deliverySettings);
}

export function buildOrderPlacedReply(
  draft: ResolvedOrderDraft,
  orderId: number,
  supportConfig?: SupportContactConfig
): string {
  const specialInstructions = buildSpecialInstructions(draft.giftWrap, draft.giftNote);
  const supportLine = supportConfig
    ? buildSupportContactLineFromConfig(supportConfig, { orderId })
    : buildSupportContactLine({ orderId });

  return [
    'Thank you. Your order has been confirmed successfully ✅',
    '',
    `Order ID: #${orderId}`,
    `Product: ${draft.productName}`,
    `Quantity: ${draft.quantity}`,
    `Total: Rs ${draft.total}`,
    `Payment Method: ${draft.paymentMethod}`,
    `Name: ${draft.name}`,
    `Address: ${draft.address}`,
    `Phone Number: ${draft.phone}`,
    `Current Stage: ${getOrderStageLabel('confirmed')}`,
    ...specialInstructions,
    '',
    'Next Step: Our team will prepare your parcel for packing.',
    `Need help? ${supportLine}`,
  ].join('\n');
}

export function buildQuantityUpdateSummaryReply(summary: QuantityUpdateSummary): string {
  const specialInstructions = buildSpecialInstructions(summary.giftWrap, summary.giftNote);

  return [
    'Order Update Summary',
    `Order ID: #${summary.orderId}`,
    `Product: ${summary.productName}`,
    `Quantity: ${summary.quantity}`,
    `Size: ${formatSizeForDisplay(summary.size)}`,
    `Color: ${formatColorForDisplay(summary.color)}`,
    `Price: Rs ${summary.price}`,
    `Delivery Charge: Rs ${summary.deliveryCharge}`,
    `Total: Rs ${summary.total}`,
    `Payment Method: ${summary.paymentMethod || 'COD'}`,
    `Name: ${summary.name}`,
    `Address: ${summary.address}`,
    `Phone Number: ${summary.phone}`,
    ...specialInstructions,
    '',
    'Reply "yes" to apply the update, or tell me what to change.',
  ].join('\n');
}

export function buildQuantityUpdateSuccessReply(
  summary: QuantityUpdateSummary,
  supportConfig?: SupportContactConfig
): string {
  const specialInstructions = buildSpecialInstructions(summary.giftWrap, summary.giftNote);
  const supportLine = supportConfig
    ? buildSupportContactLineFromConfig(supportConfig, { orderId: summary.orderId })
    : buildSupportContactLine({ orderId: summary.orderId });

  return [
    'Thank you. Your order has been updated successfully ✅',
    '',
    `Order ID: #${summary.orderId}`,
    `Product: ${summary.productName}`,
    `Quantity: ${summary.quantity}`,
    `Total: Rs ${summary.total}`,
    `Payment Method: ${summary.paymentMethod || 'COD'}`,
    `Name: ${summary.name}`,
    `Address: ${summary.address}`,
    `Phone Number: ${summary.phone}`,
    `Current Stage: ${getOrderStageLabel('confirmed')}`,
    ...specialInstructions,
    '',
    'Next Step: We will continue processing this order with the updated quantity.',
    `Need help? ${supportLine}`,
  ].join('\n');
}

export function buildOrderContactUpdateSuccessReply(params: {
  orderId: number;
  address?: string | null;
  phone?: string | null;
}): string {
  return [
    `I have updated order #${params.orderId}.`,
    params.address ? `Address: ${params.address}` : '',
    params.phone ? `Phone Number: ${params.phone}` : '',
  ].filter(Boolean).join('\n');
}

function buildActualOrderLineItems(order: OrderLike): string[] {
  if (order.orderItems.length === 1) {
    const item = order.orderItems[0];

    return [
      `Product: ${item.product.name}`,
      `Quantity: ${item.quantity}`,
      `Size: ${formatSizeForDisplay(item.size)}`,
      `Color: ${formatColorForDisplay(item.color)}`,
      `Price: Rs ${item.price}`,
    ];
  }

  return [
    `Items: ${order.orderItems
      .map(
        (item) =>
          `${item.product.name} x${item.quantity} (${formatSizeForDisplay(item.size)}, ${formatColorForDisplay(
            item.color
          )})`
      )
      .join('; ')}`,
  ];
}

export function buildOrderDetailsReply(
  order: OrderLike,
  deliverySettings?: MerchantDeliverySettings
): string {
  const deliveryCharge = calculateOrderDeliveryCharge(order, deliverySettings);
  const total = calculateOrderGrandTotal(order, deliverySettings);
  const specialInstructions = buildSpecialInstructions(order.giftWrap, order.giftNote);
  const trackingLine = buildTrackingLine(order);

  return [
    'Order Details',
    `Order ID: #${order.id}`,
    `Status: ${getOrderStageLabel(order.orderStatus)}`,
    getOrderStageNote(order.orderStatus),
    ...buildActualOrderLineItems(order),
    `Delivery Charge: Rs ${deliveryCharge}`,
    `Total: Rs ${total}`,
    `Payment Method: ${order.paymentMethod || 'COD'}`,
    `Name: ${order.customer.name}`,
    `Address: ${order.deliveryAddress || 'Not provided'}`,
    `Phone Number: ${order.customer.phone || ''}`,
    trackingLine,
    ...specialInstructions,
  ].filter(Boolean).join('\n');
}
