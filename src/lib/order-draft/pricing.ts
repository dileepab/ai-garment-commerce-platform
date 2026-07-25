import { normalizeText } from './formatters';
import {
  getDefaultMerchantSettings,
  type MerchantDeliverySettings,
} from '@/lib/runtime-config';
import koombiyoDeliveryRatesData from '@/lib/data/koombiyo-delivery-rates.json';
import royalExpressCitiesData from '@/data/royalexpress-city-list.json';
import { ROYALEXPRESS_FLAT_DELIVERY_CHARGE } from '@/lib/delivery-policy';

type KoombiyoDeliveryRateTuple = [string, string, number, number];

interface KoombiyoDeliveryRateTable {
  origin: string;
  rates: KoombiyoDeliveryRateTuple[];
}

interface RoyalExpressCity {
  id: number;
  name: string;
}

export interface RoyalExpressDeliveryRateMatch {
  destination: string;
  chargeFirstKg: number;
}

export interface KoombiyoDeliveryRateMatch {
  origin: string;
  destination: string;
  chargeFirstKg: number;
  chargeAdditionalKg: number;
}

export interface DeliveryDestinationResolution {
  match: KoombiyoDeliveryRateMatch | null;
  suggestion: string | null;
}

const KOOMBIYO_DELIVERY_RATE_TABLE = koombiyoDeliveryRatesData as KoombiyoDeliveryRateTable;
const KOOMBIYO_DELIVERY_RATES = KOOMBIYO_DELIVERY_RATE_TABLE.rates;
const ROYALEXPRESS_CITIES = royalExpressCitiesData as RoyalExpressCity[];
const LOCALIZED_DESTINATION_ALIASES: Record<string, string> = {
  'කොළඹ': 'colombo',
  'ගාල්ල': 'galle',
  'මහනුවර': 'kandy',
  'කුරුණෑගල': 'kurunegala',
  'මීගමුව': 'negombo',
  'යාපනය': 'jaffna',
  'මාතර': 'matara',
  'අනුරාධපුර': 'anuradhapura',
  'බදුල්ල': 'badulla',
  'රත්නපුර': 'ratnapura',
  'රත්නපුරෙ': 'ratnapura',
  'රත්නපුරේ': 'ratnapura',
  'ත්‍රිකුණාමලය': 'trincomalee',
  'මඩකලපුව': 'batticaloa',
  'கொழும்பு': 'colombo',
  'காலி': 'galle',
  'கண்டி': 'kandy',
  'குருநாகல்': 'kurunegala',
  'நீர்கொழும்பு': 'negombo',
  'யாழ்ப்பாணம்': 'jaffna',
  'மாத்தறை': 'matara',
  'அனுராதபுரம்': 'anuradhapura',
  'பதுளை': 'badulla',
  'இரத்தினபுரி': 'ratnapura',
  'ரத்தினபுரி': 'ratnapura',
  'ரத்னபுரி': 'ratnapura',
  'திருகோணமலை': 'trincomalee',
  'மட்டக்களப்பு': 'batticaloa',
};
const CANONICAL_DESTINATION_ALIASES: Record<string, string> = {
  negambo: 'negombo',
  kurunagala: 'kurunegala',
};

function getDeliverySettings(settings?: MerchantDeliverySettings): MerchantDeliverySettings {
  return settings ?? getDefaultMerchantSettings().delivery;
}

