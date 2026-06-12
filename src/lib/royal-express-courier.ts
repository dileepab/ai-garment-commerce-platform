import prisma from '@/lib/prisma';
import { OrderRequestError } from '@/lib/orders';
import { mapCourierStatus } from '@/lib/courier-service';
import type { FulfillmentStatus } from '@/lib/fulfillment';
import { getBrandLookupAliases } from '@/lib/brand-aliases';
import { getDeliveryChargeForAddress } from '@/lib/order-draft/pricing';
import { getMerchantSettings } from '@/lib/runtime-config';
import type { CourierShipment } from '@prisma/client';
import royalExpressCityList from '@/data/royalexpress-city-list.json';

const ROYALEXPRESS_PROVIDER = 'royalexpress';
const ROYALEXPRESS_COURIER_NAME = 'RoyalExpress';
const CURFOX_BASE_URL =
  process.env.ROYALEXPRESS_CURFOX_BASE_URL?.trim().replace(/\/+$/, '') ||
  process.env.CURFOX_BASE_URL?.trim().replace(/\/+$/, '') ||
  'https://v1.api.curfox.com';
const CURFOX_TENANT =
  process.env.ROYALEXPRESS_CURFOX_TENANT?.trim() ||
  process.env.CURFOX_TENANT?.trim() ||
  'royalexpress';
const CURFOX_API_STYLE = (
  process.env.ROYALEXPRESS_CURFOX_API_STYLE?.trim().toLowerCase() ||
  process.env.CURFOX_API_STYLE?.trim().toLowerCase() ||
  ''
);
const USE_TENANT_PATHS =
  CURFOX_API_STYLE === 'tenant' ||
  CURFOX_API_STYLE === 'v2' ||
  CURFOX_BASE_URL.includes('v2-') ||
  /\/api$/i.test(CURFOX_BASE_URL);
const CURFOX_CITY_LIST_PATH_OVERRIDE =
  process.env.ROYALEXPRESS_CURFOX_CITY_LIST_PATH?.trim() ||
  process.env.CURFOX_CITY_LIST_PATH?.trim() ||
  '';
const CURFOX_PATHS = {
  login: USE_TENANT_PATHS ? '/merchant/login' : '/api/public/merchant/login',
  userInfo: USE_TENANT_PATHS ? '/merchant/user/get-current' : '/api/public/merchant/user/get-current',
  orderSingle: USE_TENANT_PATHS ? '/merchant/order/single' : '/api/public/merchant/order/single',
  trackingInfo: USE_TENANT_PATHS ? '/merchant/order/tracking-info' : '/api/public/merchant/order/tracking-info',
};
const CURFOX_CITY_LIST_PATHS = USE_TENANT_PATHS
  ? [
      CURFOX_CITY_LIST_PATH_OVERRIDE,
      '/merchant/resource/city-list?noPaginationNoFilter',
      '/merchant/resources/city-list',
      '/merchant/resource/city-list',
      '/merchant/resources/cities',
      '/merchant/resource/cities',
      '/merchant/city/list',
      '/api/merchant/resource/city-list?noPaginationNoFilter',
      '/api/merchant/resource/city-list',
      '/api/public/merchant/resources/city-list',
      '/api/public/merchant/resource/city-list',
      '/api/public/merchant/resources/cities',
      '/api/public/merchant/resource/cities',
      '/api/public/merchant/city/list',
    ].filter(Boolean)
  : [
      CURFOX_CITY_LIST_PATH_OVERRIDE,
      '/api/merchant/resource/city-list?noPaginationNoFilter',
      '/api/merchant/resource/city-list',
      '/api/public/merchant/resources/city-list',
      '/api/public/merchant/resource/city-list',
      '/api/public/merchant/resources/cities',
      '/api/public/merchant/resource/cities',
      '/api/public/merchant/city/list',
      '/merchant/resource/city-list?noPaginationNoFilter',
      '/merchant/resources/city-list',
      '/merchant/resource/city-list',
      '/merchant/resources/cities',
      '/merchant/resource/cities',
      '/merchant/city/list',
    ].filter(Boolean);
const CURFOX_BUSINESS_LIST_PATHS = USE_TENANT_PATHS
  ? [
      '/merchant/resource/business-list',
      '/merchant/resources/business-list',
      '/api/merchant/resource/business-list',
      '/api/merchant/resources/business-list',
    ]
  : [
      '/api/merchant/resource/business-list',
      '/api/merchant/resources/business-list',
      '/merchant/resource/business-list',
      '/merchant/resources/business-list',
    ];
const CURFOX_BUSINESS_ADDRESS_PATHS = (businessId: string) =>
  USE_TENANT_PATHS
    ? [
        `/merchant/business/${businessId}/addresses/list?concat=true`,
        `/api/merchant/business/${businessId}/addresses/list?concat=true`,
      ]
    : [
        `/api/merchant/business/${businessId}/addresses/list?concat=true`,
        `/merchant/business/${businessId}/addresses/list?concat=true`,
      ];
const SEND_ROYALEXPRESS_ORIGIN_CITY_ID =
  process.env.ROYALEXPRESS_SEND_ORIGIN_CITY_ID?.trim() === '1' ||
  process.env.CURFOX_SEND_ORIGIN_CITY_ID?.trim() === '1';

type CurfoxResponseValue =
  | string
  | number
  | boolean
  | null
  | CurfoxResponseValue[]
  | { [key: string]: CurfoxResponseValue };

