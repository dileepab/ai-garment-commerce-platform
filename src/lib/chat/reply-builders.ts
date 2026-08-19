import { EMPTY_CATALOG_REPLY } from '@/lib/chat/language';
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
import { pickGreetingVariant, pickIntroVariant } from '@/lib/chat/greeting-variants';
import { buildGarmentSpecsForCustomer, type ProductGarmentSpecSource } from '@/lib/product-garment-specs';
import {
  buildAvailableVariantReply,
  resolveRequestedVariant,
  type CatalogGuidanceProduct,
} from '@/lib/chat/catalog-guidance';

// Declared in the language module, next to the translations that have to match
// it word for word. Re-exported here because this is where callers look for it.
export { EMPTY_CATALOG_REPLY };

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
  const { reply, isOverview } = buildProductQuestionReplyBody(
    product,
    questionType,
    customerMessage,
    requestedSelection
  );
  const itemCode = productItemCode(product);

  // Only on the overview. Asked the price three times in a row, a customer got
  // "Item code: HAP-0001" three times with it — the code is for ordering, not
  // for repeating under every sentence.
  return itemCode && isOverview ? `${reply}\nItem code: ${itemCode}` : reply;
}

function buildProductQuestionReplyBody(
  product: ProductQuestionSource,
  questionType: 'colors' | 'sizes' | 'price' | 'availability' | 'fit' | null,
  customerMessage = '',
  requestedSelection?: { size?: string | null; color?: string | null }
): { reply: string; isOverview: boolean } {
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
    return { reply: exactVariantReply, isOverview: false };
  }

  // Plurals matter here. "Prices , sizes" answered sizes and nothing else,
  // because \bprice\b cannot match "Prices" — `size` was given its plural
  // years ago and `price` never was, so asking for both got one.
  const asksPrice =
    /\b(?:prices?|prces?|prises?|costs?|how much|මිල|ගාන|கட்டணம்|விலை)\b/i.test(customerMessage);
  const asksSizes = /\b(?:size|sizes|sizing|sze|szes|sisez)\b/i.test(customerMessage);
  const asksColors = /\b(?:colou?rs?|shades?|පාට|நிறம்|நிறங்கள்)\b/i.test(customerMessage);
  // "මැටීරියල්" is simply "material" typed on a Sinhala keyboard, and it is what
  // customers actually send — the native words are the rarer spelling. Missing it
  // sent a fabric question down the catch-all branch and buried the one-word
  // answer in a spec sheet.
  const asksFabric =
    /\b(?:fabrics?|materials?|cloth)\b|මැටීරි|මැටිරි|ෆැබ්රි|රෙදි|රෙද්ද|අමුද්‍රව්‍ය|துணி|பொருள்/i.test(
      customerMessage
    );
  // "M thiyeida" is how a customer asks whether M is in stock. Only the English
  // words were matched, so that question scored zero fields and fell through to
  // the overview — which answered everything except what she asked.
  const asksAvailability =
    /\b(?:available|availability|stock|in stock)\b|\b(?:thiy|tiy)[aeiy]\w*|තියෙනවද|තිබෙනවද|තියෙයිද|තියේද/i.test(
      customerMessage
    );
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

    return { reply: `${product.name}:\n${requestedLines.join('\n')}`, isOverview: false };
  }

  if (questionType === 'colors') {
    return {
      reply: `${product.name} is currently available in ${colorList.join(', ')}.`,
      isOverview: false,
    };
  }

  if (questionType === 'sizes') {
    return {
      reply: `${product.name} is currently available in sizes ${sizeList.join(', ')}.`,
      isOverview: false,
    };
  }

  if (questionType === 'price') {
    return { reply: `${product.name} is priced at Rs ${product.price}.`, isOverview: false };
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
    return {
      reply: specBlockText
        ? `${product.name} fit/details:\n${specBlockText}`
        : `${product.name} fit details are not recorded yet.`,
      isOverview: false,
    };
  }

  // Nothing specific was asked, so answer what the item is and let them pick
  // what else they want. This used to return the whole spec sheet plus the
  // warehouse count: "What is this item?" got fifteen lines, and the stock
  // number is ours, not the customer's — it is still shown when they ask about
  // availability, which is the only time it means anything to them.
  // No invitation to ask more. It was appended to soften the trimming, but a
  // customer three questions into a conversation is already asking; being told
  // again that they may is one more line to read past.
  const summaryParts = [`${product.name} is currently available for Rs ${product.price}.`];
  if (sizeList.length > 0) summaryParts.push(`Sizes: ${sizeList.join(', ')}.`);
  if (colorList.length > 1) summaryParts.push(`Colors: ${colorList.join(', ')}.`);

  return { reply: summaryParts.join(' '), isOverview: true };
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

  // A "yes" needs nothing more — the customer named the method themselves. A
  // "no" still lists what is available, or the answer is a dead end.
  if (requestedCod && requestedOnlineTransfer) {
    const bothAvailable = Boolean(codMethod && onlineTransferMethod);
    return bothAvailable
      ? `Yes, both ${codMethod} and ${onlineTransferMethod} are available.`
      : `One or more of those payment methods is not available right now. ${methodsSummary}`;
  }

  if (requestedCod) {
    return codMethod
      ? 'Yes, COD is available.'
      : `COD is not available right now. ${methodsSummary}`;
  }

  if (requestedOnlineTransfer) {
    return onlineTransferMethod
      ? `Yes, ${onlineTransferMethod} is available.`
      : `Online transfer is not available right now. ${methodsSummary}`;
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
  includeTiming?: boolean;
  defaultDeliveryText?: string;
  paymentReply?: string | null;
}): string {
  const address = params.address?.trim();
  const withPaymentReply = (deliveryReply: string) =>
    params.paymentReply
      ? `${deliveryReply}\n\n${params.paymentReply}`
      : deliveryReply;

  if (!address) {
    if (params.includeCharge) {
      return withPaymentReply('Which city or town is the delivery for?');
    }

    return withPaymentReply(
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

  if (deliveryCharge !== null && params.includeTiming === false && !params.requestedDate) {
    return withPaymentReply(`Delivery to ${address} costs Rs ${deliveryCharge}.`);
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

/**
 * The greeting for someone we have not spoken to recently, which says that
 * they are talking to an AI. Same seeding as the plain greeting, so a customer
 * keeps one voice.
 */
export function buildIntroGreetingReply(name?: string | null, brand?: string): string {
  const firstName = firstNameOf(name);
  const storeName = brand || 'our store';
  const variant = pickIntroVariant(firstName || '');

  return variant.en(firstName ? ` ${firstName}` : '', storeName);
}

export function buildStoreLocationReply(supportConfig?: SupportContactConfig): string {
  const supportLine = supportConfig
    ? buildSupportContactLineFromConfig(supportConfig)
    : buildSupportContactLine();
  const inlineSupportLine = supportLine
    ? `${supportLine[0].toLowerCase()}${supportLine.slice(1)}`
    : supportLine;

  return `We take orders online and do not have a confirmed branch list here. For store locations, ${inlineSupportLine}`;
}

export function buildClarificationReply(state: ConversationStateData): string {
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

    return buildMissingContactPrompt(missingFields, { city: state.orderDraft.city });
  }

  if (state.pendingStep === 'contact_confirmation') {
    return 'Are the delivery details above correct? Reply "yes", or send the correction.';
  }

  if (state.pendingStep === 'order_confirmation') {
    return 'Should I place the order above? Reply "yes", or tell me what to change.';
  }

  if (state.pendingStep === 'quantity_update_confirmation') {
    return 'Should I apply the update above? Reply "yes", or tell me what to change.';
  }

  if (state.lastReferencedOrderId) {
    return `Sorry, I missed that. What would you like to change on order #${state.lastReferencedOrderId}?`;
  }

  return 'Sorry, I missed that. Which item or order do you mean?';
}

export function buildAcknowledgementReply(state: ConversationStateData): string {
  const orderId = state.lastReferencedOrderId;

  switch (state.lastAssistantReplyKind) {
    case 'support_contact':
    case 'support_handoff':
    case 'support_waiting':
      return buildSupportContactAcknowledgement();
    case 'order_confirmed':
      return orderId
        ? `You're welcome — we'll keep you posted on order #${orderId}.`
        : "You're welcome — we'll keep you posted on your order.";
    case 'order_status':
    case 'order_details':
      return orderId
        ? `Anytime — mention order #${orderId} when you need another update.`
        : 'Anytime — message us when you need another update.';
    case 'contact_confirmation':
      return 'No problem. Reply "yes" when the delivery details are correct, or send the change.';
    case 'order_summary':
      return 'No problem. Reply "yes" when you are ready, or tell me what to change.';
    case 'quantity_prompt':
      return orderId
        ? `No problem. Send the new quantity for order #${orderId} when you are ready.`
        : 'No problem. Send the quantity when you are ready.';
    case 'quantity_update_summary':
      return 'No problem. Reply "yes" to apply the update, or tell me what to change.';
    case 'greeting':
    case 'generic':
    default:
      return "You're welcome 😊";
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
  brand?: string | null,
  /**
   * The rendered chart for the one product being asked about. Used in place of
   * the brand's drawn chart when the question is about a single product and a
   * single garment type — that chart carries this product's own measurements
   * and only the sizes it is made in. Resolved by the caller, since building it
   * needs the app's public base URL.
   */
  productChartUrl?: string | null
): {
  reply: string;
  imagePaths: string[];
} {
  const uniqueCategories = [...new Set(categories)];
  const brandChartPaths = uniqueCategories
    .map((category) => getSizeChartImagePath(category, brand))
    .filter((imagePath): imagePath is string => Boolean(imagePath));
  const imagePaths =
    productChartUrl && uniqueCategories.length === 1 ? [productChartUrl] : brandChartPaths;

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
