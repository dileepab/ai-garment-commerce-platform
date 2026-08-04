import { creativeImagePath, CATALOG_TTL_SECONDS } from '@/lib/creative-image-token';
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
import {
  extractDeliveryLocationHint,
  looksLikeDeliveryQuestion,
  looksLikePaymentQuestion,
  formatSizeList,
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
    viewAngle?: string | null;
    sourceImageUrl?: string | null;
    imageUrl?: string | null;
    createdAt?: Date | string;
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

function colorImageUrl(product: ProductImageSource, preferredColor?: string | null): string | undefined {
  const colorImages = product.colorImages ?? [];
  if (colorImages.length === 0) return undefined;

  const preferred = preferredColor?.trim().toLowerCase();
  const matched = preferred
    ? colorImages.find((image) => image.color.trim().toLowerCase() === preferred)
    : null;
  const imageUrl = preferred ? matched?.imageUrl : colorImages[0]?.imageUrl;
  return absoluteImageUrl(imageUrl);
}

function sortedSavedCreatives(product: ProductImageSource, sourceImageUrl?: string | null) {
  const anglePriority: Record<string, number> = {
    front: 0,
    side: 1,
    back: 2,
    closeup: 3,
  };

  return [...(product.creatives ?? [])]
    .filter((creative) => !creative.status || creative.status === 'saved')
    .filter((creative) => !sourceImageUrl || creative.sourceImageUrl === sourceImageUrl)
    .sort((a, b) => {
      const angleA = anglePriority[a.viewAngle ?? ''] ?? 9;
      const angleB = anglePriority[b.viewAngle ?? ''] ?? 9;
      if (angleA !== angleB) return angleA - angleB;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
}

function productImageUrls(product: ProductImageSource, limit = 4, preferredColor?: string | null): string[] {
  const preferredColorUrl = colorImageUrl(product, preferredColor);
  if (preferredColorUrl && preferredColor) {
    const matchedCreativeUrls = sortedSavedCreatives(product, preferredColorUrl)
      .map((creative) => creativeImageUrl(creative))
      .filter((url): url is string => Boolean(url))
      .slice(0, limit);
    return matchedCreativeUrls.length > 0 ? matchedCreativeUrls : [preferredColorUrl];
  }

  const creativeUrls = sortedSavedCreatives(product)
    .map((creative) => creativeImageUrl(creative))
    .filter((url): url is string => Boolean(url))
    .slice(0, limit);

  if (creativeUrls.length > 0) return creativeUrls;

  const productUrl = absoluteImageUrl(product.imageUrl);
  if (productUrl) return [productUrl];
  return preferredColorUrl ? [preferredColorUrl] : [];
}

function productPrimaryImageUrl(product: ProductImageSource): string | undefined {
  return productImageUrls(product, 1)[0];
}

function toCarouselProducts(products: Array<{ id: number; name: string; price: number; sizes: string; colors: string; imageUrl?: string | null } & ProductImageSource>) {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    sizes: formatSizeList(product.sizes) || product.sizes,
    colors: product.colors,
    ...(productPrimaryImageUrl(product) ? { imageUrl: productPrimaryImageUrl(product) } : {}),
  }));
}

function getAvailableQty(product: {
  stock?: number | null;
  inventory?: { availableQty: number } | null;
  variants?: Array<{ status?: string | null; inventory?: { availableQty: number } | null }>;
}): number {
  const productLevelQty = product.inventory?.availableQty ?? product.stock ?? 0;

  if (product.variants && product.variants.length > 0) {
    const variantQty = product.variants
      .filter((variant) => !variant.status || variant.status === 'active')
      .reduce((sum, variant) => sum + (variant.inventory?.availableQty ?? 0), 0);
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
  name: string;
  price: number;
  sizes: string;
  colors: string;
}>): string {
  return products
    .map(
      (product) =>
        `${product.name}: Rs ${product.price} (Sizes ${formatSizeList(product.sizes) || '-'} / Colors: ${
          product.colors || '-'
        })`
    )
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
  const { aiAction, brandFilter, globalProducts, input, products, requestedProductTypes, state } = ctx;
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

  const selectedProduct =
    findProductByName(aiAction.productName) ||
    (!aiAction.productName && state.lastReferencedProductId
      ? products.find((product) => product.id === state.lastReferencedProductId) || null
      : null) ||
    (!aiAction.productName && state.orderDraft
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

  return finalizeReply({
    reply: buildProductQuestionReply(
      selectedProduct,
      aiAction.questionType,
      input.currentMessage,
      requestedVariant
    ),
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
