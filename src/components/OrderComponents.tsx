'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  dispatchOrder,
  markPacked,
  markPacking,
  markReturned,
  reportDeliveryFailure,
  refreshKoombiyoStatusAction,
  refreshRoyalExpressStatusAction,
  retryDispatch,
  type OrderActionResult,
} from '@/app/orders/actions';
import {
  getActionsForStatus,
  getFulfillmentLabel,
  normalizeFulfillmentStatus,
  type FulfillmentAction,
} from '@/lib/fulfillment';
import { getReturnStatusLabel, getReturnTypeLabel } from '@/lib/returns';
import { CreateReturnRequestForm } from '@/components/ReturnComponents';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  x: ["M18 6L6 18", "M6 6l12 12"],
  check: "M20 6L9 17l-5-5",
  truck: ["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", "M18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"],
  mapPin: ["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z", "M12 10a1 1 0 110-2 1 1 0 010 2z"],
  message2: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  printer: ["M6 9V2h12v7", "M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2", "M6 14h12v8H6z"],
  card: ["M2 5h20v14H2z", "M2 10h20"],
  ban: ["M12 22a10 10 0 100-20 10 10 0 000 20", "M5 5l14 14"],
  box: ["M21 8l-9 4-9-4 9-4 9 4z", "M3 8v8l9 4 9-4V8", "M12 12v8"],
  alert: ["M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z", "M12 9v4", "M12 17h.01"],
  rotate: ["M1 4v6h6", "M3.51 15a9 9 0 102.13-9.36L1 10"],
  arrowLeft: ["M19 12H5", "M12 19l-7-7 7-7"],
  refresh: ["M21 12a9 9 0 11-2.64-6.36", "M21 3v6h-6"],
};

const TIMELINE_STEPS = ["pending", "confirmed", "packing", "packed", "dispatched", "delivered"] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  packing: "Packing",
  packed: "Packed",
  shipped: "Dispatched",
  dispatched: "Dispatched",
  delivered: "Delivered",
  delivery_failed: "Delivery failed",
  returned: "Returned",
  cancelled: "Cancelled",
};

const ACTION_ICON: Record<FulfillmentAction, string | string[]> = {
  confirm: ic.check,
  mark_packing: ic.box,
  mark_packed: ic.box,
  dispatch: ic.truck,
  mark_delivered: ic.check,
  mark_delivery_failed: ic.alert,
  retry_dispatch: ic.rotate,
  mark_returned: ic.arrowLeft,
  cancel: ic.ban,
};

interface ActionDispatchInput {
  trackingNumber?: string;
  courier?: string;
  reason?: string;
  note?: string;
}

function runFulfillmentAction(
  action: FulfillmentAction,
  orderId: number,
  input: ActionDispatchInput,
): Promise<OrderActionResult> {
  switch (action) {
    case 'confirm':
      return confirmOrder(orderId);
    case 'mark_packing':
      return markPacking(orderId);
    case 'mark_packed':
      return markPacked(orderId, input.note);
    case 'dispatch':
      return dispatchOrder(orderId, {
        trackingNumber: input.trackingNumber,
        courier: input.courier,
        note: input.note,
      });
    case 'mark_delivered':
      return deliverOrder(orderId);
    case 'mark_delivery_failed':
      return reportDeliveryFailure(orderId, {
        reason: input.reason ?? '',
        note: input.note,
      });
    case 'retry_dispatch':
      return retryDispatch(orderId, {
        trackingNumber: input.trackingNumber,
        courier: input.courier,
        note: input.note,
      });
    case 'mark_returned':
      return markReturned(orderId, {
        reason: input.reason ?? '',
        note: input.note,
      });
    case 'cancel':
      return cancelOrder(orderId);
  }
}

const CHANNEL_COLORS: Record<string, string> = { messenger: "#0866FF", instagram: "#C13584", direct: "#6A635A", whatsapp: "#128C7E" };
const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct", whatsapp: "WhatsApp" };
const ACTIVE_SUPPORT_STATUSES = new Set(["escalated", "open", "pending", "in_progress"]);

export interface OrderDrawerOrderItem {
  id: number;
  quantity: number;
  size?: string | null;
  color?: string | null;
  price: number;
  product?: {
    name?: string | null;
    style?: string | null;
  } | null;
}

export interface OrderFulfillmentEventLike {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  trackingNumber: string | null;
  courier: string | null;
  actorEmail: string | null;
  actorName: string | null;
  customerNotified: boolean;
  createdAt: string;
}

