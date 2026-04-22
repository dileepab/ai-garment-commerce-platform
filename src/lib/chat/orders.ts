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
import { getMissingContactFields } from '@/lib/contact-profile';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  type ResolvedOrderDraft,
} from '@/lib/order-draft';
import {
  buildCancellationSuccessReply,
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
  OrderRequestError,
  updateSingleItemOrderQuantityById,
} from '@/lib/orders';
import { upsertCustomerContact } from './shared-actions';
import type { ChatContext } from './types';

export async function handle_place_order(ctx: ChatContext) {
  const { aiAction, products, state } = ctx;
  const { buildDraftFromSource, finalizeReply, findProductByName } = ctx.helpers;

  const existingDraft = state.orderDraft;
  const sourceProduct =
    findProductByName(aiAction.productName) ||
    (existingDraft ? products.find((product) => product.id === existingDraft.productId) || null : null);

  if (!sourceProduct) {
    return finalizeReply({
      reply: 'Please send the item name, size, and color you want so I can prepare the order correctly.',
      nextState: {
        pendingStep: 'order_draft',
        orderDraft: existingDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  const nextDraft = buildDraftFromSource(sourceProduct, existingDraft);
  const availableQty = sourceProduct.inventory?.availableQty ?? sourceProduct.stock;

  if (nextDraft.quantity > availableQty) {
    return finalizeReply({
      reply: `${sourceProduct.name} currently has ${availableQty} item(s) available. Please send a lower quantity.`,
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
    sourceProduct
  );

  if (missingVariantReply) {
    return finalizeReply({
      reply: missingVariantReply,
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
    reply: buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone),
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
  const { customer, input, latestActiveOrder, state } = ctx;
  const {
    clearPendingConversationState,
    escalateToSupport,
    finalizeReply,
  } = ctx.helpers;

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
          phone: state.orderDraft.phone,
        },
      });

      if (!ensuredCustomer) {
        throw new OrderRequestError('Customer information is incomplete.');
      }

      const order = await createOrderFromCatalog(prisma, {
        customerId: ensuredCustomer.id,
        brand: state.orderDraft.brand,
        deliveryAddress: state.orderDraft.address,
        paymentMethod: state.orderDraft.paymentMethod,
        giftWrap: state.orderDraft.giftWrap,
        giftNote: state.orderDraft.giftNote,
        orderStatus: 'confirmed',
        items: [
          {
            productId: state.orderDraft.productId,
            quantity: state.orderDraft.quantity,
            size: state.orderDraft.size,
            color: state.orderDraft.color,
          },
        ],
      });

      return finalizeReply({
        reply: buildOrderPlacedReply(state.orderDraft, order.id),
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
        reply: buildQuantityUpdateSuccessReply(state.quantityUpdate),
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
      phone: state.orderDraft.phone,
    });

    return finalizeReply({
      reply: buildMissingContactPrompt(missingFields),
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  return finalizeReply({
    reply: 'Please send the order details you want me to confirm.',
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
      return finalizeReply({
        reply: `Sorry, I could not cancel the order automatically. ${error.message}`,
      });
    }

    return escalateToSupport('unclear_request', targetOrder.id);
  }
}

export async function handle_reorder_last(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
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
    findCustomerOrderById,
  });

  if (!sourceOrder || sourceOrder.orderItems.length === 0) {
    return finalizeReply({
      reply: 'Please send the product name, size, and color you want, and I will prepare the order summary right away.',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  const nextDraft: ResolvedOrderDraft = buildReorderDraftFromOrder({
    sourceOrder,
    customer,
    getDeliveryChargeForAddress,
    getDeliveryEstimateForAddress,
  });

  return finalizeReply({
    reply: buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone),
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

export async function handle_update_order_quantity(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    followUpMissingOrderId,
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

  if (targetOrder.orderItems.length !== 1) {
    return escalateToSupport('human_request', targetOrder.id);
  }

  const nextQuantity = aiAction.quantity;

  if (!nextQuantity) {
    return finalizeReply({
      reply: 'Please tell me the quantity you want for your order, and I will prepare the update summary.',
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
  const maxAvailableQuantity = item.quantity + (item.product.inventory?.availableQty ?? 0);

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

  const deliveryCharge = calculateOrderDeliveryCharge(targetOrder);
  const summary: QuantityUpdateSummary = buildQuantityUpdateSummaryFromOrder({
    targetOrder,
    quantity: nextQuantity,
    deliveryCharge,
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