function normalizeDeliveryRateText(value: string): string {
  const aliasedValue = Object.entries(LOCALIZED_DESTINATION_ALIASES).reduce(
    (result, [localizedName, rateName]) => result.replaceAll(localizedName, rateName),
    value
  );

  return aliasedValue
    .toLowerCase()
    .normalize('NFKD')
    .replace(/([\p{L}])(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})([\p{L}])/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b0+(\d+)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOutsideColomboDeliveryArea(address?: string): boolean {
  const rawAddress = address ?? '';
  const normalizedAddress = normalizeDeliveryRateText(rawAddress);

  return (
    /\b(?:outside|out of|beyond)\s+colombo\b/.test(normalizedAddress) ||
    /කොළඹ(?:ින්)?\s*(?:පිට|පිටත)/.test(rawAddress) ||
    /கொழும்பு(?:க்கு)?\s*வெளியே/.test(rawAddress)
  );
}

function hasColomboCitySegment(address: string): boolean {
  return address
    .split(',')
    .map((segment) => normalizeDeliveryRateText(segment))
    .some((segment) => /^colombo(?:\s+(?:district|\d{1,2}))?$/.test(segment));
}

function canonicalDestination(value: string): string {
  return CANONICAL_DESTINATION_ALIASES[value] ?? value;
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

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function titleCaseDestination(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function getNormalizedRoyalExpressCities(): Array<{ name: string; normalized: string }> {
  return ROYALEXPRESS_CITIES.map((city) => ({
    name: city.name,
    normalized: normalizeDeliveryRateText(city.name),
  }));
}

const NORMALIZED_ROYALEXPRESS_CITIES = getNormalizedRoyalExpressCities();

export function getRoyalExpressDeliveryRateForAddress(
  address?: string,
): RoyalExpressDeliveryRateMatch | null {
  const rawAddress = address ?? '';
  const normalizedAddress = normalizeDeliveryRateText(rawAddress);

  if (!normalizedAddress || isOutsideColomboDeliveryArea(rawAddress)) {
    return null;
  }

  const addressSegments = getNormalizedAddressSegments(rawAddress);
  const exactMatch = NORMALIZED_ROYALEXPRESS_CITIES.find((city) =>
    addressSegments.includes(city.normalized)
  );
  const phraseMatch = exactMatch || NORMALIZED_ROYALEXPRESS_CITIES.find((city) =>
    includesNormalizedPhrase(normalizedAddress, city.normalized)
  );
  // RoyalExpress has duplicate/qualified names such as "Aluthgama (Kalutara)".
  // Accept the unqualified town only when it is the leading city-name segment.
  const qualifiedMatch = phraseMatch || NORMALIZED_ROYALEXPRESS_CITIES.find((city) =>
    addressSegments.some((segment) => city.normalized.startsWith(`${segment} `))
  );

  if (!qualifiedMatch) {
    return null;
  }

  return {
    destination: qualifiedMatch.name,
    chargeFirstKg: ROYALEXPRESS_FLAT_DELIVERY_CHARGE,
  };
}

export function resolveDeliveryDestination(
  address?: string
): DeliveryDestinationResolution {
  const royalExpressMatch = getRoyalExpressDeliveryRateForAddress(address);
  if (royalExpressMatch) {
    return {
      match: {
        origin: 'RoyalExpress',
        destination: royalExpressMatch.destination,
        chargeFirstKg: royalExpressMatch.chargeFirstKg,
        chargeAdditionalKg: 0,
      },
      suggestion: null,
    };
  }

  const normalizedAddress = normalizeDeliveryRateText(address ?? '');
  if (!normalizedAddress || normalizedAddress.length < 4) {
    return { match: null, suggestion: null };
  }

  const maximumDistance = normalizedAddress.length <= 6 ? 2 : 3;
  let best: { label: string; distance: number } | null = null;

  for (const city of NORMALIZED_ROYALEXPRESS_CITIES) {
    const comparableName = city.normalized.replace(/\s+(?:galle|kalutara)$/, '');
    if (Math.abs(comparableName.length - normalizedAddress.length) > maximumDistance) continue;
    const distance = editDistance(normalizedAddress, comparableName);

    if (distance <= maximumDistance && (!best || distance < best.distance)) {
      best = { label: comparableName, distance };
    }
  }

  return {
    match: null,
    suggestion: best ? titleCaseDestination(best.label) : null,
  };
}

export function getKoombiyoDeliveryRateForAddress(
  address?: string,
): KoombiyoDeliveryRateMatch | null {
  const rawAddress = address ?? '';
  const normalizedAddress = normalizeDeliveryRateText(rawAddress);

  if (!normalizedAddress || isOutsideColomboDeliveryArea(rawAddress)) {
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

export function resolveKoombiyoDeliveryDestination(
  address?: string
): DeliveryDestinationResolution {
  const match = getKoombiyoDeliveryRateForAddress(address);
  if (match) {
    return { match, suggestion: null };
  }

  const normalizedAddress = normalizeDeliveryRateText(address ?? '');
  if (!normalizedAddress || normalizedAddress.length < 4) {
    return { match: null, suggestion: null };
  }

  const addressTokenCount = normalizedAddress.split(' ').length;
  const maximumDistance = normalizedAddress.length <= 6 ? 2 : 3;
  let best: { label: string; distance: number } | null = null;
  const seen = new Set<string>();

  for (const [, rawNormalizedDestination] of KOOMBIYO_DELIVERY_RATES) {
    const normalizedDestination = canonicalDestination(rawNormalizedDestination);
    if (
      seen.has(normalizedDestination) ||
      normalizedDestination.split(' ').length !== addressTokenCount ||
      Math.abs(normalizedDestination.length - normalizedAddress.length) > maximumDistance
    ) {
      continue;
    }

    seen.add(normalizedDestination);
    const distance = editDistance(normalizedAddress, normalizedDestination);

    if (distance <= maximumDistance && (!best || distance < best.distance)) {
      best = { label: normalizedDestination, distance };
    }
  }

  return {
    match: null,
    suggestion: best ? titleCaseDestination(best.label) : null,
  };
}

export function getDeliveryChargeForAddress(
  address?: string,
  settings?: MerchantDeliverySettings
): number {
  void settings;
  const normalized = normalizeText(address ?? '');

  if (!normalized) {
    return 0;
  }

  return ROYALEXPRESS_FLAT_DELIVERY_CHARGE;
}

export function getDeliveryEstimateForAddress(
  address?: string,
  settings?: MerchantDeliverySettings
): string {
  const normalized = normalizeText(address ?? '');
  const delivery = getDeliverySettings(settings);

  if (isOutsideColomboDeliveryArea(address)) {
    return delivery.outsideColomboEstimate;
  }

  if (hasColomboCitySegment(address ?? '') || normalized === 'colombo') {
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
