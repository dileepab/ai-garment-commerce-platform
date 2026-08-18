import { creativeImagePath, CATALOG_TTL_SECONDS } from '@/lib/creative-image-token';
import { variantAvailableQty, isVariantAvailable } from '@/lib/variant-availability';
import { buildMetaCatalogVariantRetailerId } from '@/lib/meta-catalog-feed';
import { productItemCode } from '@/lib/product-item-code';
import { productDisplayImageUrls } from '@/lib/product-display-images';
import {
  getSizeChartCategoryFromStyle,
  getSizeChartCategoryFromText,
  getDefaultSizeChartCategories,
  getSizeChartDefinition,
  type SizeChartCategory,
} from '@/lib/size-charts';
import {
  buildProductQuestionReply,
  buildProductTypeUnavailableReply,
  buildDeliveryReply,
  buildPaymentAvailabilityReply,
  formatCatalogListReply,
  buildSizeChartReply,
  buildSizeChartSelectionReply,
} from '@/lib/chat/reply-builders';
import { getPublicAssetUrl } from '@/lib/runtime-config';
import { brandsMatch } from '@/lib/brand-aliases';
import { canFallBackToConversationProduct } from '@/lib/chat/product-reference';
import { looksLikePhotoRequest } from '@/lib/chat/photo-request';
import { extractItemCodes, messageMentionsItemCode } from '@/lib/product-item-code';
import { generateGroundedProductAnswer } from '@/lib/chat/grounded-answer-gemini';
import { buildGarmentSpecsForCustomer } from '@/lib/product-garment-specs';
import {
  extractDeliveryLocationHint,
  looksLikeDeliveryQuestion,
  looksLikePaymentQuestion,
  formatSizeList,
  splitCsv,
} from '@/lib/chat/message-utils';
import {
  buildCatalogRecommendationReply,
  buildProductComparisonReply,
  buildShortlistRecommendationReply,
  buildUnavailableVariantReply,
  looksLikeRecommendationRequest,
  resolveRequestedVariant,
} from '@/lib/chat/catalog-guidance';
import {
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  isOutsideColomboDeliveryArea,
  resolveDeliveryDestination,
} from '@/lib/order-draft';
import { getSriLankaToday } from '@/lib/delivery-calendar';
import { describeDeliveryEstimates } from '@/lib/runtime-config';
import type { ChatContext } from './types';

type ProductImageSource = {
  imageUrl?: string | null;
  colorImages?: Array<{
    color: string;
    imageUrl: string;
  }>;
  creatives?: Array<{
    id: number;
    status?: string | null;
    publishedAt?: Date | string | null;
    viewAngle?: string | null;
    sourceImageUrl?: string | null;
    imageUrl?: string | null;
    createdAt?: Date | string | null;
  }>;
};

function absoluteImageUrl(imageUrl?: string | null): string | undefined {
  if (!imageUrl) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return getPublicAssetUrl(imageUrl) ?? undefined;
}

function creativeImageUrl(creative: { id: number; imageUrl?: string | null }): string | undefined {
  // Blob-backed creatives are already on a public CDN. Older rows serve from
  // the app route, which Meta fetches without a session, so that link has to
  // carry its own signature.
  const blobUrl = creative.imageUrl?.trim();
  if (blobUrl) return blobUrl;
  return getPublicAssetUrl(creativeImagePath(creative.id, CATALOG_TTL_SECONDS)) ?? undefined;
}

function productImageUrls(product: ProductImageSource, limit = 4, preferredColor?: string | null): string[] {
  // The shared resolver compares sourceImageUrl against the stored colour photo
  // URL, so it has to run before anything is made absolute; only the chosen
  // URLs get an origin prefixed.
  return productDisplayImageUrls(product, { limit, preferredColor, resolveCreativeUrl: creativeImageUrl })
    .map((url) => absoluteImageUrl(url))
    .filter((url): url is string => Boolean(url));
}

function productPrimaryImageUrl(product: ProductImageSource): string | undefined {
  return productImageUrls(product, 1)[0];
}

