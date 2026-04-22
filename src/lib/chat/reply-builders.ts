import { getMissingContactFields, type ContactField } from '@/lib/contact-profile';
import type { ConversationStateData } from '@/lib/conversation-state';
import {
  addSriLankaWorkingDays,
  formatSriLankaDisplayDate,
} from '@/lib/delivery-calendar';
import { buildSupportContactAcknowledgement, buildSupportContactLine } from '@/lib/customer-support';
import { getOrderStageLabel } from '@/lib/order-status-display';
import {
  getSizeChartDefinition,
  type SizeChartCategory,
} from '@/lib/size-charts';
import { splitCsv, firstNameOf } from '@/lib/chat/message-utils';

export function buildMissingFieldLabels(missingFields: ContactField[]): string {
  return missingFields
    .map((field) => {
      if (field === 'name') {
        return 'Name:';
      }

      if (field === 'address') {
        return 'Address:';
      }

      return 'Phone Number:';
    })
    .join('\n');
}

export function buildMissingContactPrompt(missingFields: ContactField[]): string {
  return [
    'To proceed with the order, please share:',
    buildMissingFieldLabels(missingFields),
  ].join('\n');
}

export function buildVariantPrompt(
  productName: string,
  size?: string,
  color?: string,
  product?: {
    sizes: string;
    colors: string;
  } | null
): string {
  const prompts: string[] = [];

  if (!size) {
    const sizeOptions = splitCsv(product?.sizes);
    prompts.push(
      sizeOptions.length > 0
        ? `Please let me know the size you need for ${productName}. Available sizes: ${sizeOptions.join(', ')}.`
        : `Please let me know the size you need for ${productName}.`
    );
  }

  if (!color) {
    const colorOptions = splitCsv(product?.colors);
    prompts.push(
      colorOptions.length > 0
        ? `Please let me know the color you need for ${productName}. Available colors: ${colorOptions.join(', ')}.`
        : `Please let me know the color you need for ${productName}.`
    );
  }

  return prompts.join('\n');
}

export function formatCatalogListReply(
  products: Array<{
    name: string;
    price: number;
    sizes: string;
    colors: string;
    inventory?: { availableQty: number } | null;
  }>
): string {
  const availableProducts = products.filter(
    (product) => (product.inventory?.availableQty ?? 0) > 0
  );
  const lines = (availableProducts.length > 0 ? availableProducts : products).map(
    (product) =>
      `${product.name}: Rs ${product.price} (Sizes ${product.sizes || '-'} / Colors: ${
        product.colors || '-'
      })`
  );

  return [
    'We currently have the following items available:',
    '',
    ...lines,
  ].join('\n');
}

export function buildProductQuestionReply(
  product: {
    name: string;
    price: number;
    sizes: string;
    colors: string;
    inventory?: { availableQty: number } | null;
  },
  questionType: 'colors' | 'sizes' | 'price' | 'availability' | null
): string {
  const sizeList = splitCsv(product.sizes);
  const colorList = splitCsv(product.colors);
  const availableQty = product.inventory?.availableQty ?? 0;

  if (questionType === 'colors') {
    return `${product.name} is currently available in ${colorList.join(', ')}.`;
  }

  if (questionType === 'sizes') {
    return `${product.name} is currently available in sizes ${sizeList.join(', ')}.`;
  }

  if (questionType === 'price') {
    return `${product.name} is priced at Rs ${product.price}.`;
  }

  return `${product.name} is currently available for Rs ${product.price}. Sizes: ${sizeList.join(
    ', '
  )}. Colors: ${colorList.join(', ')}. Available stock: ${availableQty}.`;
}

