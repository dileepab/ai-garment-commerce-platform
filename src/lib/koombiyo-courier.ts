import prisma from '@/lib/prisma';
import { OrderRequestError } from '@/lib/orders';
import { mapCourierStatus } from '@/lib/courier-service';
import type { FulfillmentStatus } from '@/lib/fulfillment';

const KOOMBIYO_PROVIDER = 'koombiyo';
const KOOMBIYO_COURIER_NAME = 'Koombiyo Delivery';
const KOOMBIYO_BASE_URL =
  process.env.KOOMBIYO_BASE_URL?.trim().replace(/\/+$/, '') ||
  'https://application.koombiyodelivery.lk';

type KoombiyoResponseValue =
  | string
  | number
  | boolean
  | null
  | KoombiyoResponseValue[]
  | { [key: string]: KoombiyoResponseValue };

export interface KoombiyoSettingsView {
  brand: string;
  provider: 'koombiyo';
  isActive: boolean;
  hasApiKey: boolean;
  apiKeySource: 'database' | 'env' | 'missing';
  senderName: string | null;
  senderAddress: string | null;
  senderPhone: string | null;
  defaultReceiverDistrictId: string | null;
  defaultReceiverCityId: string | null;
  notes: string | null;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
}

export interface CreateKoombiyoDeliveryInput {
  orderId: number;
  receiverDistrictId: string;
  receiverCityId: string;
  description?: string | null;
  specialNote?: string | null;
  force?: boolean;
  actor?: { email?: string | null; name?: string | null } | null;
}

export interface RefreshKoombiyoStatusInput {
  orderId: number;
  actor?: { email?: string | null; name?: string | null } | null;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanApiKey(value?: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, '').trim().replace(/^["'`]+|["'`]+$/g, '');
  return cleaned ? cleaned : null;
}

function brandEnvKey(brand: string): string {
  return brand.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function getEnvApiKey(brand: string): string | null {
  const key = brandEnvKey(brand);
  return cleanApiKey(process.env[`KOOMBIYO_API_KEY_${key}`] || process.env.KOOMBIYO_API_KEY);
}

function compactPayload(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return String(value).slice(0, 8000);
  }
}

function parseKoombiyoResponse(text: string): KoombiyoResponseValue {
  const trimmed = text.trim();
  if (!trimmed) return '';

  try {
    return JSON.parse(trimmed) as KoombiyoResponseValue;
  } catch {
    return trimmed;
  }
}

function stringifyKoombiyoMessage(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'msg', 'status', 'response']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.slice(0, 500);
    }
  }
  return compactPayload(value).slice(0, 500);
}

function responseLooksFailed(value: KoombiyoResponseValue): boolean {
  if (typeof value === 'string') {
    return /\b(error|fail|invalid|unauthori[sz]ed|not found)\b/i.test(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const record = value as Record<string, KoombiyoResponseValue>;
  const status = record.status ?? record.success ?? record.result;
  if (status === false) return true;
  if (typeof status === 'string' && /^(false|failed|error|invalid)$/i.test(status.trim())) return true;

  const message = stringifyKoombiyoMessage(value);
  return /\b(error|fail|invalid|unauthori[sz]ed)\b/i.test(message);
}

function walkResponse(
  value: KoombiyoResponseValue,
  visitor: (key: string, primitive: string) => string | null,
  key = '',
): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return visitor(key, String(value).trim());
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkResponse(item, visitor, key);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      const found = walkResponse(childValue, visitor, childKey);
      if (found) return found;
    }
  }

  return null;
}

function extractWaybillId(value: KoombiyoResponseValue): string | null {
  const keyed = walkResponse(value, (key, primitive) => {
    const normalizedKey = key.toLowerCase();
    if (
      primitive &&
      /\d{4,}/.test(primitive) &&
      (normalizedKey.includes('waybill') ||
        normalizedKey.includes('barcode') ||
        normalizedKey === 'id' ||
        normalizedKey.includes('awb'))
    ) {
      return primitive;
    }
    return null;
  });

  if (keyed) return keyed;

  return walkResponse(value, (_key, primitive) => (/\d{6,}/.test(primitive) ? primitive : null));
}

function extractStatus(value: KoombiyoResponseValue): string | null {
  return walkResponse(value, (key, primitive) => {
    const normalizedKey = key.toLowerCase();
    if (
      primitive &&
      (normalizedKey.includes('status') ||
        normalizedKey.includes('state') ||
        normalizedKey.includes('delivery_status'))
    ) {
      return primitive;
    }
    return null;
  });
}

function extractProviderOrderId(value: KoombiyoResponseValue): string | null {
  return walkResponse(value, (key, primitive) => {
    const normalizedKey = key.toLowerCase();
    if (
      primitive &&
      (normalizedKey.includes('orderid') ||
        normalizedKey.includes('order_id') ||
        normalizedKey.includes('deliveryid') ||
        normalizedKey.includes('delivery_id'))
    ) {
      return primitive;
    }
    return null;
  });
}

