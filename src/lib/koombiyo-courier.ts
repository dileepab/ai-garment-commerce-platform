import prisma from '@/lib/prisma';
import { OrderRequestError } from '@/lib/orders';
import { mapCourierStatus } from '@/lib/courier-service';
import type { FulfillmentStatus } from '@/lib/fulfillment';
import { getBrandLookupAliases } from '@/lib/brand-aliases';

const KOOMBIYO_PROVIDER = 'koombiyo';
const KOOMBIYO_COURIER_NAME = 'Koombiyo Delivery';
const LOCATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

export interface AssignKoombiyoWaybillInput {
  orderId: number;
  receiverDistrictId?: string | null;
  receiverCityId?: string | null;
  description?: string | null;
  specialNote?: string | null;
  force?: boolean;
  actor?: { email?: string | null; name?: string | null } | null;
}

export interface SubmitKoombiyoDeliveryInput {
  orderId: number;
  force?: boolean;
}

interface KoombiyoDistrict {
  id: string;
  name: string;
  raw: KoombiyoResponseValue;
}

interface KoombiyoCity {
  id: string;
  name: string;
  raw: KoombiyoResponseValue;
}

interface ResolvedKoombiyoLocation {
  districtId: string;
  districtName: string;
  cityId: string;
  cityName: string;
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
  const happybuyKey =
    key === 'HAPPYBUY' || key === 'HAPPYBY' || key === 'HAPPY_BUY'
      ? process.env.KOOMBIYO_API_KEY_HAPPYBUY
      : undefined;
  const legacyHappybyKey =
    key === 'HAPPYBUY' || key === 'HAPPYBY' || key === 'HAPPY_BUY'
      ? process.env.KOOMBIYO_API_KEY_HAPPYBY
      : undefined;
  return cleanApiKey(
    process.env[`KOOMBIYO_API_KEY_${key}`] ||
      happybuyKey ||
      legacyHappybyKey ||
      process.env.KOOMBIYO_API_KEY
  );
}

function getCanonicalBrandForStorage(brand: string): string {
  return getBrandLookupAliases(brand)[0] || brand;
}

function pickPreferredBrandRecord<T extends { brand: string; isActive?: boolean | null; apiKey?: string | null }>(
  brand: string,
  records: T[],
): T | null {
  const cleaned = brand.trim();
  return (
    records.find((record) => record.brand === cleaned && record.isActive && cleanApiKey(record.apiKey)) ||
    records.find((record) => record.isActive && cleanApiKey(record.apiKey)) ||
    records.find((record) => record.brand === cleaned && record.isActive) ||
    records.find((record) => record.isActive) ||
    records.find((record) => record.brand === cleaned && cleanApiKey(record.apiKey)) ||
    records.find((record) => Boolean(cleanApiKey(record.apiKey))) ||
    records.find((record) => record.brand === cleaned) ||
    records[0] ||
    null
  );
}

async function findKoombiyoSettingsRecord(brand: string) {
  const aliases = getBrandLookupAliases(brand);
  if (aliases.length === 0) return null;

  const records = await prisma.courierIntegrationSetting.findMany({
    where: {
      provider: KOOMBIYO_PROVIDER,
      brand: { in: aliases },
    },
  });

  return pickPreferredBrandRecord(brand, records);
}

function compactPayload(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return String(value).slice(0, 8000);
  }
}

function normalizeLocationText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(?:no|road|rd|street|st|lane|ln|mawatha|mw|place|pl|avenue|ave|district|city|town)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function getRecordString(record: Record<string, KoombiyoResponseValue>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!keys.map((candidate) => candidate.toLowerCase().replace(/[^a-z0-9]/g, '')).includes(normalizedKey)) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }

  return null;
}

function collectRecords(value: KoombiyoResponseValue): Array<Record<string, KoombiyoResponseValue>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRecords(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, KoombiyoResponseValue>;
  const nestedRecords = Object.values(record).flatMap((item) => collectRecords(item));
  const primitiveFieldCount = Object.values(record).filter(
    (item) => typeof item === 'string' || typeof item === 'number'
  ).length;

  return primitiveFieldCount > 0 ? [record, ...nestedRecords] : nestedRecords;
}

function parseDistricts(response: KoombiyoResponseValue): KoombiyoDistrict[] {
  const seen = new Set<string>();
  const districts: KoombiyoDistrict[] = [];

  for (const record of collectRecords(response)) {
    const id = getRecordString(record, ['district_id', 'districtId', 'districtid', 'id']);
    const name = getRecordString(record, ['district_name', 'districtName', 'district', 'name']);

    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    districts.push({ id, name, raw: record });
  }

  return districts;
}

