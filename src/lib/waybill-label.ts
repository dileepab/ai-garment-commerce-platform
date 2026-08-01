import type { Code128Bars } from './barcode';

/**
 * Serialisable snapshot of one RoyalExpress waybill. Built on the server so the
 * printed HTML sheet and the client-side PNG export always show the same values.
 */
export type WaybillLabelData = {
  shipmentId: number;
  waybillId: string;
  merchantName: string;
  merchantPhone: string;
  recipientName: string;
  addressLines: string[];
  city: string;
  postalCode: string;
  recipientPhone: string;
  orderNumber: string;
  orderDate: string;
  description: string;
  specialNote: string | null;
  codText: string;
  barcode: Code128Bars;
  /** QR modules as a row-major string of `1`/`0`, `size * size` characters long. */
  qr: { size: number; bits: string };
};

export function encodeQrBits(cells: boolean[]): string {
  return cells.map((cell) => (cell ? '1' : '0')).join('');
}