async function postKoombiyoForm(path: string, fields: Record<string, string>): Promise<KoombiyoResponseValue> {
  const response = await fetch(`${KOOMBIYO_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    cache: 'no-store',
  });
  const text = await response.text();
  const parsed = parseKoombiyoResponse(text);

  if (!response.ok) {
    throw new OrderRequestError(
      `Koombiyo request failed (${response.status}): ${stringifyKoombiyoMessage(parsed)}`,
      502,
    );
  }

  if (responseLooksFailed(parsed)) {
    throw new OrderRequestError(`Koombiyo rejected the request: ${stringifyKoombiyoMessage(parsed)}`, 502);
  }

  return parsed;
}

export async function getKoombiyoSettingsView(brand: string): Promise<KoombiyoSettingsView> {
  const record = await prisma.courierIntegrationSetting.findUnique({
    where: { brand_provider: { brand, provider: KOOMBIYO_PROVIDER } },
  });
  const envApiKey = getEnvApiKey(brand);
  const dbApiKey = cleanApiKey(record?.apiKey);
  const apiKeySource = dbApiKey ? 'database' : envApiKey ? 'env' : 'missing';

  return {
    brand,
    provider: KOOMBIYO_PROVIDER,
    isActive: record?.isActive ?? false,
    hasApiKey: Boolean(dbApiKey || envApiKey),
    apiKeySource,
    senderName: record?.senderName ?? null,
    senderAddress: record?.senderAddress ?? null,
    senderPhone: record?.senderPhone ?? null,
    defaultReceiverDistrictId: record?.defaultReceiverDistrictId ?? null,
    defaultReceiverCityId: record?.defaultReceiverCityId ?? null,
    notes: record?.notes ?? null,
    lastTestAt: record?.lastTestAt?.toISOString() ?? null,
    lastTestStatus: record?.lastTestStatus ?? null,
    lastTestMessage: record?.lastTestMessage ?? null,
  };
}

async function resolveKoombiyoApiKey(brand: string): Promise<string> {
  const record = await prisma.courierIntegrationSetting.findUnique({
    where: { brand_provider: { brand, provider: KOOMBIYO_PROVIDER } },
    select: { apiKey: true },
  });
  const apiKey = cleanApiKey(record?.apiKey) || getEnvApiKey(brand);

  if (!apiKey) {
    throw new OrderRequestError(`Koombiyo API key is not configured for ${brand}.`, 409);
  }

  return apiKey;
}

export async function testKoombiyoConnectionForBrand(brand: string) {
  const apiKey = await resolveKoombiyoApiKey(brand);
  const response = await postKoombiyoForm('/api/Districts/users', { apikey: apiKey });
  return {
    ok: true,
    message: `Koombiyo connection succeeded for ${brand}.`,
    rawResponse: compactPayload(response),
  };
}

async function fetchAllocatedWaybill(apiKey: string): Promise<{ waybillId: string; rawResponse: string }> {
  const response = await postKoombiyoForm('/api/Waybils/users', {
    apikey: apiKey,
    limit: '1',
  });
  const waybillId = extractWaybillId(response);

  if (!waybillId) {
    throw new OrderRequestError(
      `Koombiyo returned an unexpected waybill response: ${stringifyKoombiyoMessage(response)}`,
      502,
    );
  }

  return { waybillId, rawResponse: compactPayload(response) };
}

function buildOrderDescription(order: {
  orderItems: Array<{
    quantity: number;
    size: string | null;
    color: string | null;
    product: { name: string; style: string } | null;
  }>;
}): string {
  const lines = order.orderItems.map((item) => {
    const product = item.product?.name || item.product?.style || 'Garment';
    const variant = [item.size, item.color].filter(Boolean).join(' ');
    return `${product}${variant ? ` (${variant})` : ''} x${item.quantity}`;
  });

  return (lines.join(', ') || 'Garment order').slice(0, 240);
}

function resolveCodAmount(order: { totalAmount: number; paymentMethod: string | null }): string {
  return /\b(cod|cash on delivery)\b/i.test(order.paymentMethod || '')
    ? String(Math.round(order.totalAmount))
    : '0';
}

export async function createKoombiyoDelivery(input: CreateKoombiyoDeliveryInput) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      customer: true,
      orderItems: { include: { product: true } },
      courierShipments: {
        where: { provider: KOOMBIYO_PROVIDER },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!order) {
    throw new OrderRequestError(`Order #${input.orderId} was not found.`, 404);
  }

  const brand = cleanOptionalText(order.brand);
  if (!brand) {
    throw new OrderRequestError('This order does not have a brand, so a brand courier account cannot be selected.', 409);
  }

  const settings = await prisma.courierIntegrationSetting.findUnique({
    where: { brand_provider: { brand, provider: KOOMBIYO_PROVIDER } },
  });

  if (!settings?.isActive) {
    throw new OrderRequestError(`Koombiyo is not active for ${brand}. Enable it in Settings first.`, 409);
  }

  const duplicate = order.courierShipments[0];
  if (duplicate && !input.force) {
    throw new OrderRequestError(
      `Order #${order.id} already has Koombiyo waybill ${duplicate.waybillId}. Confirm retry to create another delivery.`,
      409,
    );
  }

  const receiverDistrictId = cleanOptionalText(input.receiverDistrictId) || settings.defaultReceiverDistrictId;
  const receiverCityId = cleanOptionalText(input.receiverCityId) || settings.defaultReceiverCityId;

  if (!receiverDistrictId || !receiverCityId) {
    throw new OrderRequestError('Koombiyo district ID and city ID are required to create a delivery.', 400);
  }

  if (!order.customer.phone?.trim()) {
    throw new OrderRequestError('Customer phone is required to create a Koombiyo delivery.', 400);
  }

  if (!order.deliveryAddress?.trim()) {
    throw new OrderRequestError('Delivery address is required to create a Koombiyo delivery.', 400);
  }

  const apiKey = await resolveKoombiyoApiKey(brand);
  const waybill = await fetchAllocatedWaybill(apiKey);
  const orderReference = `ORD-${order.id}`;
  const description = cleanOptionalText(input.description) || buildOrderDescription(order);
  const specialNote = cleanOptionalText(input.specialNote) || `Brand: ${brand}`;
  const addOrderResponse = await postKoombiyoForm('/api/Addorders/users', {
    apikey: apiKey,
    orderWaybillid: waybill.waybillId,
    orderNo: orderReference,
    receiverName: order.customer.name,
    receiverStreet: order.deliveryAddress,
    receiverDistrict: receiverDistrictId,
    receiverCity: receiverCityId,
    receiverPhone: order.customer.phone,
    description,
    spclNote: specialNote,
    getCod: resolveCodAmount(order),
  });
  const rawResponse = compactPayload({
    waybill: parseKoombiyoResponse(waybill.rawResponse),
    addOrder: addOrderResponse,
  });
  const courierStatus = extractStatus(addOrderResponse) || 'created';
  const mappedStatus: FulfillmentStatus = mapCourierStatus(KOOMBIYO_PROVIDER, courierStatus);

  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.courierShipment.create({
      data: {
        orderId: order.id,
        brand,
        provider: KOOMBIYO_PROVIDER,
        waybillId: waybill.waybillId,
        providerOrderId: extractProviderOrderId(addOrderResponse),
        orderReference,
        courierStatus,
        mappedStatus,
        rawResponse,
        lastSyncedAt: new Date(),
        createdByEmail: input.actor?.email ?? null,
        createdByName: input.actor?.name ?? null,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        trackingNumber: waybill.waybillId,
        courier: KOOMBIYO_COURIER_NAME,
      },
    });

    await tx.orderFulfillmentEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.orderStatus,
        toStatus: order.orderStatus,
        note: `Koombiyo delivery created with waybill ${waybill.waybillId}.`,
        trackingNumber: waybill.waybillId,
        courier: KOOMBIYO_COURIER_NAME,
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.name ?? null,
      },
    });

    return created;
  });

  return shipment;
}