interface ResolvedRoyalExpressCredentials {
  email: string;
  password: string;
  merchantBusinessId: string;
  pickupAddressId: string;
  originCityId: string | null;
  originCityName: string | null;
  senderAddress: string | null;
  defaultDestinationCityId: string | null;
}

interface RoyalExpressStaticCity {
  id: number;
  name: string;
}

export interface RoyalExpressSettingsView {
  brand: string;
  provider: 'royalexpress';
  isActive: boolean;
  hasCredentials: boolean;
  credentialSource: 'database' | 'env' | 'missing';
  accountEmail: string | null;
  merchantBusinessId: string | null;
  pickupAddressId: string | null;
  originCityId: string | null;
  defaultDestinationCityId: string | null;
  notes: string | null;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
}

export interface SubmitRoyalExpressDeliveryForDispatchInput {
  orderId: number;
  batchId?: number | null;
  actor?: { email?: string | null; name?: string | null } | null;
}

export interface RefreshRoyalExpressStatusInput {
  orderId: number;
  actor?: { email?: string | null; name?: string | null } | null;
}

export interface ProcessRoyalExpressBatchInput {
  orderIds: number[];
  brand?: string | null;
  cutoffAt: Date;
  actor?: { email?: string | null; name?: string | null } | null;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanSecret(value?: string | null): string | null {
  const cleaned = value?.trim().replace(/^["'`]+|["'`]+$/g, '');
  return cleaned ? cleaned : null;
}

function brandEnvKey(brand: string): string {
  return brand.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function getCanonicalBrandForStorage(brand: string): string {
  return getBrandLookupAliases(brand)[0] || brand;
}

function getEnvCredential(brand: string, key: string): string | null {
  const brandKey = brandEnvKey(brand);
  return cleanSecret(
    process.env[`ROYALEXPRESS_${key}_${brandKey}`] ||
      process.env[`ROYAL_EXPRESS_${key}_${brandKey}`] ||
      process.env[`CURFOX_${key}_${brandKey}`] ||
      process.env[`ROYALEXPRESS_${key}`] ||
      process.env[`ROYAL_EXPRESS_${key}`] ||
      process.env[`CURFOX_${key}`],
  );
}

function hasDatabaseCredentials(record: {
  accountEmail?: string | null;
  accountPassword?: string | null;
  merchantBusinessId?: string | null;
  pickupAddressId?: string | null;
}) {
  return Boolean(
    cleanSecret(record.accountEmail) &&
      cleanSecret(record.accountPassword) &&
      cleanOptionalText(record.merchantBusinessId) &&
      cleanOptionalText(record.pickupAddressId),
  );
}

function pickPreferredBrandRecord<
  T extends {
    brand: string;
    isActive?: boolean | null;
    accountEmail?: string | null;
    accountPassword?: string | null;
    merchantBusinessId?: string | null;
    pickupAddressId?: string | null;
  },
>(brand: string, records: T[]): T | null {
  const cleaned = brand.trim();
  return (
    records.find((record) => record.brand === cleaned && record.isActive && hasDatabaseCredentials(record)) ||
    records.find((record) => record.isActive && hasDatabaseCredentials(record)) ||
    records.find((record) => record.brand === cleaned && record.isActive) ||
    records.find((record) => record.isActive) ||
    records.find((record) => record.brand === cleaned && hasDatabaseCredentials(record)) ||
    records.find((record) => hasDatabaseCredentials(record)) ||
    records.find((record) => record.brand === cleaned) ||
    records[0] ||
    null
  );
}

async function findRoyalExpressSettingsRecord(brand: string) {
  const aliases = getBrandLookupAliases(brand);
  if (aliases.length === 0) return null;

  const records = await prisma.courierIntegrationSetting.findMany({
    where: {
      provider: ROYALEXPRESS_PROVIDER,
      brand: { in: aliases },
    },
  });

  return pickPreferredBrandRecord(brand, records);
}

async function findActiveRoyalExpressOrderContext(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, brand: true, orderStatus: true },
  });

  if (!order) {
    throw new OrderRequestError(`Order #${orderId} was not found.`, 404);
  }

  const brand = cleanOptionalText(order.brand);
  if (!brand) return null;

  const settings = await findRoyalExpressSettingsRecord(brand);
  if (!settings?.isActive) return null;

  return { order, brand };
}

export async function isRoyalExpressActiveForBrand(brand?: string | null): Promise<boolean> {
  const cleaned = cleanOptionalText(brand);
  if (!cleaned) return false;

  const settings = await findRoyalExpressSettingsRecord(cleaned);
  return Boolean(settings?.isActive);
}

function compactPayload(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return String(value).slice(0, 8000);
  }
}

function parseCurfoxResponse(text: string): CurfoxResponseValue {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as CurfoxResponseValue;
  } catch {
    return trimmed;
  }
}

function stringifyCurfoxMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = record.message || record.error || record.detail;
    const errors = record.errors;
    if (message && errors) {
      return `${stringifyCurfoxMessage(message)}: ${stringifyCurfoxMessage(errors)}`;
    }
    if (message) {
      return stringifyCurfoxMessage(message);
    }
    if (errors) {
      return stringifyCurfoxMessage(errors);
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: CurfoxResponseValue): value is Record<string, CurfoxResponseValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectRecords(value: CurfoxResponseValue): Array<Record<string, CurfoxResponseValue>> {
  const records: Array<Record<string, CurfoxResponseValue>> = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      records.push(...collectRecords(item));
    }
    return records;
  }
  if (!isRecord(value)) return records;
  records.push(value);
  for (const item of Object.values(value)) {
    records.push(...collectRecords(item));
  }
  return records;
}

