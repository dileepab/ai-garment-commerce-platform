import prisma from '@/lib/prisma';
import { isClearConfirmation } from '@/lib/order-confirmation';
import { OrderRequestError, updateSingleItemOrderQuantityById } from '@/lib/orders';
import { getDeliveryChargeForAddress } from '@/lib/order-draft';

interface OrderQuantityUpdateParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface OrderQuantityUpdateResult {
  handled: boolean;
  reply?: string;
  orderId?: number;
}

const UPDATE_REQUEST_PATTERNS = [
  /\b(?:increase|decrease|reduce|lower|change|update|edit|set)\b.*\b(?:order count|quantity)\b/i,
  /\b(?:increase|decrease|reduce|lower|change|update|edit|set)\b.*\bto\s+\d+\b/i,
  /\b(?:last|previous)\s+order\b.*\b(?:to|as)\s+\d+\b/i,
  /\b(?:make|set)\b.*\b(?:quantity|order count)\b.*\d+\b/i,
];

const UPDATE_SUMMARY_PATTERN = /^order update summary$/im;

function looksLikeQuantityUpdateRequest(message: string): boolean {
  return UPDATE_REQUEST_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRequestedQuantity(message: string): number | null {
  const patterns = [
    /\b(?:quantity|order count)\b.*?\bto\s+(\d+)\b/i,
    /\b(?:increase|decrease|reduce|lower|change|update|make|set)\b.*?\bto\s+(\d+)\b/i,
    /\bto\s+(\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const quantity = Number.parseInt(match[1], 10);

    if (Number.isInteger(quantity) && quantity > 0) {
      return quantity;
    }
  }

  return null;
}

function extractStandaloneQuantity(message: string): number | null {
  const normalizedMessage = normalizeMessage(message);
  const patterns = [
    /^(\d+)$/,
    /^(\d+)\s*(?:items?|pieces?|pcs?)$/,
    /^(?:make it|set it|update it|change it|reduce it to|lower it to|decrease it to|do)\s+(\d+)$/,
  ];

  for (const pattern of patterns) {
    const match = normalizedMessage.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const quantity = Number.parseInt(match[1], 10);

    if (Number.isInteger(quantity) && quantity > 0) {
      return quantity;
    }
  }

  return null;
}

function isQuantityFollowUpPrompt(message: string): boolean {
  return /please send (?:a )?lower quantity|please tell me the quantity you want/i.test(message);
}

function extractRequestedOrderId(message: string): number | null {
  const hashMatch = message.match(/#(\d+)/);

  if (hashMatch?.[1]) {
    return Number.parseInt(hashMatch[1], 10);
  }

  const orderMatch = message.match(/\border\s+(\d+)\b/i);

  if (orderMatch?.[1]) {
    return Number.parseInt(orderMatch[1], 10);
  }

  return null;
}

function extractValueFromSummary(summary: string, label: string): string | null {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, 'im');
  const match = summary.match(pattern);
  return match?.[1]?.trim() || null;
}

function isOrderUpdateSummaryMessage(message: string): boolean {
  return UPDATE_SUMMARY_PATTERN.test(message);
}

function buildUpdateSummaryReply(params: {
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
  phone?: string | null;
  giftWrap?: boolean;
  giftNote?: string | null;
}): string {
  const specialInstructions = [
    params.giftWrap ? 'Gift wrap requested' : '',
    params.giftNote ? `Gift Note: ${params.giftNote}` : '',
  ].filter(Boolean);

  return [
    'Order Update Summary',
    `Order ID: #${params.orderId}`,
    `Product: ${params.productName}`,
    `Quantity: ${params.quantity}`,
    `Size: ${params.size || 'Not specified'}`,
    `Color: ${params.color || 'Not specified'}`,
    `Price: Rs ${params.price}`,
    `Delivery Charge: Rs ${params.deliveryCharge}`,
    `Total: Rs ${params.total}`,
    `Payment Method: ${params.paymentMethod || 'COD'}`,
    `Name: ${params.name}`,
    `Address: ${params.address}`,
    `Phone Number: ${params.phone || ''}`,
    ...specialInstructions,
    '',
    'Is this update correct? Please let me know if any changes are needed.',
  ].join('\n');
}

function buildUpdateSuccessReply(params: {
  orderId: number;
  productName: string;
  quantity: number;
  total: number;
  paymentMethod?: string | null;
  name: string;
  address: string;
  phone?: string | null;
  giftWrap?: boolean;
  giftNote?: string | null;
}): string {
  const specialInstructions = [
    params.giftWrap ? 'Gift wrap requested' : '',
    params.giftNote ? `Gift Note: ${params.giftNote}` : '',
  ].filter(Boolean);

  return [
    'Thank you. Your order has been updated successfully ✅',
    '',
    `Order ID: #${params.orderId}`,
    `Product: ${params.productName}`,
    `Quantity: ${params.quantity}`,
    `Total: Rs ${params.total}`,
    `Payment Method: ${params.paymentMethod || 'COD'}`,
    `Name: ${params.name}`,
    `Address: ${params.address}`,
    `Phone Number: ${params.phone || ''}`,
    ...specialInstructions,
    '',
    'We will contact you shortly with the next update.',
  ].join('\n');
}

async function saveConversationPair(
  senderId: string,
  channel: string,
  userMessage: string,
  assistantReply: string
) {
  await prisma.chatMessage.createMany({
    data: [
      {
        senderId,
        channel,
        role: 'user',
        message: userMessage,
      },
      {
        senderId,
        channel,
        role: 'assistant',
        message: assistantReply,
      },
    ],
  });
}

export async function tryHandleOrderQuantityUpdateRequest(
  params: OrderQuantityUpdateParams
): Promise<OrderQuantityUpdateResult> {
  const latestAssistantMessage = await prisma.chatMessage.findFirst({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      role: 'assistant',
    },
    orderBy: { createdAt: 'desc' },
    select: { message: true },
  });

  const quantityFollowUp = isQuantityFollowUpPrompt(latestAssistantMessage?.message || '');

  if (!looksLikeQuantityUpdateRequest(params.currentMessage) && !quantityFollowUp) {
    return { handled: false };
  }

  const requestedQuantity =
    extractRequestedQuantity(params.currentMessage) ||
    (quantityFollowUp ? extractStandaloneQuantity(params.currentMessage) : null);
  const requestedOrderId = extractRequestedOrderId(params.currentMessage);

  if (!requestedQuantity) {
    const reply = 'Please tell me the quantity you want for your last order, and I will prepare the update summary.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const customer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    const reply = 'I could not find an active order to update for this conversation.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const latestOrder = await prisma.order.findFirst({
    where: {
      customerId: customer.id,
      ...(requestedOrderId ? { id: requestedOrderId } : {}),
      ...(params.brand ? { brand: params.brand } : {}),
      orderStatus: { not: 'cancelled' },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      orderItems: {
        include: {
          product: {
            include: {
              inventory: true,
            },
          },
        },
      },
    },
  });

  if (!latestOrder || latestOrder.orderItems.length === 0) {
    const reply = requestedOrderId
      ? `I could not find an active order #${requestedOrderId} to update for this conversation.`
      : 'I could not find an active order to update for this conversation.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  if (latestOrder.orderItems.length !== 1) {
    const reply =
      'Automatic quantity updates are only available for single-item orders right now. Please contact us and we will help you manually.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const item = latestOrder.orderItems[0];

  if (requestedQuantity === item.quantity) {
    const reply = `Order #${latestOrder.id} already has quantity ${item.quantity}. Please send a different quantity if you want to update it.`;
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return {
      handled: true,
      reply,
      orderId: latestOrder.id,
    };
  }

  const maxAvailableQuantity = item.quantity + (item.product.inventory?.availableQty || 0);

  if (requestedQuantity > maxAvailableQuantity) {
    const reply = `I can update order #${latestOrder.id} up to ${maxAvailableQuantity} item(s) based on current stock. Please send a lower quantity.`;
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return {
      handled: true,
      reply,
      orderId: latestOrder.id,
    };
  }

  const deliveryCharge = getDeliveryChargeForAddress(latestOrder.deliveryAddress || '');
  const reply = buildUpdateSummaryReply({
    orderId: latestOrder.id,
    productName: item.product.name,
    quantity: requestedQuantity,
    size: item.size,
    color: item.color,
    price: item.price,
    deliveryCharge,
    total: item.price * requestedQuantity + deliveryCharge,
    paymentMethod: latestOrder.paymentMethod,
    name: customer.name,
    address: latestOrder.deliveryAddress || '',
    phone: customer.phone,
    giftWrap: latestOrder.giftWrap,
    giftNote: latestOrder.giftNote,
  });

  await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
  return {
    handled: true,
    reply,
    orderId: latestOrder.id,
  };
}

export async function tryConfirmOrderQuantityUpdate(
  params: OrderQuantityUpdateParams
): Promise<OrderQuantityUpdateResult> {
  if (!isClearConfirmation(params.currentMessage)) {
    return { handled: false };
  }

  const latestAssistantMessage = await prisma.chatMessage.findFirst({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      role: 'assistant',
    },
    orderBy: { createdAt: 'desc' },
    select: { message: true },
  });

  const assistantText = latestAssistantMessage?.message || '';

  if (!isOrderUpdateSummaryMessage(assistantText)) {
    return { handled: false };
  }

  const orderIdText = extractValueFromSummary(assistantText, 'Order ID');
  const quantityText = extractValueFromSummary(assistantText, 'Quantity');

  const orderId = orderIdText ? Number.parseInt(orderIdText.replace('#', ''), 10) : NaN;
  const nextQuantity = quantityText ? Number.parseInt(quantityText, 10) : NaN;

  if (!Number.isInteger(orderId) || !Number.isInteger(nextQuantity) || nextQuantity <= 0) {
    const reply = 'Sorry, I could not read the requested order update. Please send the quantity once more.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const customer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
    select: { id: true },
  });

  if (!customer) {
    const reply = 'I could not find the customer record for this order update.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const ownedOrder = await prisma.order.findFirst({
    where: {
      id: orderId,
      customerId: customer.id,
      ...(params.brand ? { brand: params.brand } : {}),
    },
    select: { id: true },
  });

  if (!ownedOrder) {
    const reply = `I could not find order #${orderId} for this conversation.`;
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  try {
    const updatedOrder = await updateSingleItemOrderQuantityById(prisma, orderId, nextQuantity);
    const updatedItem = updatedOrder.orderItems[0];
    const deliveryCharge = getDeliveryChargeForAddress(updatedOrder.deliveryAddress || '');
    const reply = buildUpdateSuccessReply({
      orderId: updatedOrder.id,
      productName: updatedItem.product.name,
      quantity: updatedItem.quantity,
      total: updatedItem.price * updatedItem.quantity + deliveryCharge,
      paymentMethod: updatedOrder.paymentMethod,
      name: updatedOrder.customer.name,
      address: updatedOrder.deliveryAddress || '',
      phone: updatedOrder.customer.phone,
      giftWrap: updatedOrder.giftWrap,
      giftNote: updatedOrder.giftNote,
    });

    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return {
      handled: true,
      reply,
      orderId: updatedOrder.id,
    };
  } catch (error: unknown) {
    const message =
      error instanceof OrderRequestError
        ? error.message
        : 'Please contact us directly so we can help update it manually.';
    const reply = `Sorry, I could not update the order automatically. ${message}`;
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return {
      handled: true,
      reply,
    };
  }
}