export interface OrderCourierWebhookEventLike {
  id: number;
  provider: string;
  trackingNumber: string | null;
  courierStatus: string;
  mappedStatus: string | null;
  status: string;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface OrderCourierShipmentLike {
  id: number;
  provider: string;
  waybillId: string;
  providerOrderId: string | null;
  orderReference: string | null;
  receiverName: string | null;
  receiverStreet: string | null;
  receiverDistrictId: string | null;
  receiverCityId: string | null;
  receiverPhone: string | null;
  description: string | null;
  specialNote: string | null;
  codAmount: number | null;
  courierStatus: string;
  mappedStatus: string | null;
  lastSyncedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderReturnRequestLike {
  id: number;
  type: string;
  status: string;
  reason: string;
  stockReconciled: boolean;
  replacementOrderId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDrawerOrder {
  id: number;
  orderStatus: string;
  totalAmount: number;
  amount?: number;
  deliveryCharge?: number;
  orderTotal?: number;
  codValue?: number;
  createdAt: Date | string;
  customer: { name: string; phone?: string | null; channel?: string | null };
  deliveryAddress?: string | null;
  deliveryStreetAddress?: string | null;
  deliveryCity?: string | null;
  deliveryDistrict?: string | null;
  brand?: string | null;
  channel?: string;
  paymentMethod?: string | null;
  trackingNumber?: string | null;
  courier?: string | null;
  failureReason?: string | null;
  returnReason?: string | null;
  koombiyoCourier?: {
    isActive: boolean;
    hasApiKey: boolean;
    senderName: string | null;
    senderAddress: string | null;
    senderPhone: string | null;
    defaultReceiverDistrictId: string | null;
    defaultReceiverCityId: string | null;
    resolvedReceiverDistrictId: string | null;
    resolvedReceiverDistrictName: string | null;
    resolvedReceiverCityId: string | null;
    resolvedReceiverCityName: string | null;
  } | null;
  royalExpressCourier?: {
    isActive: boolean;
    hasCredentials: boolean;
    accountEmail: string | null;
    merchantBusinessId: string | null;
    pickupAddressId: string | null;
    originCityId: string | null;
    defaultDestinationCityId: string | null;
  } | null;
  orderItems?: OrderDrawerOrderItem[];
  supportEscalations?: {
    id: number;
    status: string;
    reason: string;
    updatedAt: string;
  }[];
  fulfillmentEvents?: OrderFulfillmentEventLike[];
  courierWebhookEvents?: OrderCourierWebhookEventLike[];
  courierShipments?: OrderCourierShipmentLike[];
  returnRequests?: OrderReturnRequestLike[];
}

export interface OrderPipelineStats {
  pending: number;
  confirmed: number;
  packing: number;
  shipped: number;
  delivered: number;
  deliveryFailed: number;
  returned: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value?: number | null): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, numeric).toLocaleString('en-LK');
}

function formatKoombiyoAmount(value?: number | null): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, numeric).toFixed(2);
}

function formatKoombiyoDateTime(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}

function formatCourierStatus(shipment: OrderCourierShipmentLike): string {
  if (!shipment.submittedAt && shipment.courierStatus === 'waybill_assigned') {
    return 'Waybill assigned';
  }
  return shipment.courierStatus
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown';
}

function buildKoombiyoPackageDescription(order: OrderDrawerOrder | null): string {
  const lines = order?.orderItems?.map((item) => {
    const product = item.product?.name || item.product?.style || 'Garment';
    const variant = [item.size, item.color].filter(Boolean).join(' ');
    return `${product}${variant ? ` (${variant})` : ''} x${item.quantity}`;
  }) ?? [];

  return (lines.join(', ') || 'Garment order').slice(0, 240);
}