type CarouselSourceProduct = {
  id: number;
  sku?: string | null;
  name: string;
  price: number;
  sizes: string;
  colors: string;
  imageUrl?: string | null;
  variants?: Array<{
    // Optional because some callers pass a narrower product shape. Without a
    // variant id there is no catalog row to point at, so no card is offered.
    id?: number;
    sku?: string | null;
    status?: string | null;
    inventory?: { availableQty: number } | null;
  }>;
} & ProductImageSource;

/**
 * The catalog id WhatsApp needs to render a product card.
 *
 * The feed publishes one row per variant, so a card has to point at a variant —
 * the first one actually in stock, since a card for a sold-out size is worse
 * than no card. Built with the same function that writes the feed, because an
 * id that does not match the catalog renders an empty card rather than failing.
 */
function catalogRetailerId(product: CarouselSourceProduct): string | undefined {
  const sellable = (product.variants ?? []).find(
    (variant) => variant.id !== undefined && isVariantAvailable(variant)
  );
  if (!sellable || sellable.id === undefined) return undefined;

  return buildMetaCatalogVariantRetailerId(
    { id: product.id, sku: product.sku ?? null },
    { id: sellable.id, sku: sellable.sku }
  );
}

function toCarouselProducts(products: Array<CarouselSourceProduct>) {
  return products.map((product) => {
    const retailerId = catalogRetailerId(product);

    return {
      id: product.id,
      name: product.name,
      price: product.price,
      sizes: formatSizeList(product.sizes) || product.sizes,
      colors: product.colors,
      ...(productPrimaryImageUrl(product) ? { imageUrl: productPrimaryImageUrl(product) } : {}),
      ...(retailerId ? { retailerId } : {}),
    };
  });
}

function getAvailableQty(product: {
  stock?: number | null;
  inventory?: { availableQty: number } | null;
  variants?: Array<{ status?: string | null; inventory?: { availableQty: number } | null }>;
}): number {
  const productLevelQty = product.inventory?.availableQty ?? product.stock ?? 0;

  if (product.variants && product.variants.length > 0) {
    const variantQty = product.variants
      .reduce((sum, variant) => sum + variantAvailableQty(variant), 0);
    return Math.max(variantQty, productLevelQty);
  }

  return productLevelQty;
}

function hasAvailableStock(product: {
  stock?: number | null;
  inventory?: { availableQty: number } | null;
  variants?: Array<{ status?: string | null; inventory?: { availableQty: number } | null }>;
}): boolean {
  return getAvailableQty(product) > 0;
}

function formatCatalogLines(products: Array<{
  id?: number;
  name: string;
  brand?: string | null;
  sku?: string | null;
  price: number;
  sizes: string;
  colors: string;
}>): string {
  return products
    .map((product) => {
      const itemCode = productItemCode(product);
      const label = itemCode ? `${itemCode} — ${product.name}` : product.name;

      return `${label}: Rs ${product.price} (Sizes ${formatSizeList(product.sizes) || '-'} / Colors: ${
        product.colors || '-'
      })`;
    })
    .join('\n');
}

function buildCatalogLogisticsSupplement(ctx: ChatContext): string | null {
  const { input, settings } = ctx;
  const asksDelivery = looksLikeDeliveryQuestion(input.currentMessage);
  const asksPayment = looksLikePaymentQuestion(input.currentMessage);

  if (!asksDelivery && !asksPayment) return null;

  const paymentReply = asksPayment
    ? buildPaymentAvailabilityReply({
        message: input.currentMessage,
        methods: settings.payment.methods,
        onlineTransferLabel: settings.payment.onlineTransferLabel,
      })
    : null;

  if (!asksDelivery) return paymentReply;

  const location = extractDeliveryLocationHint(input.currentMessage);
  if (location && !isOutsideColomboDeliveryArea(location)) {
    const destinationResolution = resolveDeliveryDestination(location);

    if (!destinationResolution.match) {
      const clarification = destinationResolution.suggestion
        ? `I couldn't match "${location}" exactly. The closest rate-table entry is ${destinationResolution.suggestion}. Please resend the full city or town name before I quote delivery.`
        : `I couldn't verify "${location}" in our delivery rate list. Please send the nearest city or town, district, or postal code before I quote delivery.`;
      return paymentReply ? `${clarification}\n\n${paymentReply}` : clarification;
    }
  }

  return buildDeliveryReply({
    address: location,
    referenceDate: getSriLankaToday(),
    requestedDate: null,
    isDraft: true,
    getDeliveryEstimateForAddress: (address) =>
      getDeliveryEstimateForAddress(address, settings.delivery),
    getDeliveryChargeForAddress: (address) =>
      getDeliveryChargeForAddress(address, settings.delivery),
    includeCharge: Boolean(location),
    defaultDeliveryText: describeDeliveryEstimates(settings),
    paymentReply,
  });
}

