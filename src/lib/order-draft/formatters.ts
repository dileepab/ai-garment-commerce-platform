import { formatContactBlock, shouldShowDistrict } from '@/lib/contact-profile';
import { ResolvedOrderDraft } from './types';
import { buildDraftItemLines, draftItemCount, draftItemsSubtotal } from './items';

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
  // Omitted for towns whose district was never asked for — a "Not specified"
  // line invites a correction the bot will not act on.
  const districtLine = shouldShowDistrict(draft)
    ? [`District: ${draft.district || 'Not specified'}`]
    : [];
  const specialInstructions = [
    draft.giftWrap ? 'Gift wrap requested' : '',
    draft.giftNote ? `Gift Note: ${draft.giftNote}` : '',
  ].filter(Boolean);

  // Several items get a priced list so the total is checkable at a glance. A
  // single item keeps the labelled form it has always had — that is what
  // customers, and the regression suite, already read.
  if (draftItemCount(draft) > 1) {
    return [
      'Order Summary',
      ...buildDraftItemLines(draft),
      `Items Subtotal: Rs ${draftItemsSubtotal(draft)}`,
      `Delivery Charge: Rs ${draft.deliveryCharge}`,
      `Total: Rs ${draft.total}`,
      `Payment Method: ${draft.paymentMethod}`,
      `Name: ${draft.name}`,
      `Street Address: ${draft.streetAddress || 'Not specified'}`,
      `City/Town: ${draft.city || 'Not specified'}`,
      ...districtLine,
      `Phone Number: ${draft.phone}`,
      ...specialInstructions,
      '',
      'Reply "yes" to confirm, or tell me what to change.',
    ].join('\n');
  }

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
    `Street Address: ${draft.streetAddress || 'Not specified'}`,
    `City/Town: ${draft.city || 'Not specified'}`,
    ...districtLine,
    `Phone Number: ${draft.phone}`,
    ...specialInstructions,
    '',
    'Reply "yes" to confirm, or tell me what to change.',
  ].join('\n');
}

export function buildContactConfirmationReply(
  name: string,
  address: string,
  phone: string,
  addressParts?: Partial<ResolvedOrderDraft>
): string {
  return [
    'Please confirm if these delivery details are correct:',
    '',
    formatContactBlock({ name, address, phone, ...addressParts }),
    '',
    'Reply "yes" to confirm, or send the correction you need.',
  ].join('\n');
}
