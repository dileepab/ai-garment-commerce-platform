import { getMissingContactFields, type ContactField } from '@/lib/contact-profile';
import { isVariantAvailable } from '@/lib/variant-availability';
import { productItemCode } from '@/lib/product-item-code';
import type { ConversationStateData } from '@/lib/conversation-state';
import {
  calculateSriLankaDeliveryWindow,
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
  getDefaultSizeChartCategories,
  getSizeChartDefinition,
  getSizeChartImagePath,
  type SizeChartCategory,
} from '@/lib/size-charts';
import { getBusinessDayRangeFromEstimate } from '@/lib/order-draft';
import { splitCsv, firstNameOf, sortSizeOptions, formatSizeList } from '@/lib/chat/message-utils';
import { pickGreetingVariant } from '@/lib/chat/greeting-variants';
import { buildGarmentSpecsForCustomer, type ProductGarmentSpecSource } from '@/lib/product-garment-specs';
import {
  buildAvailableVariantReply,
  resolveRequestedVariant,
  type CatalogGuidanceProduct,
} from '@/lib/chat/catalog-guidance';

export const EMPTY_CATALOG_REPLY =
  'We do not have any items listed right now. New products will be available soon—follow our page for updates.';

export function buildMissingFieldLabels(missingFields: ContactField[]): string {
  return missingFields
    .map((field) => {
      if (field === 'name') {
        return 'Name:';
      }

      if (field === 'streetAddress') {
        return 'Street Address:';
      }

      if (field === 'city') {
        return 'City/Town:';
      }

      if (field === 'district') {
        return 'District:';
      }

      return 'Phone Number:';
    })
    .join('\n');
}

export function buildMissingContactPrompt(
  missingFields: ContactField[],
  known?: { city?: string | null }
): string {
  // Customers write "460/2, Temple Road, Bingiriya" and consider the address
  // given — Bingiriya is a town, and naming its district is not something
  // anyone thinks to do. A bare "District:" under the same heading that already
  // collected the address reads as though nothing was received, which is how a
  // customer ends up replying "yes correct" to it.
  if (missingFields.length === 1 && missingFields[0] === 'district') {
    const town = known?.city?.trim();

    return town
      ? `Almost done — which district is ${town} in? (for example: Kurunegala, Gampaha, Colombo)`
      : 'Almost done — which district is that address in? (for example: Kurunegala, Gampaha, Colombo)';
  }

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
  } | null,
  options?: { forceSingleOptionPrompt?: boolean }
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
    const sizeOptions = sortSizeOptions(
      variantSizes.length > 0 ? variantSizes : splitCsv(product?.sizes)
    );
    prompts.push(
      sizeOptions.length > 0
        ? `Please let me know the size you need for ${productName}. Available sizes: ${sizeOptions.join(', ')}.`
        : `Please let me know the size you need for ${productName}.`
    );
    return prompts.join('\n');
  }

  if (!color) {
    const variantColors =
      availableVariants.length > 0
        ? [...new Set(availableVariants
            .filter((v) => !size || v.size === size)
            .map((v) => v.color))]
        : [];
    const colorOptions = variantColors.length > 0 ? variantColors : splitCsv(product?.colors);
    if (colorOptions.length > 1 || (colorOptions.length === 1 && options?.forceSingleOptionPrompt)) {
      prompts.push(`Please let me know the color you need for ${productName}. Available colors: ${colorOptions.join(', ')}.`);
    } else if (colorOptions.length === 0) {
      prompts.push(`Please let me know the color you need for ${productName}.`);
    }
  }

  return prompts.join('\n');
}

export function formatCatalogListReply(
  products: Array<{
    id?: number;
    name: string;
    brand?: string | null;
    sku?: string | null;
    price: number;
    sizes: string;
    colors: string;
    inventory?: { availableQty: number } | null;
  }>
): string {
  if (products.length === 0) {
    return EMPTY_CATALOG_REPLY;
  }

  // Leading with the code makes the list scannable and teaches the customer
  // that quoting a code is an option.
  const lines = products.map((product) => {
    const itemCode = productItemCode(product);
    const label = itemCode ? `${itemCode} — ${product.name}` : product.name;

    return `${label}: Rs ${product.price} (Sizes ${formatSizeList(product.sizes) || '-'} / Colors: ${
      product.colors || '-'
    })`;
  });

  return [
    'We currently have the following items available:',
    '',
    ...lines,
  ].join('\n');
}

