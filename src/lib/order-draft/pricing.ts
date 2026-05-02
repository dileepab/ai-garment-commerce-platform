import { normalizeText } from './formatters';
import {
  getDefaultMerchantSettings,
  type MerchantDeliverySettings,
} from '@/lib/runtime-config';

function getDeliverySettings(settings?: MerchantDeliverySettings): MerchantDeliverySettings {
  return settings ?? getDefaultMerchantSettings().delivery;
}

export function getDeliveryChargeForAddress(
  address?: string,
  settings?: MerchantDeliverySettings
): number {
  const normalized = normalizeText(address ?? '');
  const delivery = getDeliverySettings(settings);

  if (!normalized) {
    return 0;
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
