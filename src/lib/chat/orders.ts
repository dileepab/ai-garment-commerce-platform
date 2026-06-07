import prisma from '@/lib/prisma';
import {
  getRequestedOrderId,
  resolveCustomerTargetOrder,
  buildQuantityUpdateSummaryFromOrder,
  buildReorderDraftFromOrder,
} from '@/lib/chat/order-flow';
import {
  buildMissingContactPrompt,
  buildMissingOrderLookupReply,
  buildVariantPrompt,
} from '@/lib/chat/reply-builders';
import {
  extractContactDetailsFromText,
  formatDeliveryAddress,
  getMissingContactFields,
} from '@/lib/contact-profile';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  type ResolvedOrderDraft,
} from '@/lib/order-draft';
import {
  buildCancellationSuccessReply,
  buildOrderContactUpdateSuccessReply,
  buildOrderAlreadyCancelledReply,
  buildOrderPlacedReply,
  buildQuantityUpdateSuccessReply,
  buildQuantityUpdateSummaryReply,
  calculateOrderDeliveryCharge,
  type QuantityUpdateSummary,
} from '@/lib/order-details';
import {
  cancelOrderById,
  createOrderFromCatalog,
  isOrderMutableStatus,
  OrderRequestError,
  updateSingleItemOrderQuantityById,
} from '@/lib/orders';
import {
  buildSelfServiceEscalationReply,
  isCustomerSelfServiceCancellationAllowed,
  isCustomerSelfServiceContactUpdateAllowed,
} from '@/lib/customer-self-service';
import { saveConversationStateIfCurrent } from '@/lib/conversation-state';
import {
  splitCsv,
  mentionsLatestOrderReference,
  mentionsOwnedOrderReference,
} from '@/lib/chat/message-utils';
import { buildSupportContactLineFromConfig } from '@/lib/customer-support';
import {
  getSizeChartCategoryFromStyle,
  getSizeChartImagePath,
} from '@/lib/size-charts';
import { upsertCustomerContact } from './shared-actions';
import type { CustomerQuickReply } from './contracts';
import type { ChatContext, ChatProduct } from './types';

const DRAFT_PENDING_STEPS = new Set([
  'order_draft',
  'contact_collection',
  'contact_confirmation',
  'order_confirmation',
]);

