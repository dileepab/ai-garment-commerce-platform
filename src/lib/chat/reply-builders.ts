import { getMissingContactFields, type ContactField } from '@/lib/contact-profile';
import type { ConversationStateData } from '@/lib/conversation-state';
import {
  addSriLankaWorkingDays,
  formatSriLankaDisplayDate,
} from '@/lib/delivery-calendar';
import {
  buildSupportContactAcknowledgement,
  buildSupportContactLine,
  buildSupportContactLineFromConfig,
  type SupportContactConfig,
} from '@/lib/customer-support';
import { getOrderStageLabel } from '@/lib/order-status-display';
import {
  getSizeChartDefinition,
  type SizeChartCategory,
} from '@/lib/size-charts';
import { getBusinessDayRangeFromEstimate } from '@/lib/order-draft';
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
    variants?: Array<{ size: string; color: string; inventory?: { availableQty: number } | null }>;
  } | null
): string {
  const prompts: string[] = [];
  const availableVariants = product?.variants?.filter(
    (v) => (v.inventory?.availableQty ?? 0) > 0
  ) ?? [];

  if (!size) {
    const variantSizes =
      availableVariants.length > 0
        ? [...new Set(availableVariants.map((v) => v.size))]
        : [];
    const sizeOptions = variantSizes.length > 0 ? variantSizes : splitCsv(product?.sizes);
    prompts.push(
      sizeOptions.length > 0
        ? `Please let me know the size you need for ${productName}. Available sizes: ${sizeOptions.join(', ')}.`
        : `Please let me know the size you need for ${productName}.`
    );
  }

  if (!color) {
    const variantColors =
      availableVariants.length > 0
        ? [...new Set(availableVariants.map((v) => v.color))]
        : [];
    const colorOptions = variantColors.length > 0 ? variantColors : splitCsv(product?.colors);
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
    variants?: Array<{ size: string; color: string; inventory?: { availableQty: number } | null }>;
  },
  questionType: 'colors' | 'sizes' | 'price' | 'availability' | null
): string {
  const availableVariants = product.variants?.filter(
    (v) => (v.inventory?.availableQty ?? 0) > 0
  ) ?? [];

  const sizeList =
    availableVariants.length > 0
      ? [...new Set(availableVariants.map((v) => v.size))]
      : splitCsv(product.sizes);
  const colorList =
    availableVariants.length > 0
      ? [...new Set(availableVariants.map((v) => v.color))]
      : splitCsv(product.colors);
  const availableQty =
    availableVariants.length > 0
      ? availableVariants.reduce((sum, v) => sum + (v.inventory?.availableQty ?? 0), 0)
      : (product.inventory?.availableQty ?? 0);

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
  defaultDeliveryText?: string;
}): string {
  const address = params.address?.trim();

  if (!address) {
    return params.defaultDeliveryText ||
      'Delivery usually takes 1-2 business days within Colombo and 2-3 business days outside Colombo, excluding weekends and Sri Lankan public holidays.';
  }

  const estimate = params.getDeliveryEstimateForAddress(address);
  const businessDays = getBusinessDayRangeFromEstimate(estimate);
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

export function buildClarificationReply(
  state: ConversationStateData,
  supportConfig?: SupportContactConfig
): string {
  const supportLine = supportConfig
    ? buildSupportContactLineFromConfig(supportConfig)
    : buildSupportContactLine();

  if (state.pendingStep === 'size_chart_selection') {
    return 'Could you tell me which size chart you need — Tops, Dresses, Pants, or Skirts?';
  }

  if (state.pendingStep === 'contact_collection' && state.orderDraft) {
    const missingFields = getMissingContactFields({
      name: state.orderDraft.name,
      address: state.orderDraft.address,
      phone: state.orderDraft.phone,
    });

    return `${buildMissingContactPrompt(missingFields)}\n\nIf you would rather speak to someone from our team, ${supportLine.toLowerCase()}`;
  }

  if (state.pendingStep === 'contact_confirmation') {
    return `Just to confirm — are the delivery details above correct, or is there something to change? If you would rather speak to someone from our team, ${supportLine.toLowerCase()}`;
  }

  if (state.pendingStep === 'order_confirmation') {
    return `Just to confirm — should I go ahead with the order summary above, or is there something to change? If you would rather speak to someone from our team, ${supportLine.toLowerCase()}`;
  }

  if (state.pendingStep === 'quantity_update_confirmation') {
    return `Just to confirm — should I apply the order update above, or is there something to change? If you would rather speak to someone from our team, ${supportLine.toLowerCase()}`;
  }

  if (state.lastReferencedOrderId) {
    return `Sorry, I want to make sure I get this right for order #${state.lastReferencedOrderId}. Could you tell me the exact change you need? Or ${supportLine.toLowerCase()}`;
  }

  return `Sorry, I didn't quite catch that. Could you share the item name, order ID, or the change you need? Or ${supportLine.toLowerCase()}`;
}

export function buildAcknowledgementReply(
  state: ConversationStateData,
  supportConfig?: SupportContactConfig
): string {
  const orderId = state.lastReferencedOrderId;

  switch (state.lastAssistantReplyKind) {
    case 'support_contact':
    case 'support_handoff':
    case 'support_waiting':
      return buildSupportContactAcknowledgement({ orderId, supportConfig });
    case 'order_confirmed':
      return orderId
        ? `You are welcome. We'll keep you posted on order #${orderId}.`
        : "You are welcome. We'll keep you posted on your order.";
    case 'order_status':
    case 'order_details':
      return orderId
        ? `You are welcome. Just mention order #${orderId} whenever you need another update.`
        : 'You are welcome. Just let me know whenever you need another update.';
    case 'contact_confirmation':
      return 'You are welcome. Take your time — reply "yes" when the delivery details look correct, or send the change you need.';
    case 'order_summary':
      return 'You are welcome. Take your time — reply "yes" when you are ready to confirm, or tell me what to change.';
    case 'quantity_prompt':
      return orderId
        ? `You are welcome. Just send the new quantity for order #${orderId} when you are ready.`
        : 'You are welcome. Just send the quantity you want when you are ready.';
    case 'quantity_update_summary':
      return 'You are welcome. Take your time — reply "yes" to apply the update, or tell me what to change.';
    case 'greeting':
    case 'generic':
    default:
      return 'You are welcome. Let me know if there is anything else.';
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