type ProductQuestionSource = {
  id?: number;
  name: string;
  brand?: string | null;
  sku?: string | null;
  price: number;
  sizes: string;
  colors: string;
  fabric?: string | null;
  inventory?: { availableQty: number } | null;
  variants?: Array<{
    size: string;
    color: string;
    status?: string | null;
    inventory?: { availableQty: number } | null;
  }>;
} & ProductGarmentSpecSource;

/**
 * Product answers close with the item code so the customer can quote it back
 * instead of retyping a long name — several colourways of one design differ by
 * only a word or two, and codes resolve to exactly one product.
 */
export function buildProductQuestionReply(
  product: ProductQuestionSource,
  questionType: 'colors' | 'sizes' | 'price' | 'availability' | 'fit' | null,
  customerMessage = '',
  requestedSelection?: { size?: string | null; color?: string | null }
): string {
  const reply = buildProductQuestionReplyBody(
    product,
    questionType,
    customerMessage,
    requestedSelection
  );
  const itemCode = productItemCode(product);

  return itemCode ? `${reply}\nItem code: ${itemCode}` : reply;
}

function buildProductQuestionReplyBody(
  product: ProductQuestionSource,
  questionType: 'colors' | 'sizes' | 'price' | 'availability' | 'fit' | null,
  customerMessage = '',
  requestedSelection?: { size?: string | null; color?: string | null }
): string {
  const availableVariants = product.variants?.filter(isVariantAvailable) ?? [];

  const sizeList =
    sortSizeOptions(
      availableVariants.length > 0
        ? [...new Set(availableVariants.map((v) => v.size))]
        : splitCsv(product.sizes)
    );
  const colorList =
    availableVariants.length > 0
      ? [...new Set(availableVariants.map((v) => v.color))]
      : splitCsv(product.colors);
  const availableQty =
    availableVariants.length > 0
      ? availableVariants.reduce((sum, v) => sum + (v.inventory?.availableQty ?? 0), 0)
      : (product.inventory?.availableQty ?? 0);

  const requestedVariant = resolveRequestedVariant(
    product as CatalogGuidanceProduct,
    customerMessage,
    requestedSelection?.size,
    requestedSelection?.color
  );
  const exactVariantReply = buildAvailableVariantReply(
    product as CatalogGuidanceProduct,
    requestedVariant.size,
    requestedVariant.color,
    customerMessage
  );

  if (exactVariantReply) {
    return exactVariantReply;
  }

  const asksPrice = /\b(?:price|prce|prise|cost|how much|මිල|ගාන|கட்டணம்|விலை)\b/i.test(customerMessage);
  const asksSizes = /\b(?:size|sizes|sizing|sze|szes|sisez)\b/i.test(customerMessage);
  const asksColors = /\b(?:colou?rs?|පාට|நிறம்|நிறங்கள்)\b/i.test(customerMessage);
  // "මැටීරියල්" is simply "material" typed on a Sinhala keyboard, and it is what
  // customers actually send — the native words are the rarer spelling. Missing it
  // sent a fabric question down the catch-all branch and buried the one-word
  // answer in a spec sheet.
  const asksFabric =
    /\b(?:fabric|material|cloth)\b|මැටීරි|මැටිරි|ෆැබ්රි|රෙදි|රෙද්ද|අමුද්‍රව්‍ය|துணி|பொருள்/i.test(
      customerMessage
    );
  const asksAvailability = /\b(?:available|availability|stock|in stock)\b/i.test(customerMessage);
  const asksPockets = /\bpockets?\b/i.test(customerMessage);
  const asksZip = /\b(?:zip|zipper|side zip)\b/i.test(customerMessage);
  const asksSideSlit = /\b(?:side\s+)?slit\b/i.test(customerMessage);
  const asksGeneralFit = /\b(?:fit|length|sleeve|neckline|hem|pattern)\b/i.test(customerMessage);
  const requestedFieldCount = [
    asksPrice,
    asksSizes,
    asksColors,
    asksFabric,
    asksAvailability,
    asksPockets,
    asksZip,
    asksSideSlit,
    asksGeneralFit,
  ].filter(Boolean).length;

  if (requestedFieldCount > 0) {
    const requestedLines: string[] = [];

    if (asksPrice) requestedLines.push(`Price: Rs ${product.price}`);
    if (asksFabric || asksPockets || asksZip || asksSideSlit || asksGeneralFit) {
      if (product.fabric) {
        requestedLines.push(`Fabric: ${product.fabric}`);
      } else if (asksFabric) {
        requestedLines.push('Fabric details are not recorded yet, so I do not want to guess.');
      }
    }
    if (asksSizes) requestedLines.push(`Sizes: ${sizeList.join(', ')}`);
    if (asksColors) requestedLines.push(`Colors: ${colorList.join(', ')}`);
    // "Is this available?" wants a yes or a no. The count is our warehouse
    // figure, not something the customer asked for or can act on.
    if (asksAvailability) {
      requestedLines.push(availableQty > 0 ? 'In stock now.' : 'Out of stock right now.');
    }
    if (asksPockets) {
      requestedLines.push('Pocket details are not recorded yet, so I do not want to guess.');
    }
    if (asksZip) {
      requestedLines.push(
        product.closureDetails
          ? `Closure/details: ${product.closureDetails}`
          : 'Zip/closure details are not recorded yet, so I do not want to guess.'
      );
    }
    if (asksSideSlit) {
      requestedLines.push(
        product.hasSideSlit === true
          ? `Side slit: yes${
              product.sideSlitHeightCm ? `, ${product.sideSlitHeightCm} cm high` : ''
            }`
          : product.hasSideSlit === false
            ? 'Side slit: no'
            : 'Side-slit details are not recorded yet, so I do not want to guess.'
      );
    }
    if (asksGeneralFit && !asksPockets && !asksZip && !asksSideSlit) {
      const fitDetails = buildGarmentSpecsForCustomer(product);
      requestedLines.push(
        fitDetails || 'Fit details are not recorded yet, so I do not want to guess.'
      );
    }

    return `${product.name}:\n${requestedLines.join('\n')}`;
  }

  if (questionType === 'colors') {
    return `${product.name} is currently available in ${colorList.join(', ')}.`;
  }

  if (questionType === 'sizes') {
    return `${product.name} is currently available in sizes ${sizeList.join(', ')}.`;
  }

  if (questionType === 'price') {
    return `${product.name} is priced at Rs ${product.price}.`;
  }

  const specText = buildGarmentSpecsForCustomer(product);
  const specParts = [];
  if (product.fabric) {
    specParts.push(`Fabric: ${product.fabric}`);
  }
  if (specText) {
    specParts.push(specText);
  }
  const specBlockText = specParts.join('\n');

  if (questionType === 'fit') {
    return specBlockText
      ? `${product.name} fit/details:\n${specBlockText}`
      : `${product.name} fit details are not recorded yet.`;
  }

  // Nothing specific was asked, so answer what the item is and let them pick
  // what else they want. This used to return the whole spec sheet plus the
  // warehouse count: "What is this item?" got fifteen lines, and the stock
  // number is ours, not the customer's — it is still shown when they ask about
  // availability, which is the only time it means anything to them.
  const summaryParts = [`${product.name} is currently available for Rs ${product.price}.`];
  if (sizeList.length > 0) summaryParts.push(`Sizes: ${sizeList.join(', ')}.`);
  if (colorList.length > 1) summaryParts.push(`Colors: ${colorList.join(', ')}.`);
  summaryParts.push('Ask me about fabric, fit, or measurements if you need them.');

  return summaryParts.join(' ');
}