function encodeQuickReplyValue(value: string): string {
  return encodeURIComponent(value.trim());
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function getAvailableVariants(product: ChatProduct) {
  return (product.variants ?? []).filter((variant) => (variant.inventory?.availableQty ?? 0) > 0);
}

function getSizeOptions(product: ChatProduct, selectedColor?: string | null): string[] {
  const availableVariants = getAvailableVariants(product);

  if (availableVariants.length > 0) {
    return uniqueNonEmpty(
      availableVariants
        .filter((variant) => !selectedColor || variant.color === selectedColor)
        .map((variant) => variant.size)
    );
  }

  return splitCsv(product.sizes).map((size) => size.toUpperCase());
}

function getColorOptions(product: ChatProduct, selectedSize?: string | null): string[] {
  const availableVariants = getAvailableVariants(product);

  if (availableVariants.length > 0) {
    return uniqueNonEmpty(
      availableVariants
        .filter((variant) => !selectedSize || variant.size === selectedSize)
        .map((variant) => variant.color)
    );
  }

  return splitCsv(product.colors);
}

function buildQuickReplies(kind: 'size' | 'color', options: string[]): CustomerQuickReply[] {
  return options.slice(0, 13).map((option) => ({
    title: option,
    payload: kind === 'size'
      ? `ORDER_SIZE|size=${encodeQuickReplyValue(option)}`
      : `ORDER_COLOR|color=${encodeQuickReplyValue(option)}`,
  }));
}

function buildVariantReplyOptions(product: ChatProduct, draft: ResolvedOrderDraft) {
  if (!draft.size) {
    const sizeOptions = getSizeOptions(product, draft.color);
    const chartCategory = getSizeChartCategoryFromStyle(product.style);
    const sizeChartPath = chartCategory ? getSizeChartImagePath(chartCategory, product.brand) : null;

    return {
      quickReplies: buildQuickReplies('size', sizeOptions),
      imagePath: sizeChartPath ?? undefined,
    };
  }

  if (!draft.color) {
    return {
      quickReplies: buildQuickReplies('color', getColorOptions(product, draft.size)),
      imagePath: undefined,
    };
  }

  return {
    quickReplies: undefined,
    imagePath: undefined,
  };
}

function buildUnavailableVariantDraft(
  product: ChatProduct,
  draft: ResolvedOrderDraft
): ResolvedOrderDraft | null {
  const availableVariants = getAvailableVariants(product);

  if (availableVariants.length === 0) {
    return null;
  }

  const colorsForSelectedSize = draft.size
    ? availableVariants.filter((variant) => variant.size === draft.size).map((variant) => variant.color)
    : [];
  const sizesForSelectedColor = draft.color
    ? availableVariants.filter((variant) => variant.color === draft.color).map((variant) => variant.size)
    : [];

  if (colorsForSelectedSize.length > 0) {
    return {
      ...draft,
      color: undefined,
      variantId: undefined,
      requiresExplicitVariantChoice: true,
    };
  }

  if (sizesForSelectedColor.length > 0) {
    return {
      ...draft,
      size: undefined,
      variantId: undefined,
      requiresExplicitVariantChoice: true,
    };
  }

  return {
    ...draft,
    size: undefined,
    color: undefined,
    variantId: undefined,
    requiresExplicitVariantChoice: true,
  };
}

function buildUnavailableVariantReply(product: ChatProduct, draft: ResolvedOrderDraft): string {
  const selectedLabel = [draft.color, draft.size].filter(Boolean).join(' ');
  const productLabel = selectedLabel ? `${product.name} (${selectedLabel})` : product.name;
  const availableVariants = getAvailableVariants(product);

  if (availableVariants.length === 0) {
    return `${productLabel} is currently out of stock. Please choose a different item.`;
  }

  if (draft.size) {
    const colorsForSelectedSize = uniqueNonEmpty(
      availableVariants
        .filter((variant) => variant.size === draft.size)
        .map((variant) => variant.color)
    );

    if (colorsForSelectedSize.length > 0) {
      return `${productLabel} is currently out of stock. Size ${draft.size} is available in: ${colorsForSelectedSize.join(', ')}. Please choose one of these colors or send another size.`;
    }
  }

  if (draft.color) {
    const sizesForSelectedColor = uniqueNonEmpty(
      availableVariants
        .filter((variant) => variant.color === draft.color)
        .map((variant) => variant.size)
    );

    if (sizesForSelectedColor.length > 0) {
      return `${productLabel} is currently out of stock. ${draft.color} is available in sizes: ${sizesForSelectedColor.join(', ')}. Please choose one of these sizes or send another color.`;
    }
  }

  const optionList = availableVariants
    .slice(0, 8)
    .map((variant) => `${variant.color} ${variant.size}`)
    .join(', ');

  return `${productLabel} is currently out of stock. Available options: ${optionList}. Please choose an available size and color.`;
}

async function findRecentMatchingOrderForDraft(customerId: number, draft: ResolvedOrderDraft) {
  const recentWindow = new Date(Date.now() - 5 * 60 * 1000);

  return prisma.order.findFirst({
    where: {
      customerId,
      brand: draft.brand || null,
      deliveryAddress: draft.address || null,
      paymentMethod: draft.paymentMethod || null,
      giftWrap: draft.giftWrap,
      giftNote: draft.giftNote || null,
      orderStatus: { not: 'cancelled' },
      createdAt: { gte: recentWindow },
      orderItems: {
        some: {
          productId: draft.productId,
          quantity: draft.quantity,
          size: draft.size || null,
          color: draft.color || null,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function updateOrderContactDetails(params: {
  orderId: number;
  customerId: number;
  address?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  district?: string | null;
  phone?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    if (params.address || params.streetAddress || params.city || params.district) {
      const deliveryAddress = formatDeliveryAddress({
        address: params.address,
        streetAddress: params.streetAddress,
        city: params.city,
        district: params.district,
      });
      await tx.order.update({
        where: { id: params.orderId },
        data: {
          deliveryAddress: deliveryAddress || params.address,
          ...(params.streetAddress ? { deliveryStreetAddress: params.streetAddress } : {}),
          ...(params.city ? { deliveryCity: params.city } : {}),
          ...(params.district ? { deliveryDistrict: params.district } : {}),
        },
      });
    }

    if (params.phone) {
      await tx.customer.update({
        where: { id: params.customerId },
        data: {
          phone: params.phone,
        },
      });
    }

    return tx.order.findUniqueOrThrow({
      where: { id: params.orderId },
      include: {
        customer: true,
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
  });
}

export async function handle_place_order(ctx: ChatContext) {
  const { aiAction, products, state } = ctx;
  const { buildDraftFromSource, finalizeReply, findProductByName } = ctx.helpers;

  const existingDraft = state.orderDraft;
  const sourceProduct =
    findProductByName(aiAction.productName) ||
    (existingDraft ? products.find((product) => product.id === existingDraft.productId) || null : null);

  if (!sourceProduct) {
    return finalizeReply({
      reply: aiAction.productName
        ? "I couldn't confidently match that item in the current catalog. Please send the exact item name from the available list, and I'll help with the order."
        : "Sure — please share the item name, size, and color and I'll set up the order.",
      nextState: {
        pendingStep: 'order_draft',
        orderDraft: existingDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  const nextDraft = buildDraftFromSource(sourceProduct, existingDraft);

  // Validate variant combo if both size and color are known
  const hasSize = Boolean(nextDraft.size);
  const hasColor = Boolean(nextDraft.color);
  const hasVariants = sourceProduct.variants && sourceProduct.variants.length > 0;

  if (hasSize && hasColor && hasVariants) {
    const matchedVariant = sourceProduct.variants.find(
      (v) => v.size === nextDraft.size && v.color === nextDraft.color
    );

    if (!matchedVariant) {
      // Check if size and color are individually valid in the active inventory
      const availableVariants = sourceProduct.variants.filter(
        (v) => (v.inventory?.availableQty ?? 0) > 0
      );
      const validSizes = new Set(availableVariants.map((v) => v.size.toUpperCase()));
      const validColors = new Set(availableVariants.map((v) => v.color.toLowerCase()));

      const isSizeValid = nextDraft.size && validSizes.has(nextDraft.size.toUpperCase());
      const isColorValid = nextDraft.color && validColors.has(nextDraft.color.toLowerCase());

      // Keep the valid options; clear the invalid ones.
      // If both are individually valid but the combo doesn't exist, clear the color to prompt again.
      const nextSize = isSizeValid ? nextDraft.size : undefined;
      let nextColor = isColorValid ? nextDraft.color : undefined;
      if (isSizeValid && isColorValid) {
        nextColor = undefined;
      }

      const resetDraft = {
        ...nextDraft,
        size: nextSize,
        color: nextColor,
        variantId: undefined,
      };

      const variantOptions = buildVariantReplyOptions(sourceProduct, resetDraft);
      return finalizeReply({
        reply: buildVariantPrompt(
          nextDraft.productName,
          nextSize,
          nextColor,
          sourceProduct
        ),
        imagePath: variantOptions.imagePath,
        quickReplies: variantOptions.quickReplies,
        nextState: {
          pendingStep: 'order_draft',
          orderDraft: resetDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }
  }

  // Use variant-level availability when both size and color are resolved
  let availableQty: number;
  if (hasSize && hasColor && nextDraft.variantId) {
    const matchedVariant = sourceProduct.variants.find((v) => v.id === nextDraft.variantId);
    availableQty = matchedVariant?.inventory?.availableQty ?? 0;
  } else if (hasSize && hasColor && hasVariants) {
    const matchedVariant = sourceProduct.variants.find(
      (v) => v.size === nextDraft.size && v.color === nextDraft.color
    );
    availableQty = matchedVariant?.inventory?.availableQty ?? 0;
  } else {
    // Size or color still unknown — use product-level as a guard
    availableQty = sourceProduct.inventory?.availableQty ?? sourceProduct.stock;
  }

  if (nextDraft.quantity > availableQty) {
    if (availableQty <= 0) {
      const resetDraft = buildUnavailableVariantDraft(sourceProduct, nextDraft);

      if (!resetDraft) {
        return finalizeReply({
          reply: buildUnavailableVariantReply(sourceProduct, nextDraft),
          nextState: {
            ...ctx.helpers.clearPendingConversationState(state),
            lastMissingOrderId: null,
          },
        });
      }

      const variantOptions = buildVariantReplyOptions(sourceProduct, resetDraft);
      return finalizeReply({
        reply: buildUnavailableVariantReply(sourceProduct, nextDraft),
        imagePath: variantOptions.imagePath,
        quickReplies: variantOptions.quickReplies,
        nextState: {
          pendingStep: 'order_draft',
          orderDraft: resetDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: `${sourceProduct.name}${nextDraft.color && nextDraft.size ? ` (${nextDraft.color} ${nextDraft.size})` : ''} currently has ${availableQty} item(s) available. Please send a lower quantity.`,
      nextState: {
        pendingStep: 'order_draft',
        orderDraft: {
          ...nextDraft,
          quantity: existingDraft?.quantity || 1,
          total:
            sourceProduct.price * (existingDraft?.quantity || 1) +
            nextDraft.deliveryCharge,
        },
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  const missingVariantReply = buildVariantPrompt(
    nextDraft.productName,
    nextDraft.size,
    nextDraft.color,
    sourceProduct,
    { forceSingleOptionPrompt: nextDraft.requiresExplicitVariantChoice }
  );

  if (missingVariantReply) {
    const variantOptions = buildVariantReplyOptions(sourceProduct, nextDraft);
    return finalizeReply({
      reply: missingVariantReply,
      imagePath: variantOptions.imagePath,
      quickReplies: variantOptions.quickReplies,
      nextState: {
        pendingStep: 'order_draft',
        orderDraft: nextDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  const missingContactFields = getMissingContactFields({
    name: nextDraft.name,
    address: nextDraft.address,
    streetAddress: nextDraft.streetAddress,
    city: nextDraft.city,
    district: nextDraft.district,
    phone: nextDraft.phone,
  });

  if (missingContactFields.length > 0) {
    return finalizeReply({
      reply: buildMissingContactPrompt(missingContactFields),
      nextState: {
        pendingStep: 'contact_collection',
        orderDraft: nextDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  return finalizeReply({
    reply: buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone, nextDraft),
    assistantReplyKind: 'contact_confirmation',
    nextState: {
      pendingStep: 'contact_confirmation',
      orderDraft: nextDraft,
      quantityUpdate: null,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_confirm_pending(ctx: ChatContext) {
  const { customer, input, latestActiveOrder, products, state } = ctx;
  const {
    clearPendingConversationState,
    escalateToSupport,
    finalizeReply,
  } = ctx.helpers;

  if (state.pendingStep === 'order_draft' && state.orderDraft) {
    const product = products.find((item) => item.id === state.orderDraft?.productId) || null;

    if (product) {
      const missingVariantReply = buildVariantPrompt(
        state.orderDraft.productName,
        state.orderDraft.size,
        state.orderDraft.color,
        product,
        { forceSingleOptionPrompt: state.orderDraft.requiresExplicitVariantChoice }
      );

      if (missingVariantReply) {
        const variantOptions = buildVariantReplyOptions(product, state.orderDraft);
        return finalizeReply({
          reply: missingVariantReply,
          imagePath: variantOptions.imagePath,
          quickReplies: variantOptions.quickReplies,
          nextState: {
            pendingStep: 'order_draft',
            orderDraft: state.orderDraft,
            quantityUpdate: null,
            lastMissingOrderId: null,
          },
        });
      }
    }

    const missingContactFields = getMissingContactFields({
      name: state.orderDraft.name,
      address: state.orderDraft.address,
      streetAddress: state.orderDraft.streetAddress,
      city: state.orderDraft.city,
      district: state.orderDraft.district,
      phone: state.orderDraft.phone,
    });

    if (missingContactFields.length > 0) {
      return finalizeReply({
        reply: buildMissingContactPrompt(missingContactFields),
        nextState: {
          pendingStep: 'contact_collection',
          orderDraft: state.orderDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }
  }

  if (state.pendingStep === 'contact_collection' && state.orderDraft) {
    const missingContactFields = getMissingContactFields({
      name: state.orderDraft.name,
      address: state.orderDraft.address,
      streetAddress: state.orderDraft.streetAddress,
      city: state.orderDraft.city,
      district: state.orderDraft.district,
      phone: state.orderDraft.phone,
    });

    if (missingContactFields.length > 0) {
      return finalizeReply({
        reply: buildMissingContactPrompt(missingContactFields),
        nextState: {
          pendingStep: 'contact_collection',
          orderDraft: state.orderDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: buildContactConfirmationReply(
        state.orderDraft.name,
        state.orderDraft.address,
        state.orderDraft.phone,
        state.orderDraft
      ),
      assistantReplyKind: 'contact_confirmation',
      nextState: {
        pendingStep: 'contact_confirmation',
        orderDraft: state.orderDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  if (state.pendingStep === 'contact_confirmation' && state.orderDraft) {
    return finalizeReply({
      reply: buildOrderSummaryReply(state.orderDraft),
      assistantReplyKind: 'order_summary',
      nextState: {
        pendingStep: 'order_confirmation',
        orderDraft: state.orderDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  if (state.pendingStep === 'order_confirmation' && state.orderDraft) {
    try {
      const ensuredCustomer = await upsertCustomerContact({
        senderId: input.senderId,
        channel: input.channel,
        preferredBrand: state.orderDraft.brand,
        currentCustomerId: customer?.id,
        currentName: customer?.name,
        currentPhone: customer?.phone,
        contact: {
          name: state.orderDraft.name,
          address: state.orderDraft.address,
          streetAddress: state.orderDraft.streetAddress,
          city: state.orderDraft.city,
          district: state.orderDraft.district,
          phone: state.orderDraft.phone,
        },
      });

      if (!ensuredCustomer) {
        throw new OrderRequestError('Customer information is incomplete.');
      }

      const claimedConfirmation = await saveConversationStateIfCurrent(
        input.senderId,
        input.channel,
        state,
        {
          ...clearPendingConversationState(state),
          lastAssistantReplyKind: 'order_confirmed',
          lastMissingOrderId: null,
        }
      );

      if (!claimedConfirmation) {
        const existingOrder = await findRecentMatchingOrderForDraft(
          ensuredCustomer.id,
          state.orderDraft
        );

        if (existingOrder) {
          return finalizeReply({
            reply: `This order has already been confirmed as order #${existingOrder.id}.`,
            orderId: existingOrder.id,
            assistantReplyKind: 'order_confirmed',
            nextState: {
              ...clearPendingConversationState(state),
              lastReferencedOrderId: existingOrder.id,
              lastMissingOrderId: null,
            },
          });
        }

        return finalizeReply({
          reply: "I'm already processing that confirmation. Just ask for the order status anytime if you'd like to check on it.",
          assistantReplyKind: 'generic',
          nextState: {
            ...clearPendingConversationState(state),
            lastMissingOrderId: null,
          },
        });
      }

      const order = await createOrderFromCatalog(prisma, {
        customerId: ensuredCustomer.id,
        brand: state.orderDraft.brand,
        deliveryAddress: state.orderDraft.address,
        deliveryStreetAddress: state.orderDraft.streetAddress,
        deliveryCity: state.orderDraft.city,
        deliveryDistrict: state.orderDraft.district,
        paymentMethod: state.orderDraft.paymentMethod,
        giftWrap: state.orderDraft.giftWrap,
        giftNote: state.orderDraft.giftNote,
        orderStatus: 'confirmed',
        items: [
          {
            productId: state.orderDraft.productId,
            variantId: state.orderDraft.variantId ?? null,
            quantity: state.orderDraft.quantity,
            size: state.orderDraft.size,
            color: state.orderDraft.color,
          },
        ],
      });

      return finalizeReply({
        reply: buildOrderPlacedReply(state.orderDraft, order.id, ctx.settings.support),
        orderId: order.id,
        assistantReplyKind: 'order_confirmed',
        nextState: {
          ...clearPendingConversationState(state),
          lastReferencedOrderId: order.id,
          lastMissingOrderId: null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof OrderRequestError) {
        return finalizeReply({
          reply: `Sorry, I could not confirm the order yet. ${error.message}`,
          nextState: {
            pendingStep: 'order_confirmation',
            orderDraft: state.orderDraft,
            quantityUpdate: null,
            lastMissingOrderId: null,
          },
        });
      }

      return escalateToSupport(
        'unclear_request',
        state.lastReferencedOrderId ?? latestActiveOrder?.id ?? null
      );
    }
  }

  if (state.pendingStep === 'quantity_update_confirmation' && state.quantityUpdate) {
    try {
      await updateSingleItemOrderQuantityById(
        prisma,
        state.quantityUpdate.orderId,
        state.quantityUpdate.quantity
      );

      return finalizeReply({
        reply: buildQuantityUpdateSuccessReply(state.quantityUpdate, ctx.settings.support),
        orderId: state.quantityUpdate.orderId,
        assistantReplyKind: 'order_confirmed',
        nextState: {
          ...clearPendingConversationState(state),
          lastReferencedOrderId: state.quantityUpdate.orderId,
          lastMissingOrderId: null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof OrderRequestError) {
        return finalizeReply({
          reply: `Sorry, I could not update the order automatically. ${error.message}`,
        });
      }

      return escalateToSupport('unclear_request', state.quantityUpdate.orderId);
    }
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

    return finalizeReply({
      reply: buildMissingContactPrompt(missingFields),
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (
    state.pendingStep === 'none' &&
    state.lastAssistantReplyKind === 'order_confirmed'
  ) {
    if (!latestActiveOrder) {
      return finalizeReply({
        reply: 'I am already processing that confirmation. Please ask for the order status if you need to check it.',
        assistantReplyKind: 'generic',
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: `Order #${latestActiveOrder.id} is already confirmed.`,
      orderId: latestActiveOrder.id,
      assistantReplyKind: 'order_confirmed',
      nextState: {
        lastReferencedOrderId: latestActiveOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  return finalizeReply({
    reply: "Sorry, there's nothing pending for me to confirm yet. Please send the order details you'd like me to put together.",
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_cancel_order(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    followUpMissingOrderId,
    input,
    latestActiveOrder,
    latestOrder,
    state,
  } = ctx;
  const {
    clearPendingConversationState,
    escalateToSupport,
    finalizeReply,
    findCustomerOrderById,
  } = ctx.helpers;

  if (
    state.orderDraft &&
    DRAFT_PENDING_STEPS.has(state.pendingStep) &&
    explicitOrderId === null
  ) {
    return finalizeReply({
      reply: 'Understood. No order has been placed yet, so nothing was processed. If you want to continue later, just send the details again.',
      nextState: {
        ...clearPendingConversationState(state),
        lastMissingOrderId: null,
      },
    });
  }

  if (!customer) {
    const requestedOrderId = getRequestedOrderId({
      explicitOrderId,
      followUpMissingOrderId,
      aiOrderId: aiAction.orderId,
      lastReferencedOrderId: state.lastReferencedOrderId,
    });

    return finalizeReply({
      reply: requestedOrderId
        ? buildMissingOrderLookupReply(requestedOrderId, 'cancel')
        : 'I could not find an order for this conversation yet.',
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  const requestedOrderId = getRequestedOrderId({
    explicitOrderId,
    followUpMissingOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrderId: latestOrder?.id ?? null,
  });
  const targetOrder = await resolveCustomerTargetOrder({
    explicitOrderId,
    followUpMissingOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrder,
    latestActiveOrder,
    preferLatestActive: true,
    preferLatestOrderReference:
      mentionsLatestOrderReference(input.currentMessage) ||
      mentionsOwnedOrderReference(input.currentMessage),
    findCustomerOrderById,
  });

  if (!targetOrder) {
    return finalizeReply({
      reply: requestedOrderId
        ? `I could not find order #${requestedOrderId} for this conversation.`
        : 'I could not find an order for this conversation yet.',
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  if (targetOrder.orderStatus === 'cancelled') {
    return finalizeReply({
      reply: buildOrderAlreadyCancelledReply(targetOrder.id),
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (!isCustomerSelfServiceCancellationAllowed(targetOrder.orderStatus)) {
    return escalateToSupport(
      'human_request',
      targetOrder.id,
      buildSelfServiceEscalationReply({
        action: 'cancel',
        orderId: targetOrder.id,
        status: targetOrder.orderStatus,
        supportLine: buildSupportContactLineFromConfig(ctx.settings.support, {
          orderId: targetOrder.id,
        }),
      })
    );
  }

  try {
    await cancelOrderById(prisma, targetOrder.id);

    return finalizeReply({
      reply: buildCancellationSuccessReply(targetOrder.id),
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  } catch (error: unknown) {
    if (error instanceof OrderRequestError) {
      return escalateToSupport(
        'human_request',
        targetOrder.id,
        `Sorry, I could not cancel order #${targetOrder.id} automatically. ${error.message} ${buildSupportContactLineFromConfig(
          ctx.settings.support,
          { orderId: targetOrder.id }
        )} I have also flagged this for a team follow-up.`
      );
    }

    return escalateToSupport('unclear_request', targetOrder.id);
  }
}

export async function handle_reorder_last(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    input,
    latestOrder,
    state,
  } = ctx;
  const {
    finalizeReply,
    findCustomerOrderById,
  } = ctx.helpers;

  const sourceOrder = await resolveCustomerTargetOrder({
    explicitOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrder,
    preferLatestOrderReference: mentionsLatestOrderReference(input.currentMessage),
    findCustomerOrderById,
  });

  if (!sourceOrder || sourceOrder.orderItems.length === 0) {
    return finalizeReply({
      reply: "Sure — share the product name, size, and color, and I'll prepare the order summary right away.",
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  const sourceItem = sourceOrder.orderItems[0];
  const reorderVariant =
    sourceItem.size && sourceItem.color && sourceItem.product.variants?.length
      ? (sourceItem.product.variants.find(
          (v) => v.size === sourceItem.size && v.color === sourceItem.color
        ) ?? null)
      : null;
  const availableQty = reorderVariant
    ? (reorderVariant.inventory?.availableQty ?? 0)
    : (sourceItem.product.inventory?.availableQty ?? 0);

  if (sourceItem.quantity > availableQty) {
    const variantLabel = sourceItem.color && sourceItem.size
      ? ` (${sourceItem.color} ${sourceItem.size})`
      : '';
    return finalizeReply({
      reply: `${sourceItem.product.name}${variantLabel} currently has ${availableQty} item(s) available. Please send a lower quantity or choose a different item.`,
      orderId: sourceOrder.id,
      nextState: {
        lastReferencedOrderId: sourceOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  const nextDraft: ResolvedOrderDraft = buildReorderDraftFromOrder({
    sourceOrder,
    customer,
    getDeliveryChargeForAddress: (address) =>
      getDeliveryChargeForAddress(address, ctx.settings.delivery),
    getDeliveryEstimateForAddress: (address) =>
      getDeliveryEstimateForAddress(address, ctx.settings.delivery),
    defaultPaymentMethod: ctx.settings.payment.defaultMethod,
  });

  return finalizeReply({
    reply: buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone, nextDraft),
    assistantReplyKind: 'contact_confirmation',
    nextState: {
      pendingStep: 'contact_confirmation',
      orderDraft: nextDraft,
      quantityUpdate: null,
      lastReferencedOrderId: sourceOrder.id,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_update_order_contact(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    followUpMissingOrderId,
    input,
    latestActiveOrder,
    latestOrder,
    state,
  } = ctx;
  const {
    clearPendingConversationState,
    escalateToSupport,
    finalizeReply,
    findCustomerOrderById,
  } = ctx.helpers;

  const extractedContact = extractContactDetailsFromText(input.currentMessage);
  const requestedAddress =
    aiAction.contact.address ||
    extractedContact.address ||
    formatDeliveryAddress(extractedContact) ||
    '';
  const requestedStreetAddress = extractedContact.streetAddress || '';
  const requestedCity = extractedContact.city || '';
  const requestedDistrict = extractedContact.district || '';
  const requestedPhone = aiAction.contact.phone || extractedContact.phone || '';
  const requestedName = aiAction.contact.name || extractedContact.name || '';

  if (!customer) {
    const requestedOrderId = getRequestedOrderId({
      explicitOrderId,
      followUpMissingOrderId,
      aiOrderId: aiAction.orderId,
      lastReferencedOrderId: state.lastReferencedOrderId,
      latestOrderId: latestOrder?.id ?? null,
    });

    return finalizeReply({
      reply: buildMissingOrderLookupReply(requestedOrderId, 'update'),
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  const targetOrder = await resolveCustomerTargetOrder({
    explicitOrderId,
    followUpMissingOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrder,
    latestActiveOrder,
    preferLatestActive: true,
    preferLatestOrderReference:
      mentionsLatestOrderReference(input.currentMessage) ||
      mentionsOwnedOrderReference(input.currentMessage),
    findCustomerOrderById,
  });

  if (!targetOrder) {
    const requestedOrderId = getRequestedOrderId({
      explicitOrderId,
      followUpMissingOrderId,
      aiOrderId: aiAction.orderId,
      lastReferencedOrderId: state.lastReferencedOrderId,
      latestOrderId: latestOrder?.id ?? null,
    });

    return finalizeReply({
      reply: requestedOrderId
        ? `I could not find order #${requestedOrderId} for this conversation.`
        : 'I could not find an active order to update for this conversation.',
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  if (requestedName) {
    return escalateToSupport(
      'human_request',
      targetOrder.id,
      `I can update the delivery address or phone number in chat, but name changes need our team to verify them. ${buildSupportContactLineFromConfig(
        ctx.settings.support,
        { orderId: targetOrder.id }
      )} I have also flagged this for a team follow-up.`
    );
  }

  if (!requestedAddress && !requestedPhone) {
    return finalizeReply({
      reply: `Sure - please send the new delivery address or phone number for order #${targetOrder.id}.`,
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (!isCustomerSelfServiceContactUpdateAllowed(targetOrder.orderStatus)) {
    return escalateToSupport(
      'delivery_issue',
      targetOrder.id,
      buildSelfServiceEscalationReply({
        action: 'update_contact',
        orderId: targetOrder.id,
        status: targetOrder.orderStatus,
        supportLine: buildSupportContactLineFromConfig(ctx.settings.support, {
          orderId: targetOrder.id,
        }),
      })
    );
  }

  const updatedOrder = await updateOrderContactDetails({
    orderId: targetOrder.id,
    customerId: customer.id,
    address: requestedAddress || null,
    streetAddress: requestedStreetAddress || null,
    city: requestedCity || null,
    district: requestedDistrict || null,
    phone: requestedPhone || null,
  });

  return finalizeReply({
    reply: buildOrderContactUpdateSuccessReply({
      orderId: updatedOrder.id,
      address: requestedAddress ? updatedOrder.deliveryAddress : null,
      phone: requestedPhone ? updatedOrder.customer.phone : null,
    }),
    orderId: updatedOrder.id,
    nextState: {
      ...clearPendingConversationState(state),
      lastReferencedOrderId: updatedOrder.id,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_update_order_quantity(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    followUpMissingOrderId,
    input,
    latestActiveOrder,
    latestOrder,
    state,
  } = ctx;
  const {
    clearPendingConversationState,
    escalateToSupport,
    finalizeReply,
    findCustomerOrderById,
  } = ctx.helpers;

  if (!customer) {
    const requestedOrderId = getRequestedOrderId({
      explicitOrderId,
      followUpMissingOrderId,
      aiOrderId: aiAction.orderId,
      lastReferencedOrderId: state.lastReferencedOrderId,
    });

    return finalizeReply({
      reply: buildMissingOrderLookupReply(requestedOrderId, 'update'),
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  const targetOrder = await resolveCustomerTargetOrder({
    explicitOrderId,
    followUpMissingOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrder,
    latestActiveOrder,
    preferLatestActive: true,
    preferLatestOrderReference:
      mentionsLatestOrderReference(input.currentMessage) ||
      mentionsOwnedOrderReference(input.currentMessage),
    findCustomerOrderById,
  });

  if (!targetOrder) {
    return finalizeReply({
      reply: explicitOrderId || followUpMissingOrderId || aiAction.orderId
        ? `I could not find an active order #${explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId} to update for this conversation.`
        : 'I could not find an active order to update for this conversation.',
      nextState: {
        lastMissingOrderId: explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId ?? null,
      },
    });
  }

  if (targetOrder.orderStatus === 'cancelled') {
    return finalizeReply({
      reply: `Order #${targetOrder.id} is already cancelled, so it cannot be updated.`,
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (!isOrderMutableStatus(targetOrder.orderStatus)) {
    return finalizeReply({
      reply: `Order #${targetOrder.id} cannot be updated because it is already ${targetOrder.orderStatus}.`,
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (targetOrder.orderItems.length !== 1) {
    return escalateToSupport('human_request', targetOrder.id);
  }

  const nextQuantity = aiAction.quantity;

  if (!nextQuantity) {
    return finalizeReply({
      reply: "Sure — what quantity would you like? I'll prepare the update summary right away.",
      orderId: targetOrder.id,
      assistantReplyKind: 'quantity_prompt',
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  const item = targetOrder.orderItems[0];
  const updateVariant =
    item.size && item.color && item.product.variants?.length
      ? (item.product.variants.find(
          (v) => v.size === item.size && v.color === item.color
        ) ?? null)
      : null;
  const currentlyAvailable = updateVariant
    ? (updateVariant.inventory?.availableQty ?? 0)
    : (item.product.inventory?.availableQty ?? 0);
  const maxAvailableQuantity = item.quantity + currentlyAvailable;

  if (nextQuantity > maxAvailableQuantity) {
    return finalizeReply({
      reply: `I can update order #${targetOrder.id} up to ${maxAvailableQuantity} item(s) based on current stock. Please send a lower quantity.`,
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (nextQuantity === item.quantity) {
    return finalizeReply({
      reply: `Order #${targetOrder.id} already has quantity ${item.quantity}. Please send a different quantity if you want to update it.`,
      orderId: targetOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  const deliveryCharge = calculateOrderDeliveryCharge(targetOrder, ctx.settings.delivery);
  const summary: QuantityUpdateSummary = buildQuantityUpdateSummaryFromOrder({
    targetOrder,
    quantity: nextQuantity,
    deliveryCharge,
    defaultPaymentMethod: ctx.settings.payment.defaultMethod,
  });

  return finalizeReply({
    reply: buildQuantityUpdateSummaryReply(summary),
    orderId: targetOrder.id,
    assistantReplyKind: 'quantity_update_summary',
    nextState: {
      pendingStep: 'quantity_update_confirmation',
      orderDraft: null,
      quantityUpdate: summary,
      lastReferencedOrderId: targetOrder.id,
      lastMissingOrderId: null,
    },
  });
}