function getRecordString(record: Record<string, CurfoxResponseValue>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const cleaned = cleanOptionalText(String(value));
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function extractBearerToken(value: CurfoxResponseValue): string | null {
  const directKeys = [
    'token',
    'access_token',
    'accessToken',
    'bearer_token',
    'bearerToken',
    'auth_token',
    'authToken',
    'authorization',
  ];

  for (const record of collectRecords(value)) {
    const token = getRecordString(record, directKeys);
    if (token) {
      return token.replace(/^Bearer\s+/i, '').trim();
    }
  }

  return null;
}

function extractFirstMatchingString(value: CurfoxResponseValue, keys: string[]): string | null {
  for (const record of collectRecords(value)) {
    const result = getRecordString(record, keys);
    if (result) return result;
  }
  return null;
}

function extractWaybillId(value: CurfoxResponseValue): string | null {
  const direct = extractFirstMatchingString(value, [
    'waybill_number',
    'waybillNumber',
    'waybill_no',
    'waybillNo',
    'waybill',
    'tracking_number',
    'trackingNumber',
    'tracking_no',
    'trackingNo',
    'barcode',
    'barcode_number',
    'awb',
  ]);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' || typeof item === 'number') {
        const cleaned = cleanOptionalText(String(item));
        if (cleaned) return cleaned;
      }
    }
  }

  return null;
}

function extractProviderOrderId(value: CurfoxResponseValue): string | null {
  return extractFirstMatchingString(value, [
    'order_id',
    'orderId',
    'id',
    'order_no',
    'orderNo',
    'reference',
    'merchant_order_id',
  ]);
}

function extractStatus(value: CurfoxResponseValue): string | null {
  return extractFirstMatchingString(value, [
    'status',
    'order_status',
    'orderStatus',
    'delivery_status',
    'deliveryStatus',
    'current_status',
    'currentStatus',
    'state',
  ]);
}

function getRoyalExpressBusinessId(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'merchant_business_id',
    'merchantBusinessId',
    'business_id',
    'businessId',
    'id',
    'value',
  ]);
}

function getRoyalExpressBusinessName(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'business_name',
    'businessName',
    'name',
    'merchant_name',
    'merchantName',
    'label',
    'text',
  ]);
}

function getRoyalExpressPickupAddressId(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'pickup_address_id',
    'pickupAddressId',
    'address_id',
    'addressId',
    'merchant_address_id',
    'merchantAddressId',
    'id',
    'value',
  ]);
}

function getRoyalExpressOriginCityName(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'origin_city_name',
    'originCityName',
    'city_name',
    'cityName',
    'city',
    'pickup_city',
    'pickupCity',
  ]);
}

function getRoyalExpressAddressText(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'concat_address',
    'concatAddress',
    'full_address',
    'fullAddress',
    'address',
    'name',
    'label',
    'text',
  ]);
}

async function requestRoyalExpressBusinessList(token: string): Promise<{
  response: CurfoxResponseValue;
  path: string;
  attemptedPaths: string[];
}> {
  const errors: string[] = [];

  for (const path of CURFOX_BUSINESS_LIST_PATHS) {
    try {
      return {
        response: await requestCurfoxJson(path, { token }),
        path,
        attemptedPaths: CURFOX_BUSINESS_LIST_PATHS,
      };
    } catch (error) {
      if (error instanceof OrderRequestError && error.status === 404) {
        errors.push(path);
        continue;
      }
      throw error;
    }
  }

  throw new OrderRequestError(
    `RoyalExpress Curfox business list endpoint was not found. Tried: ${errors.join(', ') || CURFOX_BUSINESS_LIST_PATHS.join(', ')}.`,
    502,
  );
}

async function requestRoyalExpressBusinessAddressList(
  token: string,
  businessId: string,
): Promise<{
  response: CurfoxResponseValue;
  path: string;
  attemptedPaths: string[];
}> {
  const paths = CURFOX_BUSINESS_ADDRESS_PATHS(businessId);
  const errors: string[] = [];

  for (const path of paths) {
    try {
      return {
        response: await requestCurfoxJson(path, { token }),
        path,
        attemptedPaths: paths,
      };
    } catch (error) {
      if (error instanceof OrderRequestError && error.status === 404) {
        errors.push(path);
        continue;
      }
      throw error;
    }
  }

  throw new OrderRequestError(
    `RoyalExpress Curfox pickup address list endpoint was not found. Tried: ${errors.join(', ') || paths.join(', ')}.`,
    502,
  );
}

