import { formatContactBlock } from '@/lib/contact-profile';
import { ResolvedOrderDraft } from './types';

export function formatSizeForDisplay(size?: string): string {
  if (!size) {
    return 'Not specified';
  }

  const normalized = size.trim().toUpperCase();
  const sizeMap: Record<string, string> = {
    XS: 'Extra Small',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    XL: 'Extra Large',
    XXL: 'Double Extra Large',
  };

  return sizeMap[normalized] || size;
}

export function formatColorForDisplay(color?: string): string {
  return color || 'Not specified';
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildOrderSummaryReply(draft: ResolvedOrderDraft): string {
  const specialInstructions = [
    draft.giftWrap ? 'Gift wrap requested' : '',
    draft.giftNote ? `Gift Note: ${draft.giftNote}` : '',
  ].filter(Boolean);

  return [
    'Order Summary',
    `Product: ${draft.productName}`,
    `Quantity: ${draft.quantity}`,
    `Size: ${formatSizeForDisplay(draft.size)}`,
    `Color: ${formatColorForDisplay(draft.color)}`,
    `Price: Rs ${draft.price}`,
    `Delivery Charge: Rs ${draft.deliveryCharge}`,
    `Total: Rs ${draft.total}`,
    `Payment Method: ${draft.paymentMethod}`,
    `Name: ${draft.name}`,
    `Address: ${draft.address}`,
    `Phone Number: ${draft.phone}`,
    ...specialInstructions,
    '',
    'Is this summary correct? Please let me know if any changes are needed.',
  ].join('\n');
}

export function buildContactConfirmationReply(name: string, address: string, phone: string): string {
  return [
    'Please confirm if these delivery details are correct:',
    '',
    formatContactBlock({ name, address, phone }),
    '',
    'If anything should be changed, please send the correction.',
  ].join('\n');
}
