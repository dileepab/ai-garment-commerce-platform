import { normalizeText } from './formatters';
import {
  getDefaultMerchantSettings,
  type MerchantDeliverySettings,
} from '@/lib/runtime-config';
import koombiyoDeliveryRatesData from '@/lib/data/koombiyo-delivery-rates.json';

type KoombiyoDeliveryRateTuple = [string, string, number, number];

interface KoombiyoDeliveryRateTable {
  origin: string;
  rates: KoombiyoDeliveryRateTuple[];
}

export interface KoombiyoDeliveryRateMatch {
  origin: string;
  destination: string;
  chargeFirstKg: number;
  chargeAdditionalKg: number;
}

const KOOMBIYO_DELIVERY_RATE_TABLE = koombiyoDeliveryRatesData as KoombiyoDeliveryRateTable;
const KOOMBIYO_DELIVERY_RATES = KOOMBIYO_DELIVERY_RATE_TABLE.rates;

function getDeliverySettings(settings?: MerchantDeliverySettings): MerchantDeliverySettings {
  return settings ?? getDefaultMerchantSettings().delivery;
}

function normalizeDeliveryRateText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/([\p{L}])(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})([\p{L}])/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b0+(\d+)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesNormalizedPhrase(value: string, phrase: string): boolean {
  return (
    value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `)
  );
}

function compareRateSpecificity(
  left: KoombiyoDeliveryRateTuple,
  right: KoombiyoDeliveryRateTuple,
): number {
  return (
    left[2] - right[2] ||
    left[1].length - right[1].length ||
    left[3] - right[3]
  );
}

function pickHighestRate(
  rates: KoombiyoDeliveryRateTuple[],
): KoombiyoDeliveryRateTuple | null {
  return rates.reduce<KoombiyoDeliveryRateTuple | null>((best, rate) => {
    if (!best) return rate;
    return compareRateSpecificity(rate, best) > 0 ? rate : best;
  }, null);
}

function getNormalizedAddressSegments(address: string): string[] {
  const segments = Array.from(
    new Set(
      address
        .split(',')
        .map((segment) => normalizeDeliveryRateText(segment))
        .filter(Boolean)
    )
  );

  return segments.length >= 3 ? segments.slice(-2) : segments;
}

export function getKoombiyoDeliveryRateForAddress(
  address?: string,
): KoombiyoDeliveryRateMatch | null {
  const rawAddress = address ?? '';
  const normalizedAddress = normalizeDeliveryRateText(rawAddress);

  if (!normalizedAddress) {
    return null;
  }

  const exactSegmentMatches = pickHighestRate(
    getNormalizedAddressSegments(rawAddress).flatMap((segment) =>
      KOOMBIYO_DELIVERY_RATES.filter((entry) => entry[1] === segment)
    )
  );

  const phraseMatch =
    exactSegmentMatches ||
    KOOMBIYO_DELIVERY_RATES.find((entry) =>
      includesNormalizedPhrase(normalizedAddress, entry[1])
  );

  if (!phraseMatch) {
    return null;
  }

  return {
    origin: KOOMBIYO_DELIVERY_RATE_TABLE.origin,
    destination: phraseMatch[0],
    chargeFirstKg: phraseMatch[2],
    chargeAdditionalKg: phraseMatch[3],
  };
}

export function getDeliveryChargeForAddress(
  address?: string,
  settings?: MerchantDeliverySettings
): number {
  const normalized = normalizeText(address ?? '');
  const delivery = getDeliverySettings(settings);
  const koombiyoRate = getKoombiyoDeliveryRateForAddress(address);

  if (!normalized) {
    return 0;
  }

  if (koombiyoRate) {
    return koombiyoRate.chargeFirstKg;
  }

  return normalized.includes('colombo')
    ? delivery.colomboCharge
    : delivery.outsideColomboCharge;
}

export function getDeliveryEstimateForAddress(
  address?: string,
  settings?: MerchantDeliverySettings
): string {
  const normalized = normalizeText(address ?? '');
  const delivery = getDeliverySettings(settings);

  if (normalized.includes('colombo')) {
    return delivery.colomboEstimate;
  }

  return delivery.outsideColomboEstimate;
}

export function getBusinessDayRangeFromEstimate(estimate: string): [number, number] {
  const values = Array.from(estimate.matchAll(/\d+/g))
    .map((match) => Number.parseInt(match[0], 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (values.length >= 2) {
    return [values[0], values[1]];
  }

  if (values.length === 1) {
    return [values[0], values[0]];
  }

  return estimate === '1-2 business days' ? [1, 2] : [2, 3];
}
