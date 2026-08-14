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
  const canUseRememberedProduct = canFallBackToConversationProduct({
    extractedProductName: aiAction.productName,
    matchedProduct: namedProduct,
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

  return finalizeReply({
    reply: groundedReply ?? builtReply,
    imagePaths: productImageUrls(selectedProduct, 4, aiAction.color),
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
