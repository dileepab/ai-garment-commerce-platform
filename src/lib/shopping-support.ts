import prisma from '@/lib/prisma';
import {
  collectContactDetailsFromMessages,
  getMissingContactFields,
} from '@/lib/contact-profile';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getBusinessDayRangeFromEstimate,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  getMissingDraftFields,
  isContactConfirmationMessage,
  isOrderSummaryMessage,
  resolveDraftFromConversation,
} from '@/lib/order-draft';
import { isClearConfirmation } from '@/lib/order-confirmation';
import {
  getSizeChartCategoryFromStyle,
  getSizeChartCategoryFromText,
  getSizeChartDefinition,
} from '@/lib/size-charts';
import {
  addSriLankaWorkingDays,
  formatSriLankaDisplayDate,
  getSriLankaDateOnly,
  getSriLankaToday,
} from '@/lib/delivery-calendar';
import {
  describeDeliveryCharges,
  describeDeliveryEstimates,
  getMerchantSettings,
  resolvePaymentMethod,
} from '@/lib/runtime-config';

import { ShoppingSupportParams, ShoppingSupportResult } from './shopping-support/types';
import { resolveExplicitProduct, resolveLikelyProduct } from './shopping-support/text-matching';
import { detectSupportIntent, looksLikeOrderIntakeMessage, isSizeChartFollowUpPrompt, extractDeliveryLocationHint, isDraftDeliveryConversation, isNewOrderIntentMessage, hasRecentNewOrderIntent } from './shopping-support/intent-detection';
import { resolveRequestedDeliveryDate } from './shopping-support/date-parsing';
import { buildVariantPrompt, buildSizeChartSelectionReply, getSingleCatalogChartCategory, buildMissingContactPrompt, buildSummaryReplyWithIntro, describeOrderStatus, buildDeliveryWindowReply, buildNewOrderNextStepReply } from './shopping-support/reply-builders';

async function saveConversationPair(
  senderId: string,
  channel: string,
  userMessage: string,
  assistantReply: string
) {
  await prisma.chatMessage.createMany({
    data: [
      {
        senderId,
        channel,
        role: 'user',
        message: userMessage,
      },
      {
        senderId,
        channel,
        role: 'assistant',
        message: assistantReply,
      },
    ],
  });
}