async function resolveRoyalExpressMerchantBusinessId(input: {
  token: string;
  configuredBusinessId: string;
  brand: string;
}): Promise<{
  businessId: string;
  source: 'business-list' | 'settings';
  businessListPath?: string;
  attemptedBusinessListPaths?: string[];
  warning?: string;
}> {
  try {
    const businessList = await requestRoyalExpressBusinessList(input.token);
    const records = collectRecords(businessList.response)
      .map((record) => ({
        record,
        id: getRoyalExpressBusinessId(record),
        name: getRoyalExpressBusinessName(record),
      }))
      .filter((record): record is { record: Record<string, CurfoxResponseValue>; id: string; name: string | null } =>
        Boolean(record.id)
      );
    const configured = records.find((record) => record.id === input.configuredBusinessId);
    const brandText = normalizeCityText(input.brand);
    const named =
      records.find((record) => normalizeCityText(record.name) === brandText) ||
      records.find((record) => normalizeCityText(record.name) === 'deez') ||
      records.find((record) => record.name);
    const selected = configured || (records.length === 1 ? records[0] : named);

    if (selected) {
      return {
        businessId: selected.id,
        source: 'business-list',
        businessListPath: businessList.path,
        attemptedBusinessListPaths: businessList.attemptedPaths,
        warning:
          selected.id !== input.configuredBusinessId
            ? `Configured merchant business ID ${input.configuredBusinessId} was not in Curfox business-list; using ${selected.id}${selected.name ? ` (${selected.name})` : ''}.`
            : undefined,
      };
    }
  } catch (error) {
    return {
      businessId: input.configuredBusinessId,
      source: 'settings',
      attemptedBusinessListPaths: CURFOX_BUSINESS_LIST_PATHS,
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    businessId: input.configuredBusinessId,
    source: 'settings',
    attemptedBusinessListPaths: CURFOX_BUSINESS_LIST_PATHS,
    warning: 'RoyalExpress business list did not contain a usable business id; using Settings value.',
  };
}

function inferOriginCityNameFromText(value?: string | null): string | null {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) return null;

  const parts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d+$/.test(part));

  return cleanOptionalText(parts.at(-1));
}

async function resolveRoyalExpressOriginCityName(input: {
  token: string;
  businessId: string;
  pickupAddressId: string;
  configuredOriginCityName: string | null;
  senderAddress: string | null;
}): Promise<{
  originCityName: string;
  source: 'business-address' | 'settings' | 'sender-address';
  addressListPath?: string;
  attemptedAddressListPaths?: string[];
  warning?: string;
}> {
  try {
    const addressList = await requestRoyalExpressBusinessAddressList(input.token, input.businessId);
    const records = collectRecords(addressList.response)
      .map((record) => ({
        record,
        id: getRoyalExpressPickupAddressId(record),
        cityName: getRoyalExpressOriginCityName(record),
        addressText: getRoyalExpressAddressText(record),
      }))
      .filter((record) => record.id || record.cityName || record.addressText);
    const matched =
      records.find((record) => record.id === input.pickupAddressId) ||
      (records.length === 1 ? records[0] : null);
    const cityName =
      cleanOptionalText(matched?.cityName) ||
      inferOriginCityNameFromText(matched?.addressText);

    if (cityName) {
      return {
        originCityName: cityName,
        source: 'business-address',
        addressListPath: addressList.path,
        attemptedAddressListPaths: addressList.attemptedPaths,
      };
    }
  } catch (error) {
    const fallback =
      input.configuredOriginCityName ||
      inferOriginCityNameFromText(input.senderAddress);
    if (fallback) {
      return {
        originCityName: fallback,
        source: input.configuredOriginCityName ? 'settings' : 'sender-address',
        attemptedAddressListPaths: CURFOX_BUSINESS_ADDRESS_PATHS(input.businessId),
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }

  const configured = input.configuredOriginCityName;
  if (configured) {
    return {
      originCityName: configured,
      source: 'settings',
      attemptedAddressListPaths: CURFOX_BUSINESS_ADDRESS_PATHS(input.businessId),
      warning: 'RoyalExpress pickup address list did not include an origin city name; using configured origin city name.',
    };
  }

  const inferred = inferOriginCityNameFromText(input.senderAddress);
  if (inferred) {
    return {
      originCityName: inferred,
      source: 'sender-address',
      attemptedAddressListPaths: CURFOX_BUSINESS_ADDRESS_PATHS(input.businessId),
      warning: 'RoyalExpress pickup address list did not include an origin city name; inferred it from sender address.',
    };
  }

  throw new OrderRequestError(
    'RoyalExpress origin city name is required. Add ROYALEXPRESS_ORIGIN_CITY_NAME or a sender address ending with the origin city before processing the batch.',
    409,
  );
}

function normalizeCityText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRoyalExpressCityId(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'city_id',
    'cityId',
    'destination_city_id',
    'destinationCityId',
    'id',
    'value',
  ]);
}

function getRoyalExpressCityName(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'city_name',
    'cityName',
    'name',
    'city',
    'label',
    'text',
  ]);
}

function getRoyalExpressDistrictName(record: Record<string, CurfoxResponseValue>): string | null {
  return getRecordString(record, [
    'district_name',
    'districtName',
    'district',
    'state_name',
    'stateName',
    'province_name',
    'provinceName',
    'region',
  ]);
}

function scoreRoyalExpressCityRecord(
  record: Record<string, CurfoxResponseValue>,
  target: {
    city: string;
    district: string;
    address: string;
  },
): number {
  const id = getRoyalExpressCityId(record);
  const cityName = normalizeCityText(getRoyalExpressCityName(record));
  if (!id || !cityName) return 0;

  const districtName = normalizeCityText(getRoyalExpressDistrictName(record));
  let score = 0;

  if (target.city && cityName === target.city) score += 100;
  else if (target.city && cityName.includes(target.city)) score += 70;
  else if (target.city && target.city.includes(cityName)) score += 50;
  else if (target.address && target.address.includes(cityName)) score += 35;

  if (target.district && districtName === target.district) score += 35;
  else if (target.district && districtName.includes(target.district)) score += 20;
  else if (target.district && target.address.includes(districtName)) score += 10;

  return score;
}

