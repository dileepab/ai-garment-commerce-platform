import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { logInfo, logWarn } from '@/lib/app-log';
import { createOrderFromCatalog } from '@/lib/orders';
import { parseStorefrontOrder } from '@/lib/storefront-checkout';

export const dynamic = 'force-dynamic';

/**
 * Orders placed on the public storefront.
 *
 * Until this existed the checkout button only changed React state, so an
 * order placed on the website was lost on refresh and the business never saw
 * it. That is also why no ad could be optimised for purchases: there were no
 * purchases to report.
 *
 * The shopper's browser never reaches here — the storefront's own server
 * forwards the order, so this is a server-to-server call and no cross-origin
 * request is involved.
 *
 * Shoppers have no account, so the request is authenticated by a shared key
 * rather than a session. Everything that matters is recomputed here or in
 * createOrderFromCatalog, and nothing about money is taken from the request.
 */

/** Cash on delivery costs the shopper nothing up front, so spam is cheap. */
const MAX_ORDERS_PER_PHONE_PER_HOUR = 3;

/**
 * Whether the caller is the storefront.
 *
 * Fails closed when no key is configured: an open endpoint that creates cash
 * on delivery orders costs real packing and courier work per abusive request.
 */
function isStorefront(request: Request): boolean {
  const expected = (process.env.STOREFRONT_API_KEY || '').trim();
  if (!expected) return false;
  return request.headers.get('x-storefront-key') === expected;
}

export async function POST(request: Request) {
  const headers: Record<string, string> = {};

  if (!isStorefront(request)) {
    return NextResponse.json(
      { success: false, error: 'Ordering is unavailable right now.' },
      { status: 401 }
    );
  }

  try {
    const parsed = parseStorefrontOrder(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400, headers });
    }

    const order = parsed.value;

    const customer = await prisma.customer.upsert({
      // Web shoppers have no Meta sender id, so the phone is the identity.
      // Prefixed so a web shopper and a WhatsApp contact never collide.
      where: { externalId: `web:${order.phone}` },
      update: { name: order.name, phone: order.phone, preferredBrand: order.brand },
      create: {
        externalId: `web:${order.phone}`,
        name: order.name,
        phone: order.phone,
        channel: 'web',
        preferredBrand: order.brand,
      },
    });

    const recentOrders = await prisma.order.count({
      where: {
        customerId: customer.id,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    if (recentOrders >= MAX_ORDERS_PER_PHONE_PER_HOUR) {
      logWarn('Storefront checkout', 'Refused a repeat order from the same number.', {
        customerId: customer.id,
        recentOrders,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'We already have an order from this number. Please call us to add to it.',
        },
        { status: 429, headers }
      );
    }

    const created = await createOrderFromCatalog(prisma, {
      customerId: customer.id,
      brand: order.brand,
      deliveryStreetAddress: order.streetAddress,
      deliveryCity: order.city,
      deliveryDistrict: order.district,
      deliveryAddress: [order.streetAddress, order.city, order.district]
        .filter(Boolean)
        .join(', '),
      paymentMethod: order.paymentMethod,
      // Sits in the same state a WhatsApp order starts in, so the existing
      // packing and courier flow picks it up with no special handling.
      orderStatus: 'pending',
      adSourceType: order.adClickId ? 'ad' : null,
      adClickId: order.adClickId,
      items: order.items,
    });

    logInfo('Storefront checkout', 'Took an order from the website.', {
      orderId: created.id,
      brand: order.brand,
      fromAd: Boolean(order.adClickId),
    });

    return NextResponse.json(
      {
        success: true,
        // Enough for a confirmation screen, and nothing else about the buyer.
        data: { orderId: created.id, totalAmount: created.totalAmount },
      },
      { headers }
    );
  } catch (error) {
    logWarn('Storefront checkout', 'Could not take a website order.', {
      error: getErrorMessage(error),
    });
    return NextResponse.json(
      { success: false, error: 'We could not place that order. Please try again.' },
      { status: 500, headers }
    );
  }
}