export async function handle_catalog_list(ctx: ChatContext) {
  const { brandFilter, globalProducts, input, products, requestedProductTypes, state } = ctx;
  const { finalizeReply } = ctx.helpers;

  const retainedShortlist = state.lastRecommendedProductIds
    .map((productId) => products.find((product) => product.id === productId) || null)
    .filter(
      (product): product is (typeof products)[number] =>
        Boolean(product) && hasAvailableStock(product as (typeof products)[number])
    );
  const shortlistFollowUp = buildShortlistRecommendationReply(
    retainedShortlist,
    input.currentMessage
  );

  if (shortlistFollowUp) {
    return finalizeReply({
      reply: shortlistFollowUp.reply,
      nextState: {
        lastMissingOrderId: null,
        lastReferencedProductId: shortlistFollowUp.preferredProduct.id,
        lastReferencedProductName: shortlistFollowUp.preferredProduct.name,
      },
    });
  }

  const comparison = buildProductComparisonReply(products, input.currentMessage);
  if (comparison) {
    return finalizeReply({
      reply: comparison.reply,
      nextState: {
        lastMissingOrderId: null,
        lastReferencedProductId: comparison.preferredProduct.id,
        lastReferencedProductName: comparison.preferredProduct.name,
      },
    });
  }

  const filteredProducts =
    requestedProductTypes.length > 0
      ? products.filter((product) => {
          const category = getSizeChartCategoryFromStyle(product.style);
          return category ? requestedProductTypes.includes(category) : false;
        })
      : products;
  const availableFilteredProducts = filteredProducts.filter(
    (product) => hasAvailableStock(product)
  );

  if (requestedProductTypes.length === 1 && availableFilteredProducts.length === 0) {
    const availableProducts = products.filter((product) => hasAvailableStock(product));
    const category = requestedProductTypes[0];
    const categoryLabel = getSizeChartDefinition(category).label.toLowerCase();

    let unavailableReply =
      filteredProducts.length > 0
        ? `We do not have any ${categoryLabel} available in ${brandFilter || 'this store'} right now.`
        : buildProductTypeUnavailableReply(category);

    const crossBrandProducts = globalProducts.filter(
      (product) =>
        !brandsMatch(product.brand, brandFilter) &&
        getSizeChartCategoryFromStyle(product.style) === category &&
        hasAvailableStock(product)
    );

    if (crossBrandProducts.length > 0) {
      const availableBrands = [...new Set(crossBrandProducts.map((product) => product.brand).filter(Boolean))];
      if (availableBrands.length > 0) {
        unavailableReply += ` However, we do have ${categoryLabel} available at our affiliate store${availableBrands.length > 1 ? 's' : ''} (${availableBrands.join(' and ')}). Would you like to check them out?`;
      }
    }

    return finalizeReply({
      reply:
        availableProducts.length > 0
          ? `${unavailableReply}\n\nCurrently available items are:\n\n${formatCatalogLines(
              availableProducts
            )}`
          : unavailableReply,
      carouselProducts: availableProducts.length > 0 ? toCarouselProducts(availableProducts) : undefined,
      nextState: {
        lastMissingOrderId: null,
        lastRecommendedProductIds: [],
        lastRecommendationConstraints: null,
      },
    });
  }

  if (looksLikeRecommendationRequest(input.currentMessage)) {
    const recommendation = buildCatalogRecommendationReply(
      availableFilteredProducts,
      input.currentMessage
    );
    const topProduct = recommendation.products[0];
    const logisticsSupplement = buildCatalogLogisticsSupplement(ctx);

    return finalizeReply({
      reply: logisticsSupplement
        ? `${recommendation.reply}\n\n${logisticsSupplement}`
        : recommendation.reply,
      carouselProducts:
        recommendation.products.length > 0
          ? toCarouselProducts(recommendation.products)
          : undefined,
      nextState: {
        lastMissingOrderId: null,
        lastReferencedProductId: topProduct?.id ?? null,
        lastReferencedProductName: topProduct?.name ?? null,
        lastRecommendedProductIds: recommendation.products.map((product) => product.id),
        lastRecommendationConstraints: recommendation.constraints,
      },
    });
  }

  return finalizeReply({
    reply: formatCatalogListReply(availableFilteredProducts),
    carouselProducts:
      availableFilteredProducts.length > 0
        ? toCarouselProducts(availableFilteredProducts)
        : undefined,
    nextState: {
      lastMissingOrderId: null,
      lastRecommendedProductIds: [],
      lastRecommendationConstraints: null,
    },
  });
}