export async function refreshKoombiyoShipmentStatus(input: RefreshKoombiyoStatusInput) {
  const shipment = await prisma.courierShipment.findFirst({
    where: { orderId: input.orderId, provider: KOOMBIYO_PROVIDER },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { brand: true, orderStatus: true } } },
  });

  if (!shipment) {
    throw new OrderRequestError(`Order #${input.orderId} does not have a Koombiyo delivery yet.`, 404);
  }

  const brand = cleanOptionalText(shipment.brand || shipment.order.brand);
  if (!brand) {
    throw new OrderRequestError('This shipment does not have a brand, so the Koombiyo account cannot be selected.', 409);
  }

  const apiKey = await resolveKoombiyoApiKey(brand);
  const response = await postKoombiyoForm('/api/Allorders/users', {
    apikey: apiKey,
    waybillid: shipment.waybillId,
    offset: '0',
    limit: '1',
  });
  const courierStatus = extractStatus(response) || shipment.courierStatus || 'unknown';
  const mappedStatus = mapCourierStatus(KOOMBIYO_PROVIDER, courierStatus);
  const updated = await prisma.courierShipment.update({
    where: { id: shipment.id },
    data: {
      courierStatus,
      mappedStatus,
      rawResponse: compactPayload(response),
      lastSyncedAt: new Date(),
    },
  });

  return updated;
}

export const KOOMBIYO_PROVIDER_ID = KOOMBIYO_PROVIDER;
export const KOOMBIYO_COURIER_DISPLAY_NAME = KOOMBIYO_COURIER_NAME;