export function buildDeliveryReply(params: {
  address?: string | null;
  referenceDate: Date;
  requestedDate: Date | null;
  isDraft: boolean;
  existingOrderStatus?: string | null;
  getDeliveryEstimateForAddress: (address: string) => string;
}): string {
  const address = params.address?.trim();

  if (!address) {
    return 'Delivery usually takes 1-2 business days within Colombo and 2-3 business days outside Colombo, excluding weekends and Sri Lankan public holidays.';
  }

  const estimate = params.getDeliveryEstimateForAddress(address);
  const businessDays = estimate === '1-2 business days' ? [1, 2] : [2, 3];
  const earliestDate = addSriLankaWorkingDays(params.referenceDate, businessDays[0]);
  const latestDate = addSriLankaWorkingDays(params.referenceDate, businessDays[1]);
  const intro = params.existingOrderStatus
    ? `Order is currently at the ${getOrderStageLabel(
        params.existingOrderStatus
      )} stage. Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`
    : `Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

  if (!params.requestedDate) {
    if (params.isDraft) {
      return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(
        params.referenceDate
      )}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(
        latestDate
      )}.`;
    }

    return `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
      earliestDate
    )} to ${formatSriLankaDisplayDate(latestDate)}.`;
  }

  if (latestDate <= params.requestedDate) {
    return `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
      earliestDate
    )} to ${formatSriLankaDisplayDate(latestDate)}, so it should arrive by ${formatSriLankaDisplayDate(
      params.requestedDate
    )}.`;
  }

  if (params.isDraft) {
    return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(
      params.referenceDate
    )}, delivery before ${formatSriLankaDisplayDate(params.requestedDate)} is not possible.`;
  }

  return `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
    earliestDate
  )} to ${formatSriLankaDisplayDate(latestDate)}, so delivery before ${formatSriLankaDisplayDate(
    params.requestedDate
  )} cannot be guaranteed.`;
}

export function buildGreetingReply(name?: string | null, brand?: string): string {
  const firstName = firstNameOf(name);

  if (firstName) {
    return `Hello ${firstName}. How can I assist you with your ${brand || 'store'} order today?`;
  }

  return `Hello. How can I assist you with your ${brand || 'store'} order today?`;
}

export function buildClarificationReply(state: ConversationStateData): string {
  const supportLine = buildSupportContactLine();

  if (state.pendingStep === 'size_chart_selection') {
    return 'Please tell me which size chart you need: Tops, Dresses, Pants, or Skirts.';
  }

  if (state.pendingStep === 'contact_collection' && state.orderDraft) {
    const missingFields = getMissingContactFields({
      name: state.orderDraft.name,
      address: state.orderDraft.address,
      phone: state.orderDraft.phone,
    });

    return `${buildMissingContactPrompt(missingFields)}\n\nIf you would rather speak to a person, ${supportLine.toLowerCase()}`;
  }

  if (state.pendingStep === 'contact_confirmation') {
    return `Please confirm the delivery details or send the correction you need. If you would rather speak to a person, ${supportLine.toLowerCase()}`;
  }

  if (state.pendingStep === 'order_confirmation') {
    return `Please confirm the order summary or tell me what should be changed. If you would rather speak to a person, ${supportLine.toLowerCase()}`;
  }

  if (state.pendingStep === 'quantity_update_confirmation') {
    return `Please confirm the order update summary or tell me what should be changed. If you would rather speak to a person, ${supportLine.toLowerCase()}`;
  }

  if (state.lastReferencedOrderId) {
    return `I am not fully sure what change you want for order #${state.lastReferencedOrderId}. Please send the exact update you need, or ${supportLine.toLowerCase()}`;
  }

  return `I am not fully sure I understood that. Please send the item name, order ID, or the exact change you need, or ${supportLine.toLowerCase()}`;
}

export function buildAcknowledgementReply(state: ConversationStateData): string {
  const orderId = state.lastReferencedOrderId;

  switch (state.lastAssistantReplyKind) {
    case 'support_contact':
    case 'support_handoff':
    case 'support_waiting':
      return buildSupportContactAcknowledgement({ orderId });
    case 'order_confirmed':
      return orderId
        ? `You are welcome. We will keep you updated on order #${orderId}.`
        : 'You are welcome. We will keep you updated on your order.';
    case 'order_status':
    case 'order_details':
      return orderId
        ? `You are welcome. If you need another update, please mention order #${orderId}.`
        : 'You are welcome. Please let me know if you need another order update.';
    case 'contact_confirmation':
      return 'You are welcome. Please confirm the delivery details whenever you are ready, or send the correction you need.';
    case 'order_summary':
      return 'You are welcome. Please confirm the order summary whenever you are ready, or tell me what should be changed.';
    case 'quantity_prompt':
      return orderId
        ? `You are welcome. Please send the quantity you want for order #${orderId}.`
        : 'You are welcome. Please send the quantity you want.';
    case 'quantity_update_summary':
      return 'You are welcome. Please confirm the order update summary whenever you are ready, or tell me what should be changed.';
    case 'greeting':
    case 'generic':
    default:
      return 'You are welcome. Please let me know if you need anything else.';
  }
}

export function buildMissingOrderLookupReply(
  orderId?: number | null,
  mode: 'details' | 'status' | 'update' | 'cancel' = 'details'
): string {
  if (!orderId) {
    if (mode === 'update') {
      return 'I could not find an active order to update for this conversation.';
    }

    return 'I could not find any orders for this conversation yet.';
  }

  if (mode === 'update') {
    return `I could not find an active order #${orderId} to update for this conversation.`;
  }

  return `I could not find order #${orderId} for this conversation.`;
}

export function buildProductTypeUnavailableReply(category: SizeChartCategory): string {
  const label = getSizeChartDefinition(category).label.toLowerCase();
  return `We do not have any ${label} available right now.`;
}

export function buildSizeChartSelectionReply(categories: SizeChartCategory[]): string {
  const labels = categories.map((category) => getSizeChartDefinition(category).label).join(', ');
  return `Sure. Which item type would you like the size chart for? Available types: ${labels}.`;
}

export function buildSizeChartReply(
  categories: SizeChartCategory[],
  specificProductName?: string | null
): {
  reply: string;
  imagePaths: string[];
} {
  const uniqueCategories = [...new Set(categories)];
  const imagePaths = uniqueCategories.map(
    (category) => getSizeChartDefinition(category).imagePath
  );

  if (specificProductName && uniqueCategories.length === 1) {
    return {
      reply: `Sure. Here is the size chart for ${specificProductName}.`,
      imagePaths,
    };
  }

  if (uniqueCategories.length === 1) {
    const label = getSizeChartDefinition(uniqueCategories[0]).label;
    return {
      reply: `Sure. Here is our ${label} size chart.`,
      imagePaths,
    };
  }

  const labels = uniqueCategories.map((category) => getSizeChartDefinition(category).label);
  const joinedLabels = labels.length === 2 ? `${labels[0]} and ${labels[1]}` : labels.join(', ');

  return {
    reply: `Sure. Here are our ${joinedLabels} size charts.`,
    imagePaths,
  };
}