function staticRoyalExpressCityToRecord(city: RoyalExpressStaticCity): Record<string, CurfoxResponseValue> {
  return {
    id: city.id,
    name: city.name,
    city_name: city.name,
  };
}

function findBestRoyalExpressCityRecord(
  records: Array<Record<string, CurfoxResponseValue>>,
  target: {
    city: string;
    district: string;
    address: string;
  },
) {
  return records
    .map((record) => ({
      record,
      cityId: getRoyalExpressCityId(record),
      score: scoreRoyalExpressCityRecord(record, target),
    }))
    .filter((candidate): candidate is { record: Record<string, CurfoxResponseValue>; cityId: string; score: number } =>
      Boolean(candidate.cityId && candidate.score > 0)
    )
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

async function requestRoyalExpressCityList(token: string): Promise<{
  response: CurfoxResponseValue;
  path: string;
  attemptedPaths: string[];
}> {
  const errors: string[] = [];

  for (const path of CURFOX_CITY_LIST_PATHS) {
    try {
      return {
        response: await requestCurfoxJson(path, { token }),
        path,
        attemptedPaths: CURFOX_CITY_LIST_PATHS,
      };
    } catch (error) {
      if (error instanceof OrderRequestError && error.status === 404) {
        errors.push(path);
        continue;
      }
      throw error;
    }
  }

  throw new OrderRequestError(
    `RoyalExpress Curfox city list endpoint was not found. Tried: ${errors.join(', ') || CURFOX_CITY_LIST_PATHS.join(', ')}.`,
    502,
  );
}

async function resolveRoyalExpressDestinationCityId(input: {
  token: string;
  order: {
    deliveryAddress: string | null;
    deliveryStreetAddress: string | null;
    deliveryCity: string | null;
    deliveryDistrict: string | null;
  };
  fallbackCityId: string | null;
}): Promise<{
  cityId: string;
  source: 'city-list' | 'settings';
  cityListPath?: string;
  attemptedCityListPaths?: string[];
  warning?: string;
}> {
  const city = normalizeCityText(input.order.deliveryCity);
  const district = normalizeCityText(input.order.deliveryDistrict);
  const address = normalizeCityText([
    input.order.deliveryStreetAddress,
    input.order.deliveryAddress,
    input.order.deliveryCity,
    input.order.deliveryDistrict,
  ].filter(Boolean).join(' '));
  const target = { city, district, address };

  if (city || district || address) {
    const staticBest = findBestRoyalExpressCityRecord(
      (royalExpressCityList as RoyalExpressStaticCity[]).map(staticRoyalExpressCityToRecord),
      target,
    );

    if (staticBest?.cityId) {
      return {
        cityId: staticBest.cityId,
        source: 'city-list',
        cityListPath: 'local:royalexpress-city-list.json',
      };
    }

    let cityListWarning: string | null = null;
    try {
      const cityList = await requestRoyalExpressCityList(input.token);
      const best = findBestRoyalExpressCityRecord(collectRecords(cityList.response), target);

      if (best?.cityId) {
        return {
          cityId: best.cityId,
          source: 'city-list',
          cityListPath: cityList.path,
          attemptedCityListPaths: cityList.attemptedPaths,
        };
      }
    } catch (error) {
      if (input.fallbackCityId) {
        cityListWarning = error instanceof Error ? error.message : String(error);
      } else {
        throw error;
      }
    }

    if (input.fallbackCityId) {
      return {
        cityId: input.fallbackCityId,
        source: 'settings',
        attemptedCityListPaths: CURFOX_CITY_LIST_PATHS,
        warning: cityListWarning || 'RoyalExpress city list did not match the customer city; used Settings fallback.',
      };
    }
  }

  if (input.fallbackCityId) {
    return { cityId: input.fallbackCityId, source: 'settings' };
  }

  throw new OrderRequestError(
    `RoyalExpress destination city ID could not be matched for ${input.order.deliveryCity || input.order.deliveryDistrict || 'this address'}. Check the Curfox city list or add a default destination city ID in Settings before processing the RoyalExpress batch.`,
    409,
  );
}

async function requestCurfoxJson(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    token?: string;
  } = {},
): Promise<CurfoxResponseValue> {
  const response = await fetch(`${CURFOX_BASE_URL}${path}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(CURFOX_TENANT ? { 'X-tenant': CURFOX_TENANT } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  const text = await response.text();
  const parsed = parseCurfoxResponse(text);

  if (!response.ok) {
    throw new OrderRequestError(
      `RoyalExpress Curfox request failed (${response.status}): ${stringifyCurfoxMessage(parsed)}`,
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }

  return parsed;
}

async function loginRoyalExpress(brand: string, credentials?: ResolvedRoyalExpressCredentials): Promise<string> {
  const resolved = credentials || (await resolveRoyalExpressCredentials(brand));
  const response = await requestCurfoxJson(CURFOX_PATHS.login, {
    method: 'POST',
    body: {
      email: resolved.email,
      password: resolved.password,
    },
  });
  const token = extractBearerToken(response);

  if (!token) {
    throw new OrderRequestError(
      `RoyalExpress Curfox login succeeded but did not return a bearer token for ${brand}.`,
      502,
    );
  }

  return token;
}

async function resolveRoyalExpressCredentials(brand: string): Promise<ResolvedRoyalExpressCredentials> {
  const record = await findRoyalExpressSettingsRecord(brand);
  const email = cleanSecret(record?.accountEmail) || getEnvCredential(brand, 'EMAIL');
  const password = cleanSecret(record?.accountPassword) || getEnvCredential(brand, 'PASSWORD');
  const merchantBusinessId =
    cleanOptionalText(record?.merchantBusinessId) || getEnvCredential(brand, 'MERCHANT_BUSINESS_ID');
  const pickupAddressId =
    cleanOptionalText(record?.pickupAddressId) || getEnvCredential(brand, 'PICKUP_ADDRESS_ID');
  const originCityId = cleanOptionalText(record?.originCityId) || getEnvCredential(brand, 'ORIGIN_CITY_ID');
  const originCityName =
    getEnvCredential(brand, 'ORIGIN_CITY_NAME') ||
    getEnvCredential(brand, 'ORIGIN_CITY') ||
    inferOriginCityNameFromText(record?.senderAddress);
  const senderAddress = cleanOptionalText(record?.senderAddress) || getEnvCredential(brand, 'SENDER_ADDRESS');
  const defaultDestinationCityId =
    cleanOptionalText(record?.defaultReceiverCityId) || getEnvCredential(brand, 'DEFAULT_DESTINATION_CITY_ID');

  if (!email || !password) {
    throw new OrderRequestError(`RoyalExpress Curfox email/password is not configured for ${brand}.`, 409);
  }
  if (!merchantBusinessId) {
    throw new OrderRequestError(`RoyalExpress merchant business ID is not configured for ${brand}.`, 409);
  }
  if (!pickupAddressId) {
    throw new OrderRequestError(`RoyalExpress pickup address ID is not configured for ${brand}.`, 409);
  }

  return {
    email,
    password,
    merchantBusinessId,
    pickupAddressId,
    originCityId,
    originCityName,
    senderAddress,
    defaultDestinationCityId,
  };
}

export async function getRoyalExpressSettingsView(brand: string): Promise<RoyalExpressSettingsView> {
  const record = await findRoyalExpressSettingsRecord(brand);
  const envEmail = getEnvCredential(brand, 'EMAIL');
  const envPassword = getEnvCredential(brand, 'PASSWORD');
  const envBusinessId = getEnvCredential(brand, 'MERCHANT_BUSINESS_ID');
  const envPickupAddressId = getEnvCredential(brand, 'PICKUP_ADDRESS_ID');
  const databaseHasCredentials = Boolean(record && hasDatabaseCredentials(record));
  const envHasCredentials = Boolean(envEmail && envPassword && envBusinessId && envPickupAddressId);

  return {
    brand: getCanonicalBrandForStorage(brand),
    provider: ROYALEXPRESS_PROVIDER,
    isActive: record?.isActive ?? false,
    hasCredentials: databaseHasCredentials || envHasCredentials,
    credentialSource: databaseHasCredentials ? 'database' : envHasCredentials ? 'env' : 'missing',
    accountEmail: cleanOptionalText(record?.accountEmail) || envEmail,
    merchantBusinessId: cleanOptionalText(record?.merchantBusinessId) || envBusinessId,
    pickupAddressId: cleanOptionalText(record?.pickupAddressId) || envPickupAddressId,
    originCityId: cleanOptionalText(record?.originCityId) || getEnvCredential(brand, 'ORIGIN_CITY_ID'),
    defaultDestinationCityId:
      cleanOptionalText(record?.defaultReceiverCityId) || getEnvCredential(brand, 'DEFAULT_DESTINATION_CITY_ID'),
    notes: record?.notes ?? null,
    lastTestAt: record?.lastTestAt?.toISOString() ?? null,
    lastTestStatus: record?.lastTestStatus ?? null,
    lastTestMessage: record?.lastTestMessage ?? null,
  };
}

export async function testRoyalExpressConnectionForBrand(brand: string) {
  const credentials = await resolveRoyalExpressCredentials(brand);
  const token = await loginRoyalExpress(brand, credentials);
  await requestCurfoxJson(CURFOX_PATHS.userInfo, { token });

  return {
    ok: true,
    message: `RoyalExpress Curfox connection succeeded for ${brand}.`,
  };
}

function buildOrderDescription(order: {
  orderItems: Array<{
    quantity: number;
    size: string | null;
    color: string | null;
    product: { name: string | null; style: string | null } | null;
  }>;
}) {
  const lines = order.orderItems.map((item) => {
    const name = item.product?.name || item.product?.style || 'Item';
    const attributes = [item.size, item.color].filter(Boolean).join('/');
    return `${item.quantity}x ${name}${attributes ? ` (${attributes})` : ''}`;
  });

  return lines.join('; ').slice(0, 500) || 'Garment order';
}

function buildSpecialNote(orderId: number, brand: string) {
  return `DEEZ ${brand} order #${orderId}`.slice(0, 250);
}

function buildRoyalExpressAddress(order: {
  deliveryStreetAddress: string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryDistrict: string | null;
}) {
  const primary = cleanOptionalText(order.deliveryStreetAddress) || cleanOptionalText(order.deliveryAddress);
  const cityDistrict = [order.deliveryCity, order.deliveryDistrict]
    .map(cleanOptionalText)
    .filter(Boolean)
    .join(', ');

  return [primary, cityDistrict].filter(Boolean).join(', ');
}

async function resolveRoyalExpressAmounts(order: {
  brand: string | null;
  deliveryAddress: string | null;
  paymentMethod: string | null;
  totalAmount: number;
}) {
  const itemSubtotal = Math.max(0, Math.round(order.totalAmount));

  if (!/\b(cod|cash on delivery)\b/i.test(order.paymentMethod || '')) {
    return {
      codAmount: 0,
      deliveryCharge: 0,
      itemSubtotal,
    };
  }

  const settings = await getMerchantSettings(order.brand);
  const deliveryCharge = getDeliveryChargeForAddress(order.deliveryAddress || '', settings.delivery);

  return {
    codAmount: itemSubtotal + deliveryCharge,
    deliveryCharge,
    itemSubtotal,
  };
}

async function findLatestRoyalExpressShipment(orderId: number) {
  return prisma.courierShipment.findFirst({
    where: { orderId, provider: ROYALEXPRESS_PROVIDER },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createRoyalExpressDelivery(input: SubmitRoyalExpressDeliveryForDispatchInput) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      customer: true,
      orderItems: { include: { product: true } },
      courierShipments: {
        where: { provider: ROYALEXPRESS_PROVIDER },
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

  const settings = await findRoyalExpressSettingsRecord(brand);
  if (!settings?.isActive) {
    throw new OrderRequestError(`RoyalExpress is not active for ${brand}. Enable it in Settings first.`, 409);
  }

  const duplicate = order.courierShipments[0];
  if (duplicate) {
    return duplicate;
  }

  if (!order.customer.phone?.trim()) {
    throw new OrderRequestError('Customer phone is required to create a RoyalExpress delivery.', 400);
  }

  const customerAddress = buildRoyalExpressAddress(order);
  if (!customerAddress) {
    throw new OrderRequestError('Delivery address is required to create a RoyalExpress delivery.', 400);
  }

  const credentials = await resolveRoyalExpressCredentials(brand);
  const token = await loginRoyalExpress(brand, credentials);
  const merchantBusiness = await resolveRoyalExpressMerchantBusinessId({
    token,
    configuredBusinessId: credentials.merchantBusinessId,
    brand,
  });
  const originCity = await resolveRoyalExpressOriginCityName({
    token,
    businessId: merchantBusiness.businessId,
    pickupAddressId: credentials.pickupAddressId,
    configuredOriginCityName: credentials.originCityName,
    senderAddress: credentials.senderAddress,
  });
  const destinationCity = await resolveRoyalExpressDestinationCityId({
    token,
    order,
    fallbackCityId: credentials.defaultDestinationCityId,
  });
  const destinationCityId = destinationCity.cityId;
  const orderReference = `ORD-${order.id}`;
  const description = buildOrderDescription(order);
  const specialNote = buildSpecialNote(order.id, brand);
  const amounts = await resolveRoyalExpressAmounts(order);
  const generalData: Record<string, string> = {
    merchant_business_id: merchantBusiness.businessId,
    pickup_address_id: credentials.pickupAddressId,
  };

  if (credentials.originCityId && SEND_ROYALEXPRESS_ORIGIN_CITY_ID) {
    generalData.origin_city_id = credentials.originCityId;
  } else {
    generalData.origin_city_name = originCity.originCityName;
  }

  const payload = {
    general_data: generalData,
    order_data: [
      {
        waybill_number: '',
        order_no: orderReference,
        customer_name: order.customer.name,
        customer_address: customerAddress,
        customer_phone: order.customer.phone,
        customer_secondary_phone: null,
        customer_email: null,
        destination_city_id: destinationCityId,
        cod: String(amounts.codAmount),
        weight: '1',
        description,
        remark: specialNote,
      },
    ],
  };
  const response = await requestCurfoxJson(CURFOX_PATHS.orderSingle, {
    method: 'POST',
    token,
    body: payload,
  });
  const waybillId = extractWaybillId(response);

  if (!waybillId) {
    throw new OrderRequestError(
      `RoyalExpress created the Curfox order but did not return a waybill number: ${stringifyCurfoxMessage(response)}`,
      502,
    );
  }

  const courierStatus = extractStatus(response) || 'submitted';
  const mappedStatus: FulfillmentStatus = mapCourierStatus(ROYALEXPRESS_PROVIDER, courierStatus);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const created = await tx.courierShipment.create({
      data: {
        orderId: order.id,
        batchId: input.batchId ?? null,
        brand,
        provider: ROYALEXPRESS_PROVIDER,
        waybillId,
        providerOrderId: extractProviderOrderId(response),
        orderReference,
        receiverName: order.customer.name,
        receiverStreet: customerAddress,
        receiverCityId: destinationCityId,
        receiverPhone: order.customer.phone,
        description,
        specialNote,
        codAmount: amounts.codAmount,
        courierStatus,
        mappedStatus,
        rawResponse: compactPayload({
          request: payload,
          response,
          amounts,
          destinationCity,
          merchantBusiness,
          originCity,
          omittedOriginCityId:
            credentials.originCityId && !SEND_ROYALEXPRESS_ORIGIN_CITY_ID
              ? credentials.originCityId
              : null,
        }),
        submittedAt: now,
        lastSyncedAt: now,
        createdByEmail: input.actor?.email ?? null,
        createdByName: input.actor?.name ?? null,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        trackingNumber: waybillId,
        courier: ROYALEXPRESS_COURIER_NAME,
        courierProcessingStatus: 'processed',
        courierProcessedAt: now,
      },
    });

    await tx.orderFulfillmentEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.orderStatus,
        toStatus: order.orderStatus,
        note: input.batchId
          ? `RoyalExpress batch #${input.batchId} created Curfox waybill ${waybillId}.`
          : `RoyalExpress delivery ${waybillId} created in Curfox.`,
        trackingNumber: waybillId,
        courier: ROYALEXPRESS_COURIER_NAME,
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.name ?? null,
      },
    });

    return created;
  });
}

