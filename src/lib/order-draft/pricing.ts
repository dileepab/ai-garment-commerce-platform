import { normalizeText } from './formatters';

export function getDeliveryChargeForAddress(address?: string): number {
  const normalized = normalizeText(address ?? '');

  if (!normalized) {
    return 0;
  }

  return normalized.includes('colombo') ? 150 : 200;
}

export function getDeliveryEstimateForAddress(address?: string): string {
  const normalized = normalizeText(address ?? '');

  if (normalized.includes('colombo')) {
    return '1-2 business days';
  }

  return '2-3 business days';
}