function parseCities(response: KoombiyoResponseValue): KoombiyoCity[] {
  const seen = new Set<string>();
  const cities: KoombiyoCity[] = [];

  for (const record of collectRecords(response)) {
    const id = getRecordString(record, ['city_id', 'cityId', 'cityid', 'id']);
    const name = getRecordString(record, ['city_name', 'cityName', 'city', 'name']);

    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    cities.push({ id, name, raw: record });
  }

  return cities;
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
  const record = await findKoombiyoSettingsRecord(brand);
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
  const record = await findKoombiyoSettingsRecord(brand);
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

async function fetchKoombiyoDistricts(apiKey: string): Promise<KoombiyoDistrict[]> {
  const response = await postKoombiyoForm('/api/Districts/users', { apikey: apiKey });
  const districts = parseDistricts(response);

  if (districts.length === 0) {
    throw new OrderRequestError(
      `Koombiyo returned an unexpected district response: ${stringifyKoombiyoMessage(response)}`,
      502,
    );
  }

  return districts;
}

async function fetchKoombiyoCities(apiKey: string, districtId: string): Promise<KoombiyoCity[]> {
  const response = await postKoombiyoForm('/api/Cities/users', {
    apikey: apiKey,
    district_id: districtId,
  });

  return parseCities(response);
}

export async function syncKoombiyoLocationsForBrand(brand: string): Promise<number> {
  const apiKey = await resolveKoombiyoApiKey(brand);
  const storageBrand = getCanonicalBrandForStorage(brand);
  const districts = await fetchKoombiyoDistricts(apiKey);
  let synced = 0;

  for (const district of districts) {
    const cities = await fetchKoombiyoCities(apiKey, district.id);

    for (const city of cities) {
      await prisma.courierLocation.upsert({
        where: {
          brand_provider_districtId_cityId: {
            brand: storageBrand,
            provider: KOOMBIYO_PROVIDER,
            districtId: district.id,
            cityId: city.id,
          },
        },
        create: {
          brand: storageBrand,
          provider: KOOMBIYO_PROVIDER,
          districtId: district.id,
          districtName: district.name,
          cityId: city.id,
          cityName: city.name,
          normalized: normalizeLocationText(`${city.name} ${district.name}`),
          rawPayload: compactPayload({ district: district.raw, city: city.raw }),
          syncedAt: new Date(),
        },
        update: {
          districtName: district.name,
          cityName: city.name,
          normalized: normalizeLocationText(`${city.name} ${district.name}`),
          rawPayload: compactPayload({ district: district.raw, city: city.raw }),
          syncedAt: new Date(),
        },
      });
      synced += 1;
    }
  }

  return synced;
}

async function ensureKoombiyoLocations(brand: string): Promise<void> {
  const aliases = getBrandLookupAliases(brand);
  const latest = await prisma.courierLocation.findFirst({
    where: { brand: { in: aliases }, provider: KOOMBIYO_PROVIDER },
    orderBy: { syncedAt: 'desc' },
    select: { syncedAt: true },
  });

  if (!latest || Date.now() - latest.syncedAt.getTime() > LOCATION_CACHE_TTL_MS) {
    await syncKoombiyoLocationsForBrand(brand);
  }
}

async function resolveKoombiyoLocationFromAddress(
  brand: string,
  address: string,
): Promise<ResolvedKoombiyoLocation | null> {
  await ensureKoombiyoLocations(brand);

  const normalizedAddress = normalizeLocationText(address);
  if (!normalizedAddress) return null;

  const locations = await prisma.courierLocation.findMany({
    where: { brand: { in: getBrandLookupAliases(brand) }, provider: KOOMBIYO_PROVIDER },
    select: {
      districtId: true,
      districtName: true,
      cityId: true,
      cityName: true,
      normalized: true,
    },
  });

  const scored = locations
    .map((location) => {
      const city = normalizeLocationText(location.cityName);
      const district = normalizeLocationText(location.districtName);
      let score = 0;

      if (city && normalizedAddress.includes(city)) score += city.length + 20;
      if (district && normalizedAddress.includes(district)) score += district.length + 10;
      if (location.normalized && normalizedAddress.includes(location.normalized)) score += 50;

      return { location, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  const tied = scored.filter((entry) => entry.score === best.score);
  if (tied.length > 1) {
    const bestCity = normalizeLocationText(best.location.cityName);
    const exactCityMatches = tied.filter((entry) => normalizeLocationText(entry.location.cityName) === bestCity);
    if (exactCityMatches.length !== 1) return null;
  }

  return best.location;
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

function resolveCodAmount(order: { totalAmount: number; paymentMethod: string | null }): number {
  return /\b(cod|cash on delivery)\b/i.test(order.paymentMethod || '')
    ? Math.round(order.totalAmount)
    : 0;
}

export async function assignKoombiyoWaybill(input: AssignKoombiyoWaybillInput) {
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

  const settings = await findKoombiyoSettingsRecord(brand);

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

  if (!order.customer.phone?.trim()) {
    throw new OrderRequestError('Customer phone is required to create a Koombiyo delivery.', 400);
  }

  const receiverStreet = cleanOptionalText(order.deliveryStreetAddress) || cleanOptionalText(order.deliveryAddress);
  const locationText = [
    order.deliveryCity,
    order.deliveryDistrict,
    order.deliveryAddress,
  ].filter(Boolean).join(', ');

  if (!receiverStreet) {
    throw new OrderRequestError('Delivery address is required to create a Koombiyo delivery.', 400);
  }

  const overrideDistrictId = cleanOptionalText(input.receiverDistrictId);
  const overrideCityId = cleanOptionalText(input.receiverCityId);
  const resolvedLocation =
    overrideDistrictId && overrideCityId
      ? null
      : await resolveKoombiyoLocationFromAddress(brand, locationText);
  const receiverDistrictId =
    overrideDistrictId ||
    resolvedLocation?.districtId ||
    settings.defaultReceiverDistrictId ||
    null;
  const receiverCityId =
    overrideCityId ||
    resolvedLocation?.cityId ||
    settings.defaultReceiverCityId ||
    null;

  if (!receiverDistrictId || !receiverCityId) {
    throw new OrderRequestError(
      `Could not automatically match "${locationText || receiverStreet}" to a Koombiyo city. Update the order city/town and district or enter Koombiyo district/city IDs as an override.`,
      409,
    );
  }

  const apiKey = await resolveKoombiyoApiKey(brand);
  const waybill = await fetchAllocatedWaybill(apiKey);
  const orderReference = `ORD-${order.id}`;
  const description = cleanOptionalText(input.description) || buildOrderDescription(order);
  const specialNote = cleanOptionalText(input.specialNote) || `Brand: ${brand}`;
  const codAmount = resolveCodAmount(order);
  const rawResponse = compactPayload({
    waybill: parseKoombiyoResponse(waybill.rawResponse),
  });

  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.courierShipment.create({
      data: {
        orderId: order.id,
        brand,
        provider: KOOMBIYO_PROVIDER,
        waybillId: waybill.waybillId,
        orderReference,
        receiverName: order.customer.name,
        receiverStreet,
        receiverDistrictId,
        receiverCityId,
        receiverPhone: order.customer.phone,
        description,
        specialNote,
        codAmount,
        courierStatus: 'waybill_assigned',
        rawResponse,
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
        note: `Koombiyo waybill ${waybill.waybillId} assigned for packing label.`,
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

export async function submitKoombiyoDelivery(input: SubmitKoombiyoDeliveryInput) {
  const shipment = await prisma.courierShipment.findFirst({
    where: { orderId: input.orderId, provider: KOOMBIYO_PROVIDER },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { brand: true, orderStatus: true } } },
  });

  if (!shipment) {
    throw new OrderRequestError(`Order #${input.orderId} does not have an assigned Koombiyo waybill yet.`, 404);
  }

  if (shipment.submittedAt && !input.force) {
    throw new OrderRequestError(
      `Order #${input.orderId} was already sent to Koombiyo with waybill ${shipment.waybillId}.`,
      409,
    );
  }

  const brand = cleanOptionalText(shipment.brand || shipment.order.brand);
  if (!brand) {
    throw new OrderRequestError('This shipment does not have a brand, so the Koombiyo account cannot be selected.', 409);
  }

  const requiredFields = {
    receiverName: shipment.receiverName,
    receiverStreet: shipment.receiverStreet,
    receiverDistrictId: shipment.receiverDistrictId,
    receiverCityId: shipment.receiverCityId,
    receiverPhone: shipment.receiverPhone,
    description: shipment.description,
  };
  const missing = Object.entries(requiredFields)
    .filter(([, value]) => !cleanOptionalText(value))
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new OrderRequestError(
      `The Koombiyo label snapshot is missing ${missing.join(', ')}. Assign a fresh waybill before sending.`,
      409,
    );
  }

  const apiKey = await resolveKoombiyoApiKey(brand);
  const addOrderResponse = await postKoombiyoForm('/api/Addorders/users', {
    apikey: apiKey,
    orderWaybillid: shipment.waybillId,
    orderNo: shipment.orderReference || `ORD-${input.orderId}`,
    receiverName: shipment.receiverName!,
    receiverStreet: shipment.receiverStreet!,
    receiverDistrict: shipment.receiverDistrictId!,
    receiverCity: shipment.receiverCityId!,
    receiverPhone: shipment.receiverPhone!,
    description: shipment.description!,
    spclNote: shipment.specialNote || `Brand: ${brand}`,
    getCod: String(shipment.codAmount ?? 0),
  });
  const courierStatus = extractStatus(addOrderResponse) || 'submitted';
  const mappedStatus: FulfillmentStatus = mapCourierStatus(KOOMBIYO_PROVIDER, courierStatus);

  return prisma.courierShipment.update({
    where: { id: shipment.id },
    data: {
      providerOrderId: extractProviderOrderId(addOrderResponse),
      courierStatus,
      mappedStatus,
      rawResponse: compactPayload(addOrderResponse),
      submittedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });
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

  if (!shipment.submittedAt) {
    throw new OrderRequestError(`Order #${input.orderId} has a Koombiyo waybill but has not been sent to Koombiyo yet.`, 409);
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
