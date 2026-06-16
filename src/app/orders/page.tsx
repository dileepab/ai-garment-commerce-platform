import prisma from '@/lib/prisma';
import { canScope } from '@/lib/access-control';
import { getSelectedBrandScopedWhere } from '@/lib/brand-context';
import { requirePagePermission } from '@/lib/authz';
import OrdersPageClient from './OrdersPageClient';
import { normalizeFulfillmentStatus } from '@/lib/fulfillment';
import { getBrandLookupAliases } from '@/lib/brand-aliases';
import { selectBestKoombiyoLocation } from '@/lib/koombiyo-courier';
import { getDeliveryChargeForAddress } from '@/lib/order-draft';
import { getMerchantSettings } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const scope = await requirePagePermission('orders:view');
  const { brand } = await searchParams;
  const orders = await prisma.order.findMany({
    where: getSelectedBrandScopedWhere(scope, brand),
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
      supportEscalations: {
        select: {
          id: true,
          status: true,
          reason: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      },
      fulfillmentEvents: {
        orderBy: { createdAt: 'asc' },
      },
      courierWebhookEvents: {
        orderBy: { receivedAt: 'desc' },
        take: 6,
      },
      courierShipments: {
        orderBy: { createdAt: 'desc' },
        take: 4,
      },
      returnRequests: {
        select: {
          id: true,
          type: true,
          status: true,
          reason: true,
          stockReconciled: true,
          replacementOrderId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const orderBrandNames = Array.from(
    new Set(orders.map((order) => order.brand).filter((brand): brand is string => Boolean(brand)))
  );
  const courierLookupBrands = Array.from(new Set(orderBrandNames.flatMap((brand) => getBrandLookupAliases(brand))));
  const koombiyoSettings = await prisma.courierIntegrationSetting.findMany({
    where: {
      provider: 'koombiyo',
      brand: { in: courierLookupBrands },
    },
    select: {
      brand: true,
      isActive: true,
      apiKey: true,
      senderName: true,
      senderAddress: true,
      senderPhone: true,
      defaultReceiverDistrictId: true,
      defaultReceiverCityId: true,
    },
  });
  const royalExpressSettings = await prisma.courierIntegrationSetting.findMany({
    where: {
      provider: 'royalexpress',
      brand: { in: courierLookupBrands },
    },
    select: {
      brand: true,
      isActive: true,
      accountEmail: true,
      accountPassword: true,
      merchantBusinessId: true,
      pickupAddressId: true,
      originCityId: true,
      defaultReceiverCityId: true,
    },
  });
  const koombiyoLocations = await prisma.courierLocation.findMany({
    where: {
      provider: 'koombiyo',
      brand: { in: courierLookupBrands },
    },
    select: {
      brand: true,
      districtId: true,
      districtName: true,
      cityId: true,
      cityName: true,
      normalized: true,
    },
  });
  const merchantSettingsEntries = await Promise.all(
    orderBrandNames.map(async (brand) => [brand, await getMerchantSettings(brand)] as const)
  );
  const merchantSettingsByBrand = new Map(merchantSettingsEntries);
  const getKoombiyoSettingForBrand = (brand: string) => {
    const aliases = getBrandLookupAliases(brand);
    const matches = koombiyoSettings.filter((setting) => aliases.includes(setting.brand));
    return (
      matches.find((setting) => setting.brand === brand && setting.isActive) ||
      matches.find((setting) => setting.isActive) ||
      matches.find((setting) => setting.brand === brand) ||
      matches.find((setting) => Boolean(setting.apiKey)) ||
      matches[0] ||
      null
    );
  };
  const getRoyalExpressSettingForBrand = (brand: string) => {
    const aliases = getBrandLookupAliases(brand);
    const matches = royalExpressSettings.filter((setting) => aliases.includes(setting.brand));
    return (
      matches.find((setting) => setting.brand === brand && setting.isActive) ||
      matches.find((setting) => setting.isActive) ||
      matches.find((setting) => setting.brand === brand) ||
      matches.find((setting) => Boolean(setting.accountEmail && setting.accountPassword)) ||
      matches[0] ||
      null
    );
  };
  const getKoombiyoLocationForOrder = (order: (typeof orders)[number]) => {
    if (!order.brand) return null;
    const aliases = getBrandLookupAliases(order.brand);
    const brandLocations = koombiyoLocations.filter((location) => aliases.includes(location.brand));
    const locationText = [
      order.deliveryCity,
      order.deliveryDistrict,
      order.deliveryAddress,
    ].filter(Boolean).join(', ');
    return selectBestKoombiyoLocation(locationText, brandLocations);
  };
  const getOrderAmountBreakdown = (order: (typeof orders)[number]) => {
    const amount = Math.max(0, Math.round(order.totalAmount));
    const settings = order.brand ? merchantSettingsByBrand.get(order.brand) : null;
    const deliveryCharge = getDeliveryChargeForAddress(order.deliveryAddress || '', settings?.delivery);
    const orderTotal = amount + deliveryCharge;

    return {
      amount,
      deliveryCharge,
      orderTotal,
      codValue: orderTotal,
    };
  };

  const normalizedCounts = orders.reduce<Record<string, number>>((acc, o) => {
    const key = normalizeFulfillmentStatus(o.orderStatus);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const stats = {
    total: orders.length,
    pending: normalizedCounts.pending ?? 0,
    confirmed: normalizedCounts.confirmed ?? 0,
    packing: (normalizedCounts.packing ?? 0) + (normalizedCounts.packed ?? 0),
    shipped: normalizedCounts.dispatched ?? 0,
    delivered: normalizedCounts.delivered ?? 0,
    deliveryFailed: normalizedCounts.delivery_failed ?? 0,
    returned: normalizedCounts.returned ?? 0,
    cancelled: normalizedCounts.cancelled ?? 0,
    revenueToday: orders
      .filter(o => o.orderStatus !== 'cancelled' && new Date(o.createdAt).toDateString() === new Date().toDateString())
      .reduce((acc, o) => acc + getOrderAmountBreakdown(o).orderTotal, 0),
  };

  const serialized = orders.map((o) => {
    const amounts = getOrderAmountBreakdown(o);

    return {
      id: o.id,
      orderStatus: o.orderStatus,
      totalAmount: o.totalAmount,
      amount: amounts.amount,
      deliveryCharge: amounts.deliveryCharge,
      orderTotal: amounts.orderTotal,
      codValue: amounts.codValue,
      createdAt: o.createdAt.toISOString(),
      brand: o.brand,
      paymentMethod: o.paymentMethod,
      deliveryAddress: o.deliveryAddress,
      deliveryStreetAddress: o.deliveryStreetAddress,
      deliveryCity: o.deliveryCity,
      deliveryDistrict: o.deliveryDistrict,
      trackingNumber: o.trackingNumber,
      courier: o.courier,
      courierProcessingStatus: o.courierProcessingStatus,
      courierProcessedAt: o.courierProcessedAt?.toISOString() ?? null,
      failureReason: o.failureReason,
      returnReason: o.returnReason,
      koombiyoCourier: o.brand
        ? (() => {
            const setting = getKoombiyoSettingForBrand(o.brand);
            const matchedLocation = getKoombiyoLocationForOrder(o);
            return {
              isActive: setting?.isActive ?? false,
              hasApiKey: Boolean(setting?.apiKey),
              senderName: setting?.senderName ?? null,
              senderAddress: setting?.senderAddress ?? null,
              senderPhone: setting?.senderPhone ?? null,
              defaultReceiverDistrictId: setting?.defaultReceiverDistrictId ?? null,
              defaultReceiverCityId: setting?.defaultReceiverCityId ?? null,
              resolvedReceiverDistrictId: matchedLocation?.districtId ?? null,
              resolvedReceiverDistrictName: matchedLocation?.districtName ?? null,
              resolvedReceiverCityId: matchedLocation?.cityId ?? null,
              resolvedReceiverCityName: matchedLocation?.cityName ?? null,
            };
          })()
        : null,
      royalExpressCourier: o.brand
        ? (() => {
            const setting = getRoyalExpressSettingForBrand(o.brand);
            return {
              isActive: setting?.isActive ?? false,
              hasCredentials: Boolean(
                setting?.accountEmail &&
                  setting.accountPassword &&
                  setting.merchantBusinessId &&
                  setting.pickupAddressId
              ),
              accountEmail: setting?.accountEmail ?? null,
              merchantBusinessId: setting?.merchantBusinessId ?? null,
              pickupAddressId: setting?.pickupAddressId ?? null,
              originCityId: setting?.originCityId ?? null,
              defaultDestinationCityId: setting?.defaultReceiverCityId ?? null,
            };
          })()
        : null,
      customer: {
        id: o.customer.id,
        name: o.customer.name,
        phone: o.customer.phone,
        channel: o.customer.channel,
      },
      orderItems: o.orderItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
        price: item.price,
        product: item.product
          ? { name: item.product.name, style: item.product.style }
          : null,
      })),
      supportEscalations: o.supportEscalations.map((support) => ({
        id: support.id,
        status: support.status,
        reason: support.reason,
        updatedAt: support.updatedAt.toISOString(),
      })),
      returnRequests: o.returnRequests.map((rr) => ({
        id: rr.id,
        type: rr.type,
        status: rr.status,
        reason: rr.reason,
        stockReconciled: rr.stockReconciled,
        replacementOrderId: rr.replacementOrderId,
        createdAt: rr.createdAt.toISOString(),
        updatedAt: rr.updatedAt.toISOString(),
      })),
      fulfillmentEvents: o.fulfillmentEvents.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        trackingNumber: event.trackingNumber,
        courier: event.courier,
        actorEmail: event.actorEmail,
        actorName: event.actorName,
        customerNotified: event.customerNotified,
        createdAt: event.createdAt.toISOString(),
      })),
      courierWebhookEvents: o.courierWebhookEvents.map((event) => ({
        id: event.id,
        provider: event.provider,
        trackingNumber: event.trackingNumber,
        courierStatus: event.courierStatus,
        mappedStatus: event.mappedStatus,
        status: event.status,
        error: event.error,
        receivedAt: event.receivedAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null,
      })),
      courierShipments: o.courierShipments.map((shipment) => ({
        id: shipment.id,
        provider: shipment.provider,
        batchId: shipment.batchId,
        waybillId: shipment.waybillId,
        providerOrderId: shipment.providerOrderId,
        orderReference: shipment.orderReference,
        receiverName: shipment.receiverName,
        receiverStreet: shipment.receiverStreet,
        receiverDistrictId: shipment.receiverDistrictId,
        receiverCityId: shipment.receiverCityId,
        receiverPhone: shipment.receiverPhone,
        description: shipment.description,
        specialNote: shipment.specialNote,
        codAmount: shipment.codAmount,
        courierStatus: shipment.courierStatus,
        mappedStatus: shipment.mappedStatus,
        lastSyncedAt: shipment.lastSyncedAt?.toISOString() ?? null,
        submittedAt: shipment.submittedAt?.toISOString() ?? null,
        createdAt: shipment.createdAt.toISOString(),
        updatedAt: shipment.updatedAt.toISOString(),
      })),
    };
  });

  return (
    <OrdersPageClient
      initialOrders={serialized}
      stats={stats}
      canUpdateOrders={canScope(scope, 'orders:update')}
    />
  );
}