function formatPaymentMethodList(methods: string[]): string {
  if (methods.length <= 1) {
    return methods[0] || '';
  }

  if (methods.length === 2) {
    return `${methods[0]} and ${methods[1]}`;
  }

  return `${methods.slice(0, -1).join(', ')}, and ${methods[methods.length - 1]}`;
}

export function buildPaymentAvailabilityReply(params: {
  message: string;
  methods: string[];
  onlineTransferLabel?: string | null;
}): string {
  const methods = Array.from(
    new Map(
      params.methods
        .map((method) => method.trim())
        .filter(Boolean)
        .map((method) => [method.toLowerCase(), method])
    ).values()
  );

  if (methods.length === 0) {
    return 'No payment methods are configured right now.';
  }

  const requestedCod = /\bcod\b|cash on delivery|pay on delivery/i.test(params.message);
  const requestedOnlineTransfer = /\bonline transfer\b|\bbank transfer\b|\btransfer the money\b/i.test(
    params.message
  );
  const requestedSplitPayment =
    /\b(?:split|combine|part)\b.*\b(?:payment|pay|cod|transfer)\b|\bhalf\b.*\b(?:rest|remaining|balance)\b|\b(?:rest|remaining|balance)\b.*\bhalf\b/i.test(
      params.message
    );
  const requestedUnsupportedMethods = [
    /\b(?:credit|debit)\s+card\b|\bcard payment\b/i.test(params.message)
      ? 'credit/debit card'
      : null,
    /\bpaypal\b/i.test(params.message) ? 'PayPal' : null,
  ].filter((method): method is string => Boolean(method));
  const codMethod = methods.find((method) => /\bcod\b|cash on delivery/i.test(method));
  const onlineTransferMethod = methods.find(
    (method) =>
      method.toLowerCase() === params.onlineTransferLabel?.trim().toLowerCase() ||
      /online|bank|transfer/i.test(method)
  );
  const methodLabel = methods.length === 1 ? 'method is' : 'methods are';
  const methodsSummary = `Available payment ${methodLabel} ${formatPaymentMethodList(methods)}.`;

  if (requestedSplitPayment) {
    return `Split payment between online transfer and COD is not supported right now. Please choose one payment method for the full order. ${methodsSummary}`;
  }

  if (requestedUnsupportedMethods.length > 0) {
    return `${formatPaymentMethodList(requestedUnsupportedMethods)} ${
      requestedUnsupportedMethods.length === 1 ? 'is' : 'are'
    } not available right now. ${methodsSummary}`;
  }

  if (requestedCod && requestedOnlineTransfer) {
    const bothAvailable = Boolean(codMethod && onlineTransferMethod);
    return `${
      bothAvailable
        ? `Yes, both ${codMethod} and ${onlineTransferMethod} are available.`
        : 'One or more of those payment methods is not available right now.'
    } ${methodsSummary}`;
  }

  if (requestedCod) {
    return `${codMethod ? 'Yes, COD works for us.' : 'COD is not available right now.'} ${methodsSummary}`;
  }

  if (requestedOnlineTransfer) {
    return `${
      onlineTransferMethod
        ? `Yes, ${onlineTransferMethod} works for us.`
        : 'Online transfer is not available right now.'
    } ${methodsSummary}`;
  }

  return methodsSummary;
}