const CODE_128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function buildCode128BarcodeSvg(value: string): string {
  const cleaned = value.replace(/[^\x20-\x7E]/g, '').trim() || '0';
  const codes = [104, ...cleaned.split('').map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => (
    index === 0 ? sum + code : sum + code * index
  ), 0) % 103;
  const allCodes = [...codes, checksum, 106];
  let x = 0;
  const bars: string[] = [];

  for (const code of allCodes) {
    const pattern = CODE_128_PATTERNS[code];
    if (!pattern) continue;

    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number.parseInt(pattern[index], 10);
      if (index % 2 === 0) {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="42" />`);
      }
      x += width;
    }
  }

  return [
    `<svg class="barcode-svg" viewBox="0 0 ${x} 42" role="img" aria-label="Waybill barcode ${escapeHtml(cleaned)}" preserveAspectRatio="none">`,
    bars.join(''),
    '</svg>',
  ].join('');
}

function buildKoombiyoPrintAddressLines(
  order: OrderDrawerOrder,
  shipment: OrderCourierShipmentLike,
): string[] {
  const parts = [
    shipment.receiverStreet,
    order.deliveryStreetAddress,
    order.deliveryAddress,
    order.deliveryCity,
    order.deliveryDistrict,
  ].filter((value): value is string => Boolean(value?.trim()));
  const selected: string[] = [];

  for (const part of parts) {
    const normalized = part.toLowerCase().replace(/\s+/g, ' ').trim();
    const alreadyIncluded = selected.some((existing) =>
      existing.toLowerCase().replace(/\s+/g, ' ').includes(normalized) ||
      normalized.includes(existing.toLowerCase().replace(/\s+/g, ' '))
    );

    if (!alreadyIncluded) {
      selected.push(part.trim());
    }
  }

  return selected.length > 0 ? selected : ['No address provided'];
}

function printKoombiyoLabel(order: OrderDrawerOrder, shipment: OrderCourierShipmentLike) {
  const customerName = shipment.receiverName || order.customer.name || 'Customer';
  const addressLines = buildKoombiyoPrintAddressLines(order, shipment);
  const addressHtml = addressLines.map((line) => escapeHtml(line)).join('<br />');
  const phone = shipment.receiverPhone || order.customer.phone || 'No phone';
  const description = shipment.description || buildKoombiyoPackageDescription(order);
  const codAmount = order.orderTotal ?? order.codValue ?? shipment.codAmount ?? order.totalAmount ?? 0;
  const issuedDate = formatKoombiyoDateTime(order.createdAt).split(' ')[0];
  const brandName = order.brand || 'DEEZ';
  const rawSender = order.koombiyoCourier?.senderName || brandName;
  const senderName = rawSender.toLowerCase().replace(/[^a-z0-9]+/g, '') === 'happybuy' ? 'Happy Buy' : rawSender;
  const senderPhone = order.koombiyoCourier?.senderPhone || '-';
  const orderNumber = shipment.orderReference || `ORD-${order.id}`;
  const barcodeSvg = buildCode128BarcodeSvg(shipment.waybillId);
  const html = `<!doctype html>
<html>
<head>
  <title>Koombiyo Label ORD-${order.id}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 landscape; margin: 4mm; }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
      color: #0f172a;
      background: #fff;
    }
    .print-page {
      width: 289mm;
      min-height: 202mm;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-auto-rows: 100mm;
      gap: 2mm;
      align-content: start;
      background: #fff;
    }
    .waybill {
      height: 100mm;
      border: 1.2px solid #1f5da8;
      border-radius: 2.5mm;
      outline: 0.6px solid #1f5da8;
      outline-offset: -1.4mm;
      display: grid;
      grid-template-columns: 56% 44%;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .left-pane,
    .right-pane { min-width: 0; }
    .left-pane {
      display: grid;
      grid-template-rows: 26mm 22mm 1fr;
      border-right: 1.2px solid #1f5da8;
    }
    .logo-block {
      padding: 2mm 2.5mm 1mm;
      border-bottom: 1.2px solid #1f5da8;
    }
    .logo-wrap { text-align: center; height: 18mm; }
    .logo { width: 69mm; max-height: 18mm; object-fit: contain; }
    .company-line {
      display: flex;
      justify-content: space-between;
      gap: 2mm;
      font-size: 7.5px;
      font-weight: 700;
      color: #1f5da8;
      white-space: nowrap;
    }
    .field-block {
      padding: 1.2mm 2mm;
      border-bottom: 1.2px solid #1f5da8;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 22mm;
    }
    .address-block {
      padding: 2.5mm 2mm;
      display: flex;
      flex-direction: column;
      gap: 2mm;
      justify-content: flex-start;
      height: 100%;
    }
    .line {
      display: grid;
      grid-template-columns: 30mm 3mm 1fr;
      align-items: start;
      min-height: 6.5mm;
      font-size: 11px;
      line-height: 1.25;
    }
    .address-block .line {
      grid-template-columns: 20mm 2mm 1fr;
    }
    .address-line {
      align-items: start;
    }
    .phone-line {
      align-items: start;
    }
    .description-line {
      align-items: start;
    }
    .label-key {
      color: #4b5563;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .separator {
      color: #9ca3af;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
    }
    .value {
      font-size: 11.5px;
      font-weight: 750;
      line-height: 1.35;
      min-width: 0;
      overflow-wrap: anywhere;
      color: #0f172a;
    }
    .address-value { font-size: 11.5px; }
    .right-pane {
      display: grid;
      grid-template-rows: 26mm 22mm 1fr;
    }
    .proof-block {
      border-bottom: 1.2px solid #1f5da8;
      padding: 1.6mm 1.6mm 1.2mm;
    }
    .proof-inner {
      height: 100%;
      border: 1.2px solid #1f5da8;
      border-radius: 2mm;
      display: grid;
      grid-template-rows: 7mm 1fr;
      overflow: hidden;
    }
    .proof-title {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      background: #1f5da8;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.6px;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .barcode-panel {
      display: grid;
      justify-items: center;
      align-content: center;
      padding: 0.5mm 4mm 1mm;
    }
    .barcode-svg { width: 54mm; height: 8mm; fill: #111; }
    .barcode-text {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      margin-top: 0.5mm;
      color: #0f172a;
    }
    .cod-block {
      padding: 1.2mm 2mm;
      border-bottom: 1.2px solid #1f5da8;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 22mm;
    }
    .cod-line {
      display: grid;
      grid-template-columns: 30mm 3mm 1fr;
      align-items: center;
      min-height: 6mm;
      font-size: 11px;
    }
    .cod-box {
      height: 8mm;
      border: 1.2px solid #1f5da8;
      border-radius: 1mm;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
      font-weight: 850;
      background: #f8fafc;
      color: #1e3a8a;
    }
    .pod-block {
      padding: 2mm;
    }
    .pod-inner {
      height: 100%;
      border: 1.2px solid #1f5da8;
      border-radius: 1.5mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pod-header {
      background: #eff6ff;
      color: #1f5da8;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-align: center;
      padding: 1.2mm 0;
      border-bottom: 1.2px solid #1f5da8;
      text-transform: uppercase;
      line-height: 1.2;
    }
    .pod-body {
      flex: 1;
      padding: 1.5mm 2mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 0;
    }
    .pod-line {
      display: grid;
      grid-template-columns: 20mm 2mm 1fr;
      align-items: center;
      min-height: 5.2mm;
    }
    .delivered-line {
      display: grid;
      grid-template-columns: 20mm 2mm 1fr;
      align-items: center;
      min-height: 5.2mm;
    }
    .checks {
      display: flex;
      justify-content: flex-end;
      gap: 5mm;
      align-items: center;
      color: #1f5da8;
      font-size: 11px;
      font-weight: 700;
    }
    .box {
      display: inline-block;
      width: 4.5mm;
      height: 4.5mm;
      border: 1.1px solid #1f5da8;
      vertical-align: middle;
      margin-right: 1.4mm;
      background: #fff;
      border-radius: 0.5mm;
    }
    @media print {
      body { padding: 0; }
      .print-page { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-page">
    <section class="waybill">
      <div class="left-pane">
        <div class="logo-block">
          <div class="logo-wrap">
            <img class="logo" src="/koombiyo-logo.png" alt="Koombiyo Delivery" />
          </div>
          <div class="company-line">
            <span>Address: No.25, Epitamulla Road, Kotte.</span>
            <span>Tel: 011 7 886 786</span>
          </div>
        </div>
        <div class="field-block">
          <div class="line">
            <div class="label-key">From</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(senderName)}</div>
          </div>
          <div class="line">
            <div class="label-key">Contact Number</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(senderPhone)}</div>
          </div>
          <div class="line">
            <div class="label-key">Issued Date</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(issuedDate)}</div>
          </div>
        </div>
        <div class="address-block">
          <div class="line">
            <div class="label-key">To</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(customerName)}</div>
          </div>
          <div class="line address-line">
            <div class="label-key">Address</div>
            <div class="separator">:</div>
            <div class="value address-value">${addressHtml}</div>
          </div>
          <div class="line phone-line">
            <div class="label-key">Phone No</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(phone)}</div>
          </div>
          <div class="line description-line">
            <div class="label-key">Description</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(description)}</div>
          </div>
        </div>
      </div>
      <div class="right-pane">
        <div class="proof-block">
          <div class="proof-inner">
            <div class="proof-title">PROOF OF DELIVERY</div>
            <div class="barcode-panel">
              ${barcodeSvg}
              <div class="barcode-text">${escapeHtml(shipment.waybillId)}</div>
            </div>
          </div>
        </div>
        <div class="cod-block">
          <div class="cod-line">
            <div class="label-key">COD AMOUNT</div>
            <div class="separator">:</div>
            <div class="cod-box">${formatKoombiyoAmount(codAmount)}</div>
          </div>
          <div class="cod-line">
            <div class="label-key">Order No</div>
            <div class="separator">:</div>
            <div class="value">${escapeHtml(orderNumber)}</div>
          </div>
          <div class="cod-line">
            <div class="label-key">Weight</div>
            <div class="separator">:</div>
            <div class="value"></div>
          </div>
        </div>
        <div class="pod-block">
          <div class="pod-inner">
            <div class="pod-header">RECEIVER SIGN-OFF</div>
            <div class="pod-body">
              <div class="pod-line">
                <div class="label-key">Name</div>
                <div class="separator">:</div>
                <div class="value"></div>
              </div>
              <div class="pod-line">
                <div class="label-key">Address</div>
                <div class="separator">:</div>
                <div class="value"></div>
              </div>
              <div class="pod-line">
                <div class="label-key">NIC Number</div>
                <div class="separator">:</div>
                <div class="value"></div>
              </div>
              <div class="pod-line">
                <div class="label-key">Date</div>
                <div class="separator">:</div>
                <div class="value"></div>
              </div>
              <div class="pod-line">
                <div class="label-key">Signature</div>
                <div class="separator">:</div>
                <div class="value"></div>
              </div>
              <div class="delivered-line">
                <div class="label-key">Delivrd</div>
                <div class="separator">:</div>
                <div class="checks">
                  <span><span class="box"></span>Yes</span>
                  <span><span class="box"></span>No</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
  <div class="no-print" style="padding:12px">
    <button onclick="window.print()">Print label</button>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 200);</script>
