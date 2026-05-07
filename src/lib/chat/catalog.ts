import {
  getSizeChartCategoryFromStyle,
  getSizeChartCategoryFromText,
  getSizeChartDefinition,
  type SizeChartCategory,
} from '@/lib/size-charts';
import {
  buildProductQuestionReply,
  buildProductTypeUnavailableReply,
  formatCatalogListReply,
  buildSizeChartReply,
  buildSizeChartSelectionReply,
} from '@/lib/chat/reply-builders';
import { getPublicAssetUrl } from '@/lib/runtime-config';
import type { ChatContext } from './types';

type ProductImageSource = {
  imageUrl?: string | null;
  creatives?: Array<{
    id: number;
    status?: string | null;
    viewAngle?: string | null;
    createdAt?: Date | string;
  }>;
};

function absoluteImageUrl(imageUrl?: string | null): string | undefined {
  if (!imageUrl) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return getPublicAssetUrl(imageUrl) ?? undefined;
}

function creativeImageUrl(creativeId: number): string | undefined {
  return getPublicAssetUrl(`/api/content/creatives/${creativeId}/image`) ?? undefined;
}

function sortedSavedCreatives(product: ProductImageSource) {
  const anglePriority: Record<string, number> = {
    front: 0,
    side: 1,
    back: 2,
    closeup: 3,
  };

  return [...(product.creatives ?? [])]
    .filter((creative) => !creative.status || creative.status === 'saved')
    .sort((a, b) => {
      const angleA = anglePriority[a.viewAngle ?? ''] ?? 9;
      const angleB = anglePriority[b.viewAngle ?? ''] ?? 9;
      if (angleA !== angleB) return angleA - angleB;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
}

function productImageUrls(product: ProductImageSource, limit = 4): string[] {
  const creativeUrls = sortedSavedCreatives(product)
    .map((creative) => creativeImageUrl(creative.id))
    .filter((url): url is string => Boolean(url))
    .slice(0, limit);

  if (creativeUrls.length > 0) return creativeUrls;

  const productUrl = absoluteImageUrl(product.imageUrl);
  return productUrl ? [productUrl] : [];
}

function productPrimaryImageUrl(product: ProductImageSource): string | undefined {
  return productImageUrls(product, 1)[0];
}

function toCarouselProducts(products: Array<{ id: number; name: string; price: number; sizes: string; colors: string; imageUrl?: string | null } & ProductImageSource>) {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    sizes: product.sizes,
    colors: product.colors,
    ...(productPrimaryImageUrl(product) ? { imageUrl: productPrimaryImageUrl(product) } : {}),
  }));
}

function formatCatalogLines(products: Array<{
  name: string;
  price: number;
  sizes: string;
  colors: string;
  inventory?: { availableQty: number } | null;
}>): string {
  return products
    .filter((product) => (product.inventory?.availableQty ?? 0) > 0)
    .map(
      (product) =>
        `${product.name}: Rs ${product.price} (Sizes ${product.sizes || '-'} / Colors: ${
          product.colors || '-'
        })`
    )
    .join('\n');
}

export async function handle_catalog_list(ctx: ChatContext) {
  const { brandFilter, globalProducts, products, requestedProductTypes } = ctx;
  const { finalizeReply } = ctx.helpers;

  const filteredProducts =
    requestedProductTypes.length > 0
      ? products.filter((product) => {
          const category = getSizeChartCategoryFromStyle(product.style);
          return category ? requestedProductTypes.includes(category) : false;
        })
      : products;
  const availableFilteredProducts = filteredProducts.filter(
    (product) => (product.inventory?.availableQty ?? 0) > 0
  );

  if (requestedProductTypes.length === 1 && availableFilteredProducts.length === 0) {
    const availableProducts = products.filter((product) => (product.inventory?.availableQty ?? 0) > 0);
    const category = requestedProductTypes[0];
    const categoryLabel = getSizeChartDefinition(category).label.toLowerCase();

    let unavailableReply =
      filteredProducts.length > 0
        ? `We do not have any ${categoryLabel} available in ${brandFilter || 'this store'} right now.`
        : buildProductTypeUnavailableReply(category);

    const crossBrandProducts = globalProducts.filter(
      (product) =>
        product.brand !== brandFilter &&
        getSizeChartCategoryFromStyle(product.style) === category &&
        (product.inventory?.availableQty ?? 0) > 0
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
      },
    });
  }

  return finalizeReply({
    reply: formatCatalogListReply(availableFilteredProducts),
    carouselProducts: toCarouselProducts(requestedProductTypes.length > 0 ? filteredProducts : products),
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_product_question(ctx: ChatContext) {
  const { aiAction, brandFilter, globalProducts, products, requestedProductTypes, state } = ctx;
  const { findProductByName, finalizeReply } = ctx.helpers;

  const selectedProduct =
    findProductByName(aiAction.productName) ||
    (state.orderDraft ? products.find((product) => product.id === state.orderDraft?.productId) || null : null);

  if (!selectedProduct) {
    if (requestedProductTypes.length === 1) {
      const category = requestedProductTypes[0];
      const filteredProducts = products.filter(
        (product) => getSizeChartCategoryFromStyle(product.style) === category
      );
      const availableFilteredProducts = filteredProducts.filter(
        (product) => (product.inventory?.availableQty ?? 0) > 0
      );

      let unavailableReply = buildProductTypeUnavailableReply(category);

      const crossBrandProducts = globalProducts.filter(
        (product) =>
          product.brand !== brandFilter &&
          getSizeChartCategoryFromStyle(product.style) === category &&
          (product.inventory?.availableQty ?? 0) > 0
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
            : "Here is what we have available:",
        carouselProducts: availableFilteredProducts.length === 0 ? undefined : toCarouselProducts(filteredProducts),
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

  return finalizeReply({
    reply: buildProductQuestionReply(selectedProduct, aiAction.questionType),
    imagePaths: productImageUrls(selectedProduct),
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_size_chart(ctx: ChatContext) {
  const { aiAction, input, products, requestedProductTypes } = ctx;
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
      const payload = buildSizeChartReply(availableCategories);
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
          : ['tops', 'dresses', 'pants', 'skirts']
      ),
      nextState: {
        pendingStep: 'size_chart_selection',
        lastMissingOrderId: null,
      },
    });
  }

  const payload = buildSizeChartReply(categoriesToSend, selectedProduct?.name || null);
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