export async function tryHandleShoppingSupport(
  params: ShoppingSupportParams
): Promise<ShoppingSupportResult> {
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      senderId: params.senderId,
      channel: params.channel,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      role: true,
      message: true,
    },
  });

  const chronologicalMessages = [...recentMessages].reverse();
  const conversationMessages = [
    ...chronologicalMessages,
    { role: 'user', message: params.currentMessage },
  ];
  const latestAssistantMessage = [...recentMessages].find((message) => message.role === 'assistant');
  const latestAssistantText = latestAssistantMessage?.message ?? '';
  const activeDraftConversation = isDraftDeliveryConversation(latestAssistantMessage?.message);
  const confirmationReplyInProgress =
    Boolean(latestAssistantText) &&
    isClearConfirmation(params.currentMessage) &&
    (isContactConfirmationMessage(latestAssistantText) ||
      isOrderSummaryMessage(latestAssistantText));
  const activeNewOrderConversation =
    isNewOrderIntentMessage(params.currentMessage) || hasRecentNewOrderIntent(conversationMessages);
  const shouldDeferToConfirmation =
    confirmationReplyInProgress && isClearConfirmation(params.currentMessage);
  const followUpSizeChartRequest = isSizeChartFollowUpPrompt(latestAssistantMessage?.message);
  const explicitChartCategory = getSizeChartCategoryFromText(params.currentMessage);

  if (shouldDeferToConfirmation) {
    return { handled: false };
  }

  const customer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
    select: {
      id: true,
      name: true,
      phone: true,
      preferredBrand: true,
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          deliveryAddress: true,
        },
      },
    },
  });
  const settings = await getMerchantSettings(params.brand || customer?.preferredBrand || null);

  const latestActiveOrder = customer?.id
    ? await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          ...(params.brand ? { brand: params.brand } : {}),
          orderStatus: { not: 'cancelled' },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      })
    : null;

  const products = await prisma.product.findMany({
    where: params.brand
      ? { brand: params.brand }
      : customer?.preferredBrand
        ? { brand: customer.preferredBrand }
        : undefined,
    select: {
      name: true,
      price: true,
      sizes: true,
      colors: true,
      style: true,
    },
  });

  const explicitProduct = resolveExplicitProduct(products, params.currentMessage);
  const likelyProduct = resolveLikelyProduct(products, conversationMessages);
  let intent = detectSupportIntent(params.currentMessage);

  if (!intent && followUpSizeChartRequest && (explicitProduct || explicitChartCategory)) {
    intent = 'size_chart';
  }

  if (
    !intent &&
    !confirmationReplyInProgress &&
    looksLikeOrderIntakeMessage(params.currentMessage, explicitProduct, likelyProduct)
  ) {
    intent = 'order_intake';
  }

  if (!intent) {
    return { handled: false };
  }

  const contacts = collectContactDetailsFromMessages(conversationMessages, {
    name: customer?.name ?? undefined,
    phone: customer?.phone ?? undefined,
    address: customer?.orders[0]?.deliveryAddress ?? undefined,
  });
  const missingFields = getMissingContactFields(contacts);
  const { draft } = await resolveDraftFromConversation(
    params.senderId,
    params.channel,
    params.brand,
    params.currentMessage
  );

  let reply = '';
  let imagePath: string | undefined;

  if (intent === 'order_intake') {
    const selectedProduct = explicitProduct || likelyProduct;

    if (!selectedProduct) {
      return { handled: false };
    }

    if (missingFields.length > 0) {
      reply = buildMissingContactPrompt(missingFields);
    } else if (draft) {
      if (isOrderSummaryMessage(latestAssistantText)) {
        const missingDraftFields = getMissingDraftFields(draft);

        if (missingDraftFields.length === 0) {
          reply = buildOrderSummaryReply(draft);
        } else {
          reply = buildVariantPrompt(
            draft.productName,
            draft.size,
            draft.color,
            selectedProduct
          );
        }
      } else {
      const contactReply = buildContactConfirmationReply(draft.name, draft.address, draft.phone);
      const variantPrompt = buildVariantPrompt(
        draft.productName,
        draft.size,
        draft.color,
        selectedProduct
      );

      reply = variantPrompt ? `${contactReply}\n\n${variantPrompt}` : contactReply;
      }
    } else {
      reply = buildMissingContactPrompt(missingFields);
    }
  } else if (intent === 'size_chart') {
    const singleCatalogChartCategory = getSingleCatalogChartCategory(products);
    const chartCategory =
      explicitChartCategory ||
      getSizeChartCategoryFromStyle(explicitProduct?.style) ||
      (products.length === 1 ? getSizeChartCategoryFromStyle(products[0]?.style) : null) ||
      singleCatalogChartCategory;

    if (!explicitProduct && !explicitChartCategory && !singleCatalogChartCategory && products.length !== 1) {
      reply = buildSizeChartSelectionReply(products);
    } else if (chartCategory) {
      const chart = getSizeChartDefinition(chartCategory);

      if (explicitProduct) {
        reply = `Sure. Here is the size chart for ${explicitProduct.name}.`;
      } else if (singleCatalogChartCategory && !explicitChartCategory) {
        reply = `Sure. Here is our ${chart.label} size chart.`;
      } else {
        reply = `Sure. Here is our ${chart.label} size chart.`;
      }

      imagePath = chart.imagePath;
    } else {
      reply = buildSizeChartSelectionReply(products);
    }
  } else if (intent === 'exchange') {
    reply =
      'If there is a size issue, please message us as soon as you receive the parcel and we will help you with the exchange process, subject to stock availability.';
  } else if (intent === 'order_online') {
    const baseReply = 'Yes, you can place the order here through chat.';
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(baseReply, buildOrderSummaryReply(draft));
    } else {
      const missingPrompt = buildMissingContactPrompt(missingFields);
      reply = missingPrompt ? `${baseReply}\n\n${missingPrompt}` : baseReply;
    }
  } else if (intent === 'online_transfer') {
    const paymentMethod = resolvePaymentMethod(
      settings.payment.onlineTransferLabel,
      params.currentMessage,
      settings
    );
    const baseReply = `Yes, ${paymentMethod.toLowerCase().includes('transfer') ? 'online transfer is accepted' : `${paymentMethod} is accepted`}, and I have noted the payment method as ${paymentMethod}.`;
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(baseReply, buildOrderSummaryReply(draft));
    } else {
      const missingPrompt = buildMissingContactPrompt(missingFields);
      reply = missingPrompt ? `${baseReply}\n\n${missingPrompt}` : baseReply;
    }
  } else if (intent === 'gift') {
    const giftNote = /happy birthday/i.test(params.currentMessage)
      ? 'Happy Birthday'
      : 'your requested note';
    const baseReply = `Yes, we can pack it as a gift and include the note "${giftNote}". I have added that instruction.`;
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(baseReply, buildOrderSummaryReply(draft));
    } else {
      const missingPrompt = buildMissingContactPrompt(missingFields);
      reply = missingPrompt ? `${baseReply}\n\n${missingPrompt}` : baseReply;
    }
  } else if (intent === 'delivery_charge') {
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(
        `Delivery to ${draft.address} is Rs ${draft.deliveryCharge}.`,
        buildOrderSummaryReply(draft)
      );
    } else if (contacts.address) {
      reply = `Delivery to ${contacts.address} is Rs ${getDeliveryChargeForAddress(
        contacts.address,
        settings.delivery
      )}.`;
    } else {
      reply = describeDeliveryCharges(settings);
    }
  } else if (intent === 'total') {
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(
        `The total for your order is Rs ${draft.total}, including Rs ${draft.deliveryCharge} delivery.`,
        buildOrderSummaryReply(draft)
      );
    } else if (likelyProduct && contacts.address) {
      const deliveryCharge = getDeliveryChargeForAddress(contacts.address, settings.delivery);
      reply = `The ${likelyProduct.name} is Rs ${likelyProduct.price}, delivery to ${contacts.address} is Rs ${deliveryCharge}, and the current total is Rs ${likelyProduct.price + deliveryCharge}.`;
    } else if (likelyProduct) {
      reply = `The ${likelyProduct.name} is Rs ${likelyProduct.price}. ${describeDeliveryCharges(settings)}`;
    } else {
      reply = 'Please tell me the product you want, and I will confirm the exact total with delivery.';
    }
  } else if (intent === 'delivery_timing') {
    const today = getSriLankaToday();
    const useDraftEstimate = Boolean(draft) && activeDraftConversation;
    const explicitDeliveryLocation = extractDeliveryLocationHint(params.currentMessage);
    const referenceDate = useDraftEstimate
      ? today
      : latestActiveOrder
        ? getSriLankaDateOnly(latestActiveOrder.createdAt)
        : today;
    const address = explicitDeliveryLocation
      ? explicitDeliveryLocation
      : useDraftEstimate
        ? draft?.address
        : latestActiveOrder?.deliveryAddress || contacts.address;
    const estimate = getDeliveryEstimateForAddress(address, settings.delivery);
    const businessDays = getBusinessDayRangeFromEstimate(estimate);
    const earliestDate = addSriLankaWorkingDays(referenceDate, businessDays[0]);
    const latestDate = addSriLankaWorkingDays(referenceDate, businessDays[1]);
    const requestedDate = resolveRequestedDeliveryDate(
      params.currentMessage,
      conversationMessages,
      today
    );

    if (useDraftEstimate && draft?.address) {
      const preOrderIntro = `Delivery to ${draft.address} usually takes ${draft.deliveryEstimate}, excluding weekends and Sri Lankan public holidays.`;
      reply = buildDeliveryWindowReply(
        preOrderIntro,
        earliestDate,
        latestDate,
        requestedDate,
        true,
        referenceDate
      );
    } else if ((activeNewOrderConversation || explicitDeliveryLocation) && address) {
      const preOrderIntro = `Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

      if (requestedDate) {
        reply = buildDeliveryWindowReply(
          preOrderIntro,
          earliestDate,
          latestDate,
          requestedDate,
          true,
          referenceDate
        );
      } else {
        reply = `${preOrderIntro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}.`;
      }

      if (activeNewOrderConversation) {
        reply = `${reply}\n\n${buildNewOrderNextStepReply(contacts, missingFields)}`;
      }
    } else if (latestActiveOrder && address) {
      const orderIntro = `${describeOrderStatus(latestActiveOrder.orderStatus)} Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

      if (latestDate < today) {
        const windowText = `${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}`;
        reply = `${orderIntro} The original expected delivery window was ${windowText}. If you have not received it yet, please let us know and we will check it for you.`;
      } else {
        reply = buildDeliveryWindowReply(
          orderIntro,
          earliestDate,
          latestDate,
          requestedDate,
          false,
          referenceDate
        );
      }
    } else if (contacts.address) {
      const preOrderEstimate = getDeliveryEstimateForAddress(contacts.address, settings.delivery);
      const preOrderIntro = `Delivery to ${contacts.address} usually takes ${preOrderEstimate}, excluding weekends and Sri Lankan public holidays.`;

      if (requestedDate) {
        reply = buildDeliveryWindowReply(
          preOrderIntro,
          earliestDate,
          latestDate,
          requestedDate,
          true,
          referenceDate
        );
      } else {
        reply = `${preOrderIntro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}.`;
      }

      if (activeNewOrderConversation) {
        reply = `${reply}\n\n${buildNewOrderNextStepReply(contacts, missingFields)}`;
      }
    } else {
      reply = describeDeliveryEstimates(settings);
    }
  }

  if (!reply) {
    return { handled: false };
  }

  await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
  return { handled: true, reply, imagePath };
}