export function buildDeliveryReply(params: {
  address?: string | null;
  referenceDate: Date;
  requestedDate: Date | null;
  isDraft: boolean;
  existingOrderStatus?: string | null;
  getDeliveryEstimateForAddress: (address: string) => string;
  getDeliveryChargeForAddress?: (address: string) => number;
  includeCharge?: boolean;
  defaultDeliveryText?: string;
  paymentReply?: string | null;
}): string {
  const address = params.address?.trim();
  const withPaymentReply = (deliveryReply: string) =>
    params.paymentReply
      ? `${deliveryReply}\n\n${params.paymentReply}`
      : deliveryReply;

  if (!address) {
    const chargeText =
      params.includeCharge && params.defaultDeliveryText
        ? `${params.defaultDeliveryText}.`
        : '';

    return withPaymentReply(
      chargeText ||
        params.defaultDeliveryText ||
        'Delivery usually takes 1-2 business days within Colombo and 2-3 business days outside Colombo, excluding weekends and Sri Lankan public holidays.'
    );
  }

  const deliveryCharge =
    params.includeCharge && params.getDeliveryChargeForAddress
      ? params.getDeliveryChargeForAddress(address)
      : null;

  if (
    params.includeCharge &&
    params.getDeliveryChargeForAddress &&
    (deliveryCharge === null || !Number.isFinite(deliveryCharge) || deliveryCharge <= 0)
  ) {
    return withPaymentReply(
      `I couldn't verify ${address} in our delivery rate list. Please confirm the city or town, district, or postal code before I quote a delivery charge or delivery window.`
    );
  }

  const estimate = params.getDeliveryEstimateForAddress(address);
  const chargePrefix =
    deliveryCharge !== null
      ? `Delivery to ${address} costs Rs ${deliveryCharge}. `
      : '';
  const businessDays = getBusinessDayRangeFromEstimate(estimate);
  const { earliestDate, latestDate } = calculateSriLankaDeliveryWindow(
    params.referenceDate,
    businessDays
  );
  const intro = params.existingOrderStatus
    ? `Order is currently at the ${getOrderStageLabel(
        params.existingOrderStatus
      )} stage. ${chargePrefix}Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`
    : `${chargePrefix}Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

  if (!params.requestedDate) {
    if (params.isDraft) {
      return withPaymentReply(
        `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(
          params.referenceDate
        )}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(
          latestDate
        )}.`
      );
    }

    return withPaymentReply(
      `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
        earliestDate
      )} to ${formatSriLankaDisplayDate(latestDate)}.`
    );
  }

  if (latestDate <= params.requestedDate) {
    return withPaymentReply(
      `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
        earliestDate
      )} to ${formatSriLankaDisplayDate(latestDate)}, so it should arrive by ${formatSriLankaDisplayDate(
        params.requestedDate
      )}.`
    );
  }

  if (params.isDraft) {
    return withPaymentReply(
      `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(
        params.referenceDate
      )}, delivery before ${formatSriLankaDisplayDate(params.requestedDate)} is not possible.`
    );
  }

  return withPaymentReply(
    `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
      earliestDate
    )} to ${formatSriLankaDisplayDate(latestDate)}, so delivery before ${formatSriLankaDisplayDate(
      params.requestedDate
    )} cannot be guaranteed.`
  );
}

export function buildGreetingReply(name?: string | null, brand?: string): string {
  const firstName = firstNameOf(name);
  const storeName = brand || 'our store';
  // Seeded on the customer, so their wording stays the same across their own
  // messages while other customers get different text. See greeting-variants.
  const variant = pickGreetingVariant(firstName || '');

  return variant.en(firstName ? ` ${firstName}` : '', storeName);
}

export function buildStoreLocationReply(supportConfig?: SupportContactConfig): string {
  const supportLine = supportConfig
    ? buildSupportContactLineFromConfig(supportConfig)
    : buildSupportContactLine();

  return [
    'At the moment this chat is set up for online orders.',
    'I do not have a confirmed branch list saved here yet.',
    'You can message us here for item details, delivery, COD, or orders.',
    `For store location or branch details, ${supportLine.toLowerCase()}`,
  ].join(' ');
}

export function buildClarificationReply(
  state: ConversationStateData,
  supportConfig?: SupportContactConfig
): string {
  const supportLine = supportConfig
    ? buildSupportContactLineFromConfig(supportConfig)
    : buildSupportContactLine();

  if (state.pendingStep === 'size_chart_selection') {
    return 'Could you tell me which size chart you need — Oversized Tops, T-Shirts, Dresses, or Pants?';
  }

  if (state.pendingStep === 'contact_collection' && state.orderDraft) {
    const missingFields = getMissingContactFields({
      name: state.orderDraft.name,
      address: state.orderDraft.address,
      streetAddress: state.orderDraft.streetAddress,
      city: state.orderDraft.city,
      district: state.orderDraft.district,
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
  const categoriesToShow = categories.length > 0 ? categories : getDefaultSizeChartCategories();
  const labels = categoriesToShow.map((category) => getSizeChartDefinition(category).label).join(', ');
  return `Sure. Which item type would you like the size chart for? Available types: ${labels}.`;
}

export function buildSizeChartReply(
  categories: SizeChartCategory[],
  specificProductName?: string | null,
  brand?: string | null
): {
  reply: string;
  imagePaths: string[];
} {
  const uniqueCategories = [...new Set(categories)];
  const imagePaths = uniqueCategories
    .map((category) => getSizeChartImagePath(category, brand))
    .filter((imagePath): imagePath is string => Boolean(imagePath));

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