/**
 * The other products the same question could equally be about.
 *
 * "What is the fabric of the skort?" is a fair question with two skorts in the
 * catalogue, and answering only about the brown one is a guess presented as
 * fact. Matching is on the words the customer actually used — a name token or
 * the style — and only when they quoted no item code, since a code is already
 * unambiguous.
 */
function siblingProductsForQuestion<T extends { id: number; name: string; style?: string | null }>(
  message: string,
  selected: T,
  products: T[]
): T[] {
  if (extractItemCodes(message).length > 0) return [selected];

  const text = ` ${message.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  const mentions = (value?: string | null) => {
    const token = (value || '').toLowerCase().trim();
    return token.length > 2 && text.includes(` ${token} `);
  };

  const matched = products.filter((product) => {
    if (mentions(product.style)) return true;
    return product.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((token) => token.length > 3 && mentions(token));
  });

  return matched.some((product) => product.id === selected.id) && matched.length > 1
    ? matched
    : [selected];
}

/**
 * One answer when the answer is the same for every candidate, a labelled block
 * each when it is not.
 *
 * Both skorts are a linen blend, so "Fabric: Linen Blend" answers the question
 * once. If one were cotton the customer needs both, named, to tell them apart.
 * The name prefix is dropped in the shared case — repeating a colourway the
 * customer did not ask about is what made the old reply look like a guess.
 */
function mergeProductAnswers(
  answers: Array<{ name: string; reply: string }>
): string {
  if (answers.length === 1) return answers[0].reply;

  const bodyOf = (entry: { name: string; reply: string }) => {
    const prefix = `${entry.name}:\n`;
    return entry.reply.startsWith(prefix) ? entry.reply.slice(prefix.length) : null;
  };

  const bodies = answers.map(bodyOf);

  // Only the "Name:\nfield: value" shape can have its label removed cleanly.
  // Anything phrased as a sentence keeps its own block.
  if (bodies.every((body): body is string => body !== null)) {
    const unique = [...new Set(bodies)];
    if (unique.length === 1) return unique[0];
  }

  return answers.map((entry) => entry.reply).join('\n\n');
}

export async function handle_product_question(ctx: ChatContext) {
  const { aiAction, brandFilter, globalProducts, input, latestAssistantText, latestCustomerText, products, requestedProductTypes, state } = ctx;
  const { findProductByName, finalizeReply } = ctx.helpers;

  const comparison = buildProductComparisonReply(products, input.currentMessage);
  if (comparison) {
    return finalizeReply({
      reply: comparison.reply,
      nextState: {
        lastMissingOrderId: null,
        lastReferencedProductId: comparison.preferredProduct.id,
        lastReferencedProductName: comparison.preferredProduct.name,
      },
    });
  }

  const namedProduct = findProductByName(aiAction.productName);
  // "What is this dress made of?" extracts a product name of "this dress",
  // which matches nothing — and the old gate (`!aiAction.productName`) then
  // threw away the conversation's own memory, so the bot asked which item the
  // customer meant one message after naming it itself.
  // A code that matches nothing is a specific request we failed to resolve, not
  // an invitation to reuse the last product.
  //
  // Read from the message being answered. latestCustomerText is the *previous*
  // customer turn — the inbound message is not persisted until the reply is
  // built — so this guard used to inspect the wrong message entirely: a code
  // quoted right now was invisible to it, and it fired a turn late on a code
  // the customer had already moved on from. Both failures point the same way,
  // at the remembered product: "Hap-005 available?" resolved to nothing, the
  // guard stayed silent because the previous turn held no code, and the answer
  // fell back to the HAP-0004 the conversation had been about.
  const quotedCodes = extractItemCodes(input.currentMessage);
  const quotedUnknownItemCode =
    quotedCodes.length > 0 &&
    !globalProducts.some((product) => messageMentionsItemCode(input.currentMessage, product));

  const canUseRememberedProduct = canFallBackToConversationProduct({
    extractedProductName: aiAction.productName,
    matchedProduct: namedProduct,
    quotedUnknownItemCode,
  });

  const selectedProduct =
    namedProduct ||
    (canUseRememberedProduct && state.lastReferencedProductId
      ? products.find((product) => product.id === state.lastReferencedProductId) || null
      : null) ||
    (canUseRememberedProduct && state.orderDraft
      ? products.find((product) => product.id === state.orderDraft?.productId) || null
      : null);

  if (!selectedProduct) {
    if (requestedProductTypes.length === 1) {
      const category = requestedProductTypes[0];
      const filteredProducts = products.filter(
        (product) => getSizeChartCategoryFromStyle(product.style) === category
      );
      const availableFilteredProducts = filteredProducts.filter(
        (product) => hasAvailableStock(product)
      );

      let unavailableReply = buildProductTypeUnavailableReply(category);

      const crossBrandProducts = globalProducts.filter(
        (product) =>
          !brandsMatch(product.brand, brandFilter) &&
          getSizeChartCategoryFromStyle(product.style) === category &&
          hasAvailableStock(product)
      );

      if (crossBrandProducts.length > 0) {
        const availableBrands = [...new Set(crossBrandProducts.map((product) => product.brand).filter(Boolean))];
        if (availableBrands.length > 0) {
          const categoryLabel = getSizeChartDefinition(category).label.toLowerCase();
          unavailableReply += ` However, we do have ${categoryLabel} available at our affiliate store${availableBrands.length > 1 ? 's' : ''} (${availableBrands.join(' and ')}). Would you like to check them out?`;
        }
      }

      return finalizeReply({
        reply:
          availableFilteredProducts.length === 0
            ? unavailableReply
            : `Here is what we have available:\n\n${formatCatalogLines(availableFilteredProducts)}`,
        carouselProducts:
          availableFilteredProducts.length === 0
            ? undefined
            : toCarouselProducts(availableFilteredProducts),
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: 'Please send the item name, and I will share the correct details for it.',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  const requestedVariant = resolveRequestedVariant(
    selectedProduct,
    input.currentMessage,
    aiAction.size,
    aiAction.color
  );
  const unavailableVariantReply = buildUnavailableVariantReply(
    selectedProduct,
    requestedVariant.size,
    requestedVariant.color
  );

  if (unavailableVariantReply) {
    return finalizeReply({
      reply: unavailableVariantReply,
      imagePaths: productImageUrls(selectedProduct, 4, requestedVariant.color),
      nextState: {
        lastMissingOrderId: null,
        lastReferencedProductId: selectedProduct.id,
        lastReferencedProductName: selectedProduct.name,
      },
    });
  }

  const builtReply = buildProductQuestionReply(
    selectedProduct,
    aiAction.questionType,
    input.currentMessage,
    requestedVariant
  );

  // Behind CHAT_GROUNDED_PRODUCT_ANSWERS. The built reply can only answer what
  // someone wrote a field for; a grounded answer can weigh the fields and reply
  // to what was actually asked. It returns null whenever it is off, unavailable,
  // or makes a claim the record does not support — and then the built reply
  // goes, because wordy beats wrong.
  const groundedReply = await generateGroundedProductAnswer({
    facts: {
      name: selectedProduct.name,
      itemCode: productItemCode(selectedProduct),
      price: selectedProduct.price,
      sizes: splitCsv(formatSizeList(selectedProduct.sizes) || selectedProduct.sizes),
      colors: splitCsv(selectedProduct.colors),
      inStock: hasAvailableStock(selectedProduct),
      fabric: selectedProduct.fabric,
      specLines: buildGarmentSpecsForCustomer(selectedProduct).split('\n').filter(Boolean),
    },
    question: input.currentMessage,
    brand: brandFilter,
    // The turn before is what makes "this dress" resolvable; it is also where
    // the customer's own previous wording lives.
    recentTurns: [
      ...(latestCustomerText ? [{ role: 'user' as const, message: latestCustomerText }] : []),
      ...(latestAssistantText ? [{ role: 'assistant' as const, message: latestAssistantText }] : []),
    ],
    // Generated in English and localized downstream by finalizeReply, the same
    // as every other reply. Generating straight into the customer's language is
    // the next step, once language is plumbed this far.
    language: 'english',
    scriptStyle: 'native',
  });

  // Answer for every product the question could be about, not just the first
  // one that matched. A grounded answer is written about the selected product
  // alone, so it only stands in when the question was unambiguous.
  const siblings = siblingProductsForQuestion(input.currentMessage, selectedProduct, products);
  const mergedReply = siblings.length > 1
    ? mergeProductAnswers(
        siblings.map((sibling) => ({
          name: sibling.name,
          reply: buildProductQuestionReply(
            sibling,
            aiAction.questionType,
            input.currentMessage,
            requestedVariant
          ),
        }))
      )
    : (groundedReply ?? builtReply);

  return finalizeReply({
    reply: mergedReply,
    // Photographs only when the customer asked to see the item. Every answer
    // used to carry four of them, so "Price" arrived behind two downloads.
    imagePaths: looksLikePhotoRequest(input.currentMessage)
      ? productImageUrls(selectedProduct, 4, aiAction.color)
      : undefined,
    nextState: {
      lastMissingOrderId: null,
      lastReferencedProductId: selectedProduct.id,
      lastReferencedProductName: selectedProduct.name,
    },
  });
}

export async function handle_size_chart(ctx: ChatContext) {
  const { aiAction, brandFilter, input, products, requestedProductTypes } = ctx;
  const { findProductByName, finalizeReply } = ctx.helpers;

  const selectedProduct = findProductByName(aiAction.productName);
  const availableCategories = [
    ...new Set(
      products
        .map((product) => getSizeChartCategoryFromStyle(product.style))
        .filter((value): value is SizeChartCategory => Boolean(value))
    ),
  ];
  const inferredCategory = getSizeChartCategoryFromText(input.currentMessage);
  const selectedProductCategory = selectedProduct
    ? getSizeChartCategoryFromStyle(selectedProduct.style)
    : null;
  const categoriesToSend =
    requestedProductTypes.length > 0
      ? requestedProductTypes
      : aiAction.productType
        ? [aiAction.productType]
        : inferredCategory
          ? [inferredCategory]
          : selectedProductCategory
            ? [selectedProductCategory]
            : [];

  if (categoriesToSend.length === 0) {
    if (availableCategories.length === 1) {
      const payload = buildSizeChartReply(availableCategories, null, brandFilter);
      return finalizeReply({
        reply: payload.reply,
        imagePaths: payload.imagePaths,
        nextState: {
          pendingStep: 'none',
          lastMissingOrderId: null,
          lastSizeChartCategory: availableCategories[0],
        },
      });
    }

    return finalizeReply({
      reply: buildSizeChartSelectionReply(
        availableCategories.length > 0
          ? availableCategories
          : getDefaultSizeChartCategories()
      ),
      nextState: {
        pendingStep: 'size_chart_selection',
        lastMissingOrderId: null,
      },
    });
  }

  const payload = buildSizeChartReply(
    categoriesToSend,
    selectedProduct?.name || null,
    selectedProduct?.brand || brandFilter
  );
  return finalizeReply({
    reply: payload.reply,
    imagePaths: payload.imagePaths,
    assistantReplyKind: 'generic',
    nextState: {
      pendingStep: 'none',
      lastMissingOrderId: null,
      lastSizeChartCategory: categoriesToSend[categoriesToSend.length - 1],
    },
  });
}