export async function submitRoyalExpressDeliveryForDispatch(
  input: SubmitRoyalExpressDeliveryForDispatchInput,
): Promise<CourierShipment | null> {
  const context = await findActiveRoyalExpressOrderContext(input.orderId);
  if (!context) return null;

  const existing = await findLatestRoyalExpressShipment(input.orderId);
  if (existing) return existing;

  throw new OrderRequestError(
    'RoyalExpress is active for this brand, but no waybill has been created yet. Process the RoyalExpress courier batch before dispatching this order.',
    409,
  );
}

export async function processRoyalExpressBatch(input: ProcessRoyalExpressBatchInput) {
  const uniqueOrderIds = Array.from(new Set(input.orderIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueOrderIds.length === 0) {
    throw new OrderRequestError('No eligible RoyalExpress orders were found for this cutoff.', 404);
  }

  if (process.env.CHAT_TEST_MODE === '1') {
    throw new OrderRequestError('RoyalExpress batch processing is disabled in chat test mode.', 409);
  }

  const batch = await prisma.courierBatch.create({
    data: {
      provider: ROYALEXPRESS_PROVIDER,
      brand: cleanOptionalText(input.brand),
      status: 'submitting',
      cutoffAt: input.cutoffAt,
      totalOrders: uniqueOrderIds.length,
      submittedAt: new Date(),
      createdByEmail: input.actor?.email ?? null,
      createdByName: input.actor?.name ?? null,
    },
  });

  const successes: Array<{ orderId: number; waybillId: string }> = [];
  const failures: Array<{ orderId: number; error: string }> = [];

  for (const orderId of uniqueOrderIds) {
    try {
      const shipment = await createRoyalExpressDelivery({
        orderId,
        batchId: batch.id,
        actor: input.actor,
      });
      successes.push({ orderId, waybillId: shipment.waybillId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ orderId, error: message });
      await prisma.order.updateMany({
        where: { id: orderId, courierProcessedAt: null },
        data: { courierProcessingStatus: 'failed' },
      });
      await prisma.orderFulfillmentEvent.create({
        data: {
          orderId,
          toStatus: 'confirmed',
          note: `RoyalExpress batch #${batch.id} failed: ${message}`,
          courier: ROYALEXPRESS_COURIER_NAME,
          actorEmail: input.actor?.email ?? null,
          actorName: input.actor?.name ?? null,
        },
      }).catch(() => undefined);
    }
  }

  const status =
    failures.length === 0
      ? 'submitted'
      : successes.length > 0
        ? 'partial_failed'
        : 'failed';

  return prisma.courierBatch.update({
    where: { id: batch.id },
    data: {
      status,
      successCount: successes.length,
      failureCount: failures.length,
      rawResponse: compactPayload({ successes, failures }),
      error: failures.length > 0 ? failures.map((failure) => `#${failure.orderId}: ${failure.error}`).join('\n') : null,
    },
    include: {
      shipments: {
        include: { order: { include: { customer: true, orderItems: { include: { product: true } } } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function refreshRoyalExpressShipmentStatus(input: RefreshRoyalExpressStatusInput) {
  const shipment = await prisma.courierShipment.findFirst({
    where: { orderId: input.orderId, provider: ROYALEXPRESS_PROVIDER },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { brand: true, orderStatus: true } } },
  });

  if (!shipment) {
    throw new OrderRequestError(`Order #${input.orderId} does not have a RoyalExpress delivery yet.`, 404);
  }

  const brand = cleanOptionalText(shipment.brand || shipment.order.brand);
  if (!brand) {
    throw new OrderRequestError('This shipment does not have a brand, so the RoyalExpress account cannot be selected.', 409);
  }

  const token = await loginRoyalExpress(brand);
  const query = new URLSearchParams({
    waybill_number: shipment.waybillId,
  });
  const response = await requestCurfoxJson(`${CURFOX_PATHS.trackingInfo}?${query.toString()}`, {
    token,
  });
  const courierStatus = extractStatus(response) || shipment.courierStatus || 'unknown';
  const mappedStatus = mapCourierStatus(ROYALEXPRESS_PROVIDER, courierStatus);

  return prisma.courierShipment.update({
    where: { id: shipment.id },
    data: {
      courierStatus,
      mappedStatus,
      rawResponse: compactPayload(response),
      lastSyncedAt: new Date(),
    },
  });
}

export const ROYALEXPRESS_PROVIDER_ID = ROYALEXPRESS_PROVIDER;
export const ROYALEXPRESS_COURIER_DISPLAY_NAME = ROYALEXPRESS_COURIER_NAME;