</body>
</html>`;
  const popup = window.open('', '_blank', 'width=980,height=620');
  if (!popup) {
    throw new Error('Popup blocked. Allow popups for this app to print the courier label.');
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

export function OrderDrawer({
  order,
  onClose,
  canUpdate = true,
  initialAction = null,
}: {
  order: OrderDrawerOrder | null;
  onClose: () => void;
  canUpdate?: boolean;
  // When the parent opens the drawer specifically to fill a form (e.g. a row
  // click on "Dispatch"), pass that action here and the drawer will pre-open
  // the matching input panel.
  initialAction?: FulfillmentAction | null;
}) {
  const router = useRouter();
  const open = !!order;
  const status = order?.orderStatus || 'pending';
  const normalized = normalizeFulfillmentStatus(status);
  const isCancelled = normalized === 'cancelled';
  const channelKey = order?.channel || order?.customer.channel || 'direct';
  const stepIdx = TIMELINE_STEPS.indexOf(normalized as typeof TIMELINE_STEPS[number]);

  const [isPending, startTransition] = useTransition();
  const koombiyoShipments = useMemo(() => {
    return [...(order?.courierShipments ?? [])]
      .filter((shipment) => shipment.provider === 'koombiyo')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [order?.courierShipments]);
  const latestKoombiyoShipment = koombiyoShipments[0] ?? null;
  const latestIntegratedShipment = useMemo(() => {
    return [...(order?.courierShipments ?? [])]
      .filter((shipment) => shipment.provider === 'royalexpress' || shipment.provider === 'koombiyo')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  }, [order?.courierShipments]);
  const hasActiveKoombiyoCourier = Boolean(order?.koombiyoCourier?.isActive);
  const hasActiveRoyalExpressCourier = Boolean(order?.royalExpressCourier?.isActive);
  const hasActiveIntegratedCourier = hasActiveRoyalExpressCourier || hasActiveKoombiyoCourier;
  const activeIntegratedCourierLabel = hasActiveRoyalExpressCourier
    ? 'RoyalExpress'
    : hasActiveKoombiyoCourier
      ? 'Koombiyo'
      : null;
  const latestIntegratedCourierLabel =
    latestIntegratedShipment?.provider === 'royalexpress' ? 'RoyalExpress' : 'Koombiyo';
  const initialPendingAction =
    hasActiveIntegratedCourier && (initialAction === 'dispatch' || initialAction === 'retry_dispatch')
      ? null
      : initialAction;
  const [error, setError] = useState<string | null>(null);
  const [pendingActionForm, setPendingActionForm] = useState<FulfillmentAction | null>(initialPendingAction);
  const [trackingDraft, setTrackingDraft] = useState(order?.trackingNumber ?? '');
  const [courierDraft, setCourierDraft] = useState(order?.courier ?? '');
  const [reasonDraft, setReasonDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showCreateReturn, setShowCreateReturn] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTrackingDraft(order?.trackingNumber ?? '');
      setCourierDraft(order?.courier ?? '');
      setReasonDraft('');
      setNoteDraft('');
      setPendingActionForm(initialPendingAction);
      setShowCreateReturn(false);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    order?.id,
    order?.trackingNumber,
    order?.courier,
    initialPendingAction,
  ]);

  const actions = canUpdate && order ? getActionsForStatus(status) : [];
  const activeSupport = order?.supportEscalations?.filter((support) => ACTIVE_SUPPORT_STATUSES.has(support.status)) || [];

  const runAction = (action: FulfillmentAction, input: ActionDispatchInput = {}) => {
    if (!order) return;
    setError(null);
    startTransition(async () => {
      const result = await runFulfillmentAction(action, order.id, input);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      setPendingActionForm(null);
      setReasonDraft('');
      setNoteDraft('');
      router.refresh();
    });
  };

  const submitPendingForm = (action: FulfillmentAction) => {
    runAction(action, {
      trackingNumber: trackingDraft || undefined,
      courier: courierDraft || undefined,
      reason: reasonDraft || undefined,
      note: noteDraft || undefined,
    });
  };

  const handleActionClick = (action: FulfillmentAction, requiresInput: boolean) => {
    if (action === 'cancel') {
      const ok = window.confirm(`Cancel order #${order?.id}? This will release reserved stock.`);
      if (ok) runAction('cancel');
      return;
    }

    if (requiresInput) {
      // If the form for this action is already open, treat the bottom button
      // as a submit so admins don't have to hunt for the in-form save.
      if (pendingActionForm === action) {
        submitPendingForm(action);
      } else {
        setPendingActionForm(action);
      }
      return;
    }

    runAction(action);
  };

  const totalUnits = order?.orderItems?.reduce((acc, i) => acc + i.quantity, 0) ?? 0;

  const sortedEvents = useMemo(() => {
    return [...(order?.fulfillmentEvents ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [order?.fulfillmentEvents]);
  const courierEvents = useMemo(() => {
    return [...(order?.courierWebhookEvents ?? [])].sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  }, [order?.courierWebhookEvents]);
  const printLatestKoombiyoLabel = () => {
    if (!order || !latestKoombiyoShipment) return;
    try {
      printKoombiyoLabel(order, latestKoombiyoShipment);
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : 'Could not open the print label window.');
    }
  };

  const refreshKoombiyoStatus = () => {
    if (!order) return;
    setError(null);
    startTransition(async () => {
      const result = await refreshKoombiyoStatusAction(order.id);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const refreshRoyalExpressStatus = () => {
    if (!order) return;
    setError(null);
    startTransition(async () => {
      const result = await refreshRoyalExpressStatusAction(order.id);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const refreshLatestIntegratedStatus = () => {
    if (latestIntegratedShipment?.provider === 'royalexpress') {
      refreshRoyalExpressStatus();
      return;
    }
    refreshKoombiyoStatus();
  };

  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`drawer${open ? " open" : ""}`}>
        {order && (
          <>
            <div className="drawer-head">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--color-fg-1)" }}>#ORD-{order.id}</code>
                  <span className={`pill pill-${normalized}`}>{STATUS_LABELS[status] || STATUS_LABELS[normalized] || normalized}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-fg-3)" }}>
                  {new Date(order.createdAt).toLocaleString()} · via <span style={{ fontWeight: 600, color: CHANNEL_COLORS[channelKey] || CHANNEL_COLORS.direct }}>{CHANNEL_LABELS[channelKey] || channelKey}</span>
                </div>
              </div>
              <button className="drawer-close" onClick={onClose}>
                <Icon d={ic.x} size={13} color="var(--color-fg-2)" />
              </button>
            </div>
            <div className="drawer-body">
              <div>
                <div className="drawer-section-label">Customer</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{order.customer.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-fg-3)" }}>
                  <Icon d={ic.mapPin} size={12} color="var(--color-fg-3)" />
                  {order.deliveryStreetAddress || order.deliveryAddress || 'No address provided'}
                </div>
                {(order.deliveryCity || order.deliveryDistrict) && (
                  <div style={{ fontSize: 12, color: "var(--color-fg-3)", marginTop: 4 }}>
                    {[order.deliveryCity, order.deliveryDistrict].filter(Boolean).join(', ')}
                  </div>
                )}
                {order.customer.phone && (
                  <div style={{ fontSize: 12, color: "var(--color-fg-3)", marginTop: 4 }}>{order.customer.phone}</div>
                )}
              </div>

              <div>
                <div className="drawer-section-label">Order Details</div>
                <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Brand:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{order.brand || 'N/A'}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon d={ic.card} size={11} color="var(--color-fg-3)" />Payment:
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{order.paymentMethod || '—'}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Units:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{totalUnits}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Support:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {activeSupport.length > 0 ? `${activeSupport.length} active` : order.supportEscalations?.length ? 'resolved' : 'clear'}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Amount:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Rs {formatMoney(order.amount ?? order.totalAmount)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Delivery Charge:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Rs {formatMoney(order.deliveryCharge ?? 0)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Total Amount:</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Rs {formatMoney(order.orderTotal ?? order.totalAmount)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>COD Value:</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>Rs {formatMoney(order.codValue ?? order.orderTotal ?? order.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {(order.trackingNumber || order.courier || order.failureReason || order.returnReason || latestIntegratedShipment || order.koombiyoCourier || order.royalExpressCourier) && (
                <div>
                  <div className="drawer-section-label">Shipment</div>
                  <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {order.courier && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Courier</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{order.courier}</span>
                      </div>
                    )}
                    {order.trackingNumber && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Tracking</span>
                        <code style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{order.trackingNumber}</code>
                      </div>
                    )}
                    {latestIntegratedShipment && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>{latestIntegratedCourierLabel} status</span>
                          <span style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>
                            {formatCourierStatus(latestIntegratedShipment)}
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>{latestIntegratedCourierLabel} handover</span>
                          <span style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>
                            {latestIntegratedShipment.submittedAt ? 'Sent' : 'Not sent yet'}
                          </span>
                        </div>
                        {latestIntegratedShipment.lastSyncedAt && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Last sync</span>
                            <span style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }} suppressHydrationWarning>
                              {new Date(latestIntegratedShipment.lastSyncedAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {order.failureReason && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Failure</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#8B2020", textAlign: "right" }}>{order.failureReason}</span>
                      </div>
                    )}
                    {order.returnReason && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Return reason</span>
                        <span style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>{order.returnReason}</span>
                      </div>
                    )}
                    {canUpdate && order.brand && (
                      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                        {hasActiveIntegratedCourier ? (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {latestKoombiyoShipment && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: 12 }}
                                type="button"
                                disabled={isPending}
                                onClick={printLatestKoombiyoLabel}
                              >
                                <Icon d={ic.printer} size={12} />
                                Print Label
                              </button>
                            )}
                            {latestIntegratedShipment?.submittedAt && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: 12 }}
                                type="button"
                                disabled={isPending}
                                onClick={refreshLatestIntegratedStatus}
                              >
                                <Icon d={ic.refresh} size={12} />
                                Refresh Status
                              </button>
                            )}
                            {!latestIntegratedShipment && hasActiveRoyalExpressCourier && (
                              <div style={{ fontSize: 12, color: 'var(--color-fg-3)', lineHeight: 1.4 }}>
                                RoyalExpress delivery is created in Curfox when you dispatch the packed order.
                              </div>
                            )}
                            {!latestIntegratedShipment && hasActiveKoombiyoCourier && !hasActiveRoyalExpressCourier && (
                              <div style={{ fontSize: 12, color: 'var(--color-fg-3)', lineHeight: 1.4 }}>
                                Waybill should be assigned automatically when the order is placed. Check the history for any courier setup error.
                              </div>
                            )}
                            {latestKoombiyoShipment && !latestKoombiyoShipment.submittedAt && (
                              <div style={{ fontSize: 12, color: 'var(--color-fg-3)', lineHeight: 1.4 }}>
                                Print the label before handover. Sending to Koombiyo happens when you dispatch the packed order.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--color-fg-3)' }}>
                            No integrated courier is active for {order.brand}. Enable RoyalExpress or Koombiyo in Settings.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {order.supportEscalations && order.supportEscalations.length > 0 && (
                <div>
                  <div className="drawer-section-label">Support State</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {order.supportEscalations.slice(0, 3).map((support) => {
                      const active = ACTIVE_SUPPORT_STATUSES.has(support.status);
                      return (
                        <div key={support.id} className="support-state-row">
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-fg-1)" }}>
                              Case #{support.id} · {support.reason}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-fg-3)", marginTop: 2 }} suppressHydrationWarning>
                              Updated {new Date(support.updatedAt).toLocaleString()}
                            </div>
                          </div>
                          <span className={`support-state-chip${active ? ' active' : ''}`}>{support.status}</span>
                        </div>
                      );
                    })}
                    {order.supportEscalations.length > 3 && (
                      <div style={{ fontSize: 11, color: "var(--color-fg-3)" }}>
                        +{order.supportEscalations.length - 3} older support case{order.supportEscalations.length - 3 === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {order.returnRequests && order.returnRequests.length > 0 && (
                <div>
                  <div className="drawer-section-label">Return / Exchange Requests</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {order.returnRequests.map((rr) => (
                      <div key={rr.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>
                            #{rr.id} · {getReturnTypeLabel(rr.type)}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-fg-3)' }}>
                            {getReturnStatusLabel(rr.status)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-fg-2)' }}>{rr.reason}</div>
                        {rr.stockReconciled && (
                          <div style={{ fontSize: 11, color: '#38A169', marginTop: 4 }}>Stock reconciled</div>
                        )}
                        {rr.replacementOrderId && (
                          <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 2 }}>
                            Replacement: ORD-{rr.replacementOrderId}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canUpdate && !showCreateReturn && normalized === 'delivered' && (
                <div>
                  <button
                    className="btn btn-secondary"
                    style={{ justifyContent: 'center', fontSize: 12, width: '100%' }}
                    onClick={() => setShowCreateReturn(true)}
                    type="button"
                  >
                    <Icon d={ic.arrowLeft} size={12} />
                    Create Return / Exchange Request
                  </button>
                </div>
              )}

              {showCreateReturn && order && (
                <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                  <div className="drawer-section-label" style={{ marginBottom: 8 }}>New Return / Exchange</div>
                  <CreateReturnRequestForm
                    orderId={order.id}
                    onSuccess={() => {
                      setShowCreateReturn(false);
                      router.refresh();
                    }}
                    onCancel={() => setShowCreateReturn(false)}
                  />
                </div>
              )}

              {order.orderItems && order.orderItems.length > 0 && (
                <div>
                  <div className="drawer-section-label">Items</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {order.orderItems.map((item) => (
                      <div key={item.id} className="order-item-row">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.product?.name || item.product?.style || `Product`}
                          </div>
                          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                            {item.size && <span className="var-chip">Size {item.size}</span>}
                            {item.color && <span className="var-chip">{item.color}</span>}
                            <span className="var-chip">×{item.quantity}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                          ₺{(item.price * item.quantity).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="drawer-section-label">Order Timeline</div>
                <div className="timeline">
                  {TIMELINE_STEPS.map((step, i) => {
                    const state = isCancelled || normalized === 'returned'
                      ? 'future'
                      : i < stepIdx
                        ? 'done'
                        : i === stepIdx
                          ? 'current'
                          : 'future';
                    return (
                      <div key={step} className="tl-step">
                        <div className={`tl-dot ${state}`}>
                          {(state === 'done' || state === 'current') && <Icon d={ic.check} size={11} color="white" strokeWidth={2.5} />}
                        </div>
                        <div className="tl-label">
                          <div className="tl-label-title" style={{ color: state === 'future' ? 'var(--color-fg-3)' : 'var(--color-fg-1)' }}>{getFulfillmentLabel(step)}</div>
                          <div className="tl-label-sub">{state !== 'future' ? 'Updated' : '—'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {sortedEvents.length > 0 && (
                <div>
                  <div className="drawer-section-label">History</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sortedEvents.map((event) => (
                      <li
                        key={event.id}
                        style={{
                          background: 'var(--color-bg)',
                          borderRadius: 'var(--radius-md)',
                          padding: '8px 12px',
                          fontSize: 12,
                          color: 'var(--color-fg-2)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <strong style={{ color: 'var(--color-fg-1)' }}>
                            {event.fromStatus ? `${getFulfillmentLabel(event.fromStatus)} → ` : ''}
                            {getFulfillmentLabel(event.toStatus)}
                          </strong>
                          <span style={{ fontSize: 11, color: 'var(--color-fg-3)' }} suppressHydrationWarning>
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {event.actorName || event.actorEmail ? (
                            <span>By {event.actorName || event.actorEmail}</span>
                          ) : null}
                          {event.courier ? <span>Courier: {event.courier}</span> : null}
                          {event.trackingNumber ? <span>Tracking: {event.trackingNumber}</span> : null}
                          {event.customerNotified ? <span style={{ color: 'var(--color-fg-3)' }}>· customer notified</span> : null}
                        </div>
                        {event.note && (
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-fg-2)' }}>{event.note}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {courierEvents.length > 0 && (
                <div>
                  <div className="drawer-section-label">Courier Webhook Timeline</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {courierEvents.map((event) => (
                      <li
                        key={event.id}
                        style={{
                          background: 'var(--color-bg)',
                          borderRadius: 'var(--radius-md)',
                          padding: '8px 12px',
                          fontSize: 12,
                          color: 'var(--color-fg-2)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <strong style={{ color: 'var(--color-fg-1)' }}>
                            {event.provider} · {event.courierStatus}
                          </strong>
                          <span style={{ fontSize: 11, color: 'var(--color-fg-3)' }} suppressHydrationWarning>
                            {new Date(event.receivedAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {event.mappedStatus ? <span>Mapped: {getFulfillmentLabel(event.mappedStatus)}</span> : null}
                          {event.trackingNumber ? <span>Tracking: {event.trackingNumber}</span> : null}
                          <span>Status: {event.status}</span>
                        </div>
                        {event.error && (
                          <div style={{ marginTop: 4, color: '#8B2020' }}>{event.error}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="drawer-error" role="alert">
                  {error}
                </div>
              )}

              {pendingActionForm && (
                <FulfillmentActionForm
                  action={pendingActionForm}
                  trackingDraft={trackingDraft}
                  courierDraft={courierDraft}
                  reasonDraft={reasonDraft}
                  noteDraft={noteDraft}
                  onTrackingChange={setTrackingDraft}
                  onCourierChange={setCourierDraft}
                  onReasonChange={setReasonDraft}
                  onNoteChange={setNoteDraft}
                  onCancel={() => setPendingActionForm(null)}
                />
              )}
            </div>
            <div className="drawer-actions">
              {actions.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-fg-3)', textAlign: 'center' }}>
                  No further fulfillment actions available for this order.
                </div>
              )}
              {actions.map((descriptor) => {
                const isIntegratedDispatch =
                  hasActiveIntegratedCourier &&
                  (descriptor.action === 'dispatch' || descriptor.action === 'retry_dispatch');
                const requiresInput = !isIntegratedDispatch && Boolean(descriptor.requiresTracking || descriptor.requiresReason);
                const isThisFormOpen = !isIntegratedDispatch && pendingActionForm === descriptor.action;
                const reasonMissing =
                  descriptor.requiresReason && isThisFormOpen && !reasonDraft.trim();
                const buttonClass =
                  descriptor.variant === 'success'
                    ? 'btn btn-success'
                    : descriptor.variant === 'danger'
                      ? 'btn btn-danger'
                      : descriptor.variant === 'secondary'
                        ? 'btn btn-secondary'
                        : 'btn btn-primary';
                const submitLabel = `Save & ${descriptor.shortLabel}`;
                const actionLabel = isIntegratedDispatch
                  ? descriptor.action === 'retry_dispatch'
                    ? `Retry ${activeIntegratedCourierLabel}`
                    : `Send to ${activeIntegratedCourierLabel}`
                  : descriptor.label;
                return (
                  <button
                    key={descriptor.action}
                    className={buttonClass}
                    style={{ justifyContent: 'center', fontSize: 12 }}
                    disabled={isPending || reasonMissing}
                    title={reasonMissing ? 'Enter a reason in the form above to enable this action.' : undefined}
                    onClick={() => handleActionClick(descriptor.action, requiresInput)}
                  >
                    {ACTION_ICON[descriptor.action] && <Icon d={ACTION_ICON[descriptor.action]} size={12} />}
                    {isPending && isThisFormOpen
                      ? 'Saving…'
                      : isThisFormOpen
                        ? submitLabel
                        : actionLabel}
                  </button>
                );
              })}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <button className="btn btn-secondary" style={{ justifyContent: 'center', fontSize: 12 }}>
                  <Icon d={ic.message2} size={12} />Contact
                </button>
              </div>
              {!canUpdate && (
                <div className="drawer-error" role="note">
                  Your role can view this order but cannot change its lifecycle.
                </div>
              )}
              <button className="btn btn-ghost" style={{ justifyContent: 'center', fontSize: 12, color: 'var(--color-fg-3)' }}>
                <Icon d={ic.printer} size={12} />Print Invoice
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function FulfillmentActionForm({
  action,
  trackingDraft,
  courierDraft,
  reasonDraft,
  noteDraft,
  onTrackingChange,
  onCourierChange,
  onReasonChange,
  onNoteChange,
  onCancel,
}: {
  action: FulfillmentAction;
  trackingDraft: string;
  courierDraft: string;
  reasonDraft: string;
  noteDraft: string;
  onTrackingChange: (value: string) => void;
  onCourierChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
}) {
  const showTracking = action === 'dispatch' || action === 'retry_dispatch';
  const showReason = action === 'mark_delivery_failed' || action === 'mark_returned';
  const reasonLabel = action === 'mark_delivery_failed' ? 'Failure reason' : 'Return reason';
  const reasonInputRef = React.useRef<HTMLInputElement>(null);
  const trackingInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (showReason) {
      reasonInputRef.current?.focus();
    } else if (showTracking) {
      trackingInputRef.current?.focus();
    }
  }, [action, showReason, showTracking]);

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-md)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {showTracking && (
        <>
          <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>Courier</label>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. Domex, Pronto, Fardar Express"
            value={courierDraft}
            onChange={(e) => onCourierChange(e.target.value)}
          />
          <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>Tracking number</label>
          <input
            ref={trackingInputRef}
            type="text"
            className="search-input"
            placeholder="Enter courier tracking reference"
            value={trackingDraft}
            onChange={(e) => onTrackingChange(e.target.value)}
          />
        </>
      )}
      {showReason && (
        <>
          <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>
            {reasonLabel} <span style={{ color: 'var(--color-error)' }}>*</span>
          </label>
          <input
            ref={reasonInputRef}
            type="text"
            className="search-input"
            placeholder={action === 'mark_delivery_failed' ? 'e.g. recipient not available' : 'e.g. wrong size, damaged'}
            value={reasonDraft}
            onChange={(e) => onReasonChange(e.target.value)}
            required
          />
        </>
      )}
      <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>Internal note (optional)</label>
      <input
        type="text"
        className="search-input"
        placeholder="Notes saved to the audit trail"
        value={noteDraft}
        onChange={(e) => onNoteChange(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 11,
            color: showReason && !reasonDraft.trim() ? 'var(--color-error)' : 'var(--color-fg-3)',
            fontWeight: showReason && !reasonDraft.trim() ? 600 : 400,
          }}
        >
          {showReason && !reasonDraft.trim()
            ? `Enter a ${reasonLabel.toLowerCase()} to enable the action button below.`
            : 'Use the action button below to save and continue.'}
        </span>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel} type="button">
          Discard
        </button>
      </div>
    </div>
  );
}

export function OrderPipeline({ stats }: { stats: OrderPipelineStats }) {
  const pipeline = [
    { key: "pending", label: "Pending", color: "#E8C840", count: stats.pending },
    { key: "confirmed", label: "Confirmed", color: "#4A7AA8", count: stats.confirmed },
    { key: "packing", label: "Packing", color: "#8B5CF6", count: stats.packing },
    { key: "dispatched", label: "Dispatched", color: "#38A169", count: stats.shipped },
    { key: "delivered", label: "Delivered", color: "#1E6B45", count: stats.delivered },
    { key: "delivery_failed", label: "Failed", color: "#C04A4A", count: stats.deliveryFailed },
    { key: "returned", label: "Returned", color: "#A07050", count: stats.returned },
  ];

  const total = pipeline.reduce((acc, s) => acc + s.count, 0);

  return (
    <div className="pipeline-strip">
      <div className="pipe-bar">
        {pipeline.map(s => (
          <div
            key={s.key}
            className="pipe-seg"
            style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="pipe-legend">
        {pipeline.map(s => (
          <div key={s.key} className="pipe-leg-item">
            <div className="pipe-dot" style={{ background: s.color, width: 8, height: 8, borderRadius: '50%' }} />
            <strong>{s.count}</strong> {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderRowQuickActions({
  orderId,
  status,
  onRequireForm,
  hasActiveCourier = false,
  activeCourierLabel = 'Courier',
}: {
  orderId: number;
  status: string;
  // Called for actions that need extra input (tracking, reason). The parent
  // opens the drawer for this order with the form pre-opened — keeping the
  // row useful even at stages whose only forward move is dispatch/return/fail.
  onRequireForm?: (orderId: number, action: FulfillmentAction) => void;
  hasActiveCourier?: boolean;
  activeCourierLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = getActionsForStatus(status);

  if (actions.length === 0) return null;

  const runRowAction = (action: FulfillmentAction) => {
    setError(null);
    startTransition(async () => {
      const result = await runFulfillmentAction(action, orderId, {});
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleClick = (descriptor: typeof actions[number]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (descriptor.action === 'cancel') {
      const ok = window.confirm(`Cancel order #${orderId}? This will release reserved stock.`);
      if (ok) runRowAction(descriptor.action);
      return;
    }
    const usesIntegratedCourier =
      hasActiveCourier && (descriptor.action === 'dispatch' || descriptor.action === 'retry_dispatch');
    if (!usesIntegratedCourier && (descriptor.requiresTracking || descriptor.requiresReason)) {
      onRequireForm?.(orderId, descriptor.action);
      return;
    }
    runRowAction(descriptor.action);
  };

  return (
    <div className="row-actions" title={error || undefined} data-error={error ? 'true' : undefined}>
      {actions.map((descriptor) => (
        (() => {
          const usesIntegratedCourier =
            hasActiveCourier && (descriptor.action === 'dispatch' || descriptor.action === 'retry_dispatch');
          const title = usesIntegratedCourier
            ? descriptor.action === 'retry_dispatch'
              ? `Retry ${activeCourierLabel}`
              : `Send to ${activeCourierLabel}`
            : descriptor.label;

          return (
            <button
              key={descriptor.action}
              className={descriptor.destructive ? 'row-action-btn row-action-danger' : 'row-action-btn'}
              onClick={handleClick(descriptor)}
              disabled={isPending}
              title={title}
            >
              {isPending ? '...' : descriptor.shortLabel}
            </button>
          );
        })()
      ))}
    </div>
  );
}
