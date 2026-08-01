'use client';

import type { WaybillLabelData } from '@/lib/waybill-label';

/**
 * Renders a waybill to a PNG sized exactly like the 4in x 6in printed sheet, so
 * the file can be dropped straight into the MarkLife mobile app (album print).
 */

const SHEET_W_MM = 101.6;
const SHEET_H_MM = 152.4;
const OUTER_BORDER_MM = 0.35;
const INNER_BORDER_MM = 0.2;
const CONTENT_W_MM = SHEET_W_MM - OUTER_BORDER_MM * 2;
const CONTENT_H_MM = SHEET_H_MM - OUTER_BORDER_MM * 2;

const ROW_TOP_MM = 39;
const ROW_TITLE_MM = 7;
const ROW_DETAILS_MM = 44;
const ROW_FOOTER_MM = 5;
const Y_TITLE_MM = ROW_TOP_MM;
const Y_DETAILS_MM = Y_TITLE_MM + ROW_TITLE_MM;
const Y_ORDER_TITLE_MM = Y_DETAILS_MM + ROW_DETAILS_MM;
const Y_ORDER_DETAILS_MM = Y_ORDER_TITLE_MM + ROW_TITLE_MM;
const Y_FOOTER_MM = CONTENT_H_MM - ROW_FOOTER_MM;

const COL1_W_MM = CONTENT_W_MM * 0.34;
const CELL_PAD_X_MM = 2.6;
const CELL_PAD_Y_MM = 2.4;

const TOP_PAD_X_MM = 2.8;
const TOP_PAD_TOP_MM = 2.4;
const TOP_INNER_W_MM = CONTENT_W_MM - TOP_PAD_X_MM * 2;
const TRACKING_RIGHT_MM = TOP_PAD_X_MM + TOP_INNER_W_MM;
const LOGO_W_MM = 35;
const LOGO_H_MM = 18;
const BARCODE_PANEL_W_MM = 56;
const BARCODE_W_MM = 55;
const BARCODE_H_MM = 9;
const QR_BOX_MM = 15;
const QR_PAD_MM = 1;

const FONT_SANS = 'Arial, Helvetica, sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LINE_HEIGHT = 1.18;
const LABEL_SIZE = 7.5;
const VALUE_GAP_MM = 1.1;

const CARRIER_PHONE = '0112 417 417';
const CARRIER_ADDRESS = ['No. 69, Subhadrarama Rd,', 'Nugegoda'];
const FOOTER_TEXT = 'POWERED BY CURFOX.COM';
const LOGO_SRC = '/royal-express-logo.png';

export const WAYBILL_DPI_OPTIONS = [203, 300] as const;
export const DEFAULT_WAYBILL_DPI = 203;

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string };

type Pen = {
  ctx: SpacedContext;
  /** millimetres -> device pixels */
  mm: (value: number) => number;
  /** CSS pixels (the units used by the printed sheet's stylesheet) -> device pixels */
  cssPx: (value: number) => number;
};

let logoRequest: Promise<HTMLImageElement | null> | null = null;

function loadLogo(): Promise<HTMLImageElement | null> {
  if (!logoRequest) {
    logoRequest = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = LOGO_SRC;
    });
  }

  return logoRequest;
}

function setFont(pen: Pen, size: number, weight: number, family = FONT_SANS, spacing = 0) {
  pen.ctx.font = `${weight} ${pen.cssPx(size)}px ${family}`;
  if ('letterSpacing' in pen.ctx) pen.ctx.letterSpacing = `${pen.cssPx(spacing)}px`;
}

/** CSS px font size -> line box height in millimetres. */
function lineMm(size: number, lineHeight = LINE_HEIGHT) {
  return (size * lineHeight * 25.4) / 96;
}

function wrapText(pen: Pen, text: string, maxWidthMm: number): string[] {
  const maxWidth = pen.mm(maxWidthMm);
  const lines: string[] = [];
  let line = '';

  for (const rawWord of String(text).split(/\s+/).filter(Boolean)) {
    let word = rawWord;

    // `overflow-wrap: anywhere` - split words that cannot fit on a line of their own.
    while (pen.ctx.measureText(word).width > maxWidth) {
      let cut = 1;
      while (cut < word.length && pen.ctx.measureText(word.slice(0, cut + 1)).width <= maxWidth) {
        cut += 1;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }

    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (pen.ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function writeLines(
  pen: Pen,
  lines: string[],
  x: number,
  y: number,
  size: number,
  lineHeight = LINE_HEIGHT,
): number {
  const step = lineMm(size, lineHeight);
  let cursor = y;

  for (const line of lines) {
    pen.ctx.fillText(line, pen.mm(x), pen.mm(cursor));
    cursor += step;
  }

  return cursor;
}

function drawFieldLabel(pen: Pen, text: string, x: number, y: number): number {
  pen.ctx.fillStyle = '#000';
  setFont(pen, LABEL_SIZE, 800, FONT_SANS, 0.45);
  return writeLines(pen, [text.toUpperCase()], x, y, LABEL_SIZE);
}

function drawFieldValue(
  pen: Pen,
  value: string | string[],
  x: number,
  y: number,
  width: number,
  size: number,
  options: { lineHeight?: number; gap?: number } = {},
): number {
  pen.ctx.fillStyle = '#000';
  setFont(pen, size, 800);
  const source = Array.isArray(value) ? value : [value];
  const lines = source.flatMap((entry) => wrapText(pen, entry, width));
  const end = writeLines(pen, lines.length > 0 ? lines : [''], x, y, size, options.lineHeight);
  return end + (options.gap ?? VALUE_GAP_MM);
}

function drawRule(pen: Pen, x: number, y: number, width: number, height: number) {
  pen.ctx.fillStyle = '#000';
  pen.ctx.fillRect(
    Math.round(pen.mm(x)),
    Math.round(pen.mm(y)),
    Math.max(1, Math.round(pen.mm(width))),
    Math.max(1, Math.round(pen.mm(height))),
  );
}

function drawCentredTitle(pen: Pen, text: string, x: number, width: number, y: number, height: number) {
  pen.ctx.fillStyle = '#000';
  setFont(pen, 9.5, 900, FONT_SANS, 0.8);
  pen.ctx.textAlign = 'center';
  pen.ctx.textBaseline = 'middle';
  pen.ctx.fillText(text.toUpperCase(), pen.mm(x + width / 2), pen.mm(y + height / 2));
  pen.ctx.textAlign = 'left';
  pen.ctx.textBaseline = 'top';
}

function drawBarcode(pen: Pen, barcode: WaybillLabelData['barcode'], x: number, y: number) {
  if (barcode.width <= 0) return;
  const scale = BARCODE_W_MM / barcode.width;
  pen.ctx.fillStyle = '#000';

  for (let index = 0; index < barcode.bars.length; index += 2) {
    const left = Math.round(pen.mm(x + barcode.bars[index] * scale));
    const right = Math.round(pen.mm(x + (barcode.bars[index] + barcode.bars[index + 1]) * scale));
    pen.ctx.fillRect(left, Math.round(pen.mm(y)), Math.max(1, right - left), Math.round(pen.mm(BARCODE_H_MM)));
  }
}

function drawQr(pen: Pen, qr: WaybillLabelData['qr'], x: number, y: number) {
  if (qr.size <= 0) return;
  const inner = QR_BOX_MM - QR_PAD_MM * 2;
  const cell = inner / qr.size;
  pen.ctx.fillStyle = '#fff';
  pen.ctx.fillRect(pen.mm(x), pen.mm(y), pen.mm(QR_BOX_MM), pen.mm(QR_BOX_MM));
  pen.ctx.fillStyle = '#000';

  for (let row = 0; row < qr.size; row += 1) {
    for (let column = 0; column < qr.size; column += 1) {
      if (qr.bits[row * qr.size + column] !== '1') continue;
      const left = Math.round(pen.mm(x + QR_PAD_MM + column * cell));
      const right = Math.round(pen.mm(x + QR_PAD_MM + (column + 1) * cell));
      const top = Math.round(pen.mm(y + QR_PAD_MM + row * cell));
      const bottom = Math.round(pen.mm(y + QR_PAD_MM + (row + 1) * cell));
      pen.ctx.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    }
  }
}

function withCellClip(pen: Pen, x: number, y: number, width: number, height: number, draw: () => void) {
  pen.ctx.save();
  pen.ctx.beginPath();
  pen.ctx.rect(pen.mm(x), pen.mm(y), pen.mm(width), pen.mm(height));
  pen.ctx.clip();
  draw();
  pen.ctx.restore();
}

function drawTopSection(pen: Pen, label: WaybillLabelData, logo: HTMLImageElement | null) {
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(pen.mm(LOGO_W_MM) / logo.width, pen.mm(LOGO_H_MM) / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    const supportsFilter = 'filter' in pen.ctx;
    if (supportsFilter) pen.ctx.filter = 'grayscale(1) contrast(1.15)';
    pen.ctx.drawImage(
      logo,
      pen.mm(TOP_PAD_X_MM),
      pen.mm(TOP_PAD_TOP_MM) + (pen.mm(LOGO_H_MM) - height) / 2,
      width,
      height,
    );
    if (supportsFilter) pen.ctx.filter = 'none';
  }

  pen.ctx.fillStyle = '#000';
  setFont(pen, 8.5, 700);
  writeLines(
    pen,
    [CARRIER_PHONE, ...CARRIER_ADDRESS],
    TOP_PAD_X_MM,
    TOP_PAD_TOP_MM + LOGO_H_MM + 1.6,
    8.5,
    1.25,
  );

  // Waybill number, right aligned against the tracking column.
  pen.ctx.textAlign = 'right';
  pen.ctx.textBaseline = 'top';
  setFont(pen, 14, 900, FONT_MONO);
  const numberWidth = pen.ctx.measureText(label.waybillId).width;
  pen.ctx.fillText(label.waybillId, pen.mm(TRACKING_RIGHT_MM), pen.mm(TOP_PAD_TOP_MM));
  setFont(pen, 8, 800, FONT_SANS, 1.2);
  pen.ctx.fillText(
    'WAYBILL',
    pen.mm(TRACKING_RIGHT_MM - 1.5) - numberWidth,
    pen.mm(TOP_PAD_TOP_MM + lineMm(14, 1) - lineMm(8, 1)),
  );
  pen.ctx.textAlign = 'left';

  const barcodeY = TOP_PAD_TOP_MM + lineMm(14, 1) + 0.8;
  const panelX = TRACKING_RIGHT_MM - BARCODE_PANEL_W_MM;
  drawBarcode(pen, label.barcode, panelX + (BARCODE_PANEL_W_MM - BARCODE_W_MM) / 2, barcodeY);
  drawQr(pen, label.qr, TRACKING_RIGHT_MM - QR_BOX_MM, barcodeY + BARCODE_H_MM + 1.2);

  drawRule(pen, 0, ROW_TOP_MM - INNER_BORDER_MM, CONTENT_W_MM, INNER_BORDER_MM);
}

function drawMerchantCell(pen: Pen, label: WaybillLabelData) {
  const x = CELL_PAD_X_MM;
  const width = COL1_W_MM - CELL_PAD_X_MM * 2;
  let y = Y_DETAILS_MM + CELL_PAD_Y_MM;

  y = drawFieldLabel(pen, 'Name', x, y);
  y = drawFieldValue(pen, label.merchantName, x, y, width, 13, { lineHeight: 1.05, gap: 2 });
  y = drawFieldLabel(pen, 'Telephone', x, y);
  drawFieldValue(pen, label.merchantPhone, x, y, width, 11.5, { gap: 2 });
}

function drawRecipientCell(pen: Pen, label: WaybillLabelData) {
  const x = COL1_W_MM + INNER_BORDER_MM + CELL_PAD_X_MM;
  const width = CONTENT_W_MM - COL1_W_MM - INNER_BORDER_MM - CELL_PAD_X_MM * 2;
  let y = Y_DETAILS_MM + CELL_PAD_Y_MM;

  y = drawFieldLabel(pen, 'Name', x, y);
  y = drawFieldValue(pen, label.recipientName, x, y, width, 12.5);
  y = drawFieldLabel(pen, 'Address', x, y);
  y = drawFieldValue(pen, label.addressLines, x, y, width, 11.5, { lineHeight: 1.22 });

  const columnWidth = (width - 2) / 2;
  const cityStart = y;
  let cityY = drawFieldLabel(pen, 'City', x, cityStart);
  cityY = drawFieldValue(pen, label.city, x, cityY, columnWidth, 11);
  let postalY = drawFieldLabel(pen, 'Postal / Zip', x + columnWidth + 2, cityStart);
  postalY = drawFieldValue(pen, label.postalCode, x + columnWidth + 2, postalY, columnWidth, 11);
  y = Math.max(cityY, postalY);

  y = drawFieldLabel(pen, 'Telephone', x, y);
  drawFieldValue(pen, label.recipientPhone, x, y, width, 12);
}

function drawOrderCell(pen: Pen, label: WaybillLabelData) {
  const x = CELL_PAD_X_MM;
  const width = COL1_W_MM - CELL_PAD_X_MM * 2;
  let y = Y_ORDER_DETAILS_MM + CELL_PAD_Y_MM;

  y = drawFieldLabel(pen, 'Order Number', x, y);
  y = drawFieldValue(pen, label.orderNumber, x, y, width, 10.5);
  y = drawFieldLabel(pen, 'Order Date', x, y);
  y = drawFieldValue(pen, label.orderDate, x, y, width, 10.5);
  y = drawFieldLabel(pen, 'Weight', x, y);
  drawFieldValue(pen, '1 kg', x, y, width, 10.5);
}

function drawDescriptionCell(pen: Pen, label: WaybillLabelData) {
  const x = COL1_W_MM + INNER_BORDER_MM + CELL_PAD_X_MM;
  const width = CONTENT_W_MM - COL1_W_MM - INNER_BORDER_MM - CELL_PAD_X_MM * 2;
  let y = Y_ORDER_DETAILS_MM + CELL_PAD_Y_MM;

  y = drawFieldLabel(pen, 'Description', x, y);
  y = drawFieldValue(pen, label.description || 'Garment order', x, y, width, 10.5);

  if (label.specialNote) {
    y = drawFieldLabel(pen, 'Special Note', x, y);
    setFont(pen, 8.5, 800);
    const noteLines = wrapText(pen, label.specialNote, width - 1.6 - 0.6);
    const noteHeight = noteLines.length * lineMm(8.5) + 1.6;
    pen.ctx.strokeStyle = '#000';
    pen.ctx.lineWidth = Math.max(1, pen.mm(0.3));
    pen.ctx.strokeRect(pen.mm(x), pen.mm(y), pen.mm(width), pen.mm(noteHeight));
    pen.ctx.fillStyle = '#000';
    writeLines(pen, noteLines, x + 0.8, y + 0.8, 8.5);
    y += noteHeight + VALUE_GAP_MM;
  }

  // COD chip: black block with reversed text.
  setFont(pen, 13.5, 900, FONT_SANS, 0.35);
  const chipTextWidth = pen.ctx.measureText(label.codText).width;
  const chipHeight = lineMm(13.5) + 2;
  const chipWidth = chipTextWidth / pen.mm(1) + 2.8;
  pen.ctx.fillStyle = '#000';
  pen.ctx.fillRect(pen.mm(x), pen.mm(y + 0.3), pen.mm(chipWidth), pen.mm(chipHeight));
  pen.ctx.fillStyle = '#fff';
  writeLines(pen, [label.codText], x + 1.4, y + 0.3 + 1, 13.5);
  pen.ctx.fillStyle = '#000';
}

function drawWaybill(pen: Pen, label: WaybillLabelData, logo: HTMLImageElement | null) {
  pen.ctx.textAlign = 'left';
  pen.ctx.textBaseline = 'top';

  withCellClip(pen, 0, 0, CONTENT_W_MM, ROW_TOP_MM, () => drawTopSection(pen, label, logo));

  drawCentredTitle(pen, 'Ship From', 0, COL1_W_MM, Y_TITLE_MM, ROW_TITLE_MM);
  drawCentredTitle(
    pen,
    'Ship To',
    COL1_W_MM,
    CONTENT_W_MM - COL1_W_MM,
    Y_TITLE_MM,
    ROW_TITLE_MM,
  );
  drawRule(pen, COL1_W_MM, Y_TITLE_MM, INNER_BORDER_MM, ROW_TITLE_MM + ROW_DETAILS_MM);
  drawRule(pen, 0, Y_DETAILS_MM - INNER_BORDER_MM, CONTENT_W_MM, INNER_BORDER_MM);

  withCellClip(pen, 0, Y_DETAILS_MM, COL1_W_MM, ROW_DETAILS_MM, () => drawMerchantCell(pen, label));
  withCellClip(
    pen,
    COL1_W_MM + INNER_BORDER_MM,
    Y_DETAILS_MM,
    CONTENT_W_MM - COL1_W_MM - INNER_BORDER_MM,
    ROW_DETAILS_MM,
    () => drawRecipientCell(pen, label),
  );

  drawRule(pen, 0, Y_ORDER_TITLE_MM - INNER_BORDER_MM, CONTENT_W_MM, INNER_BORDER_MM);
  drawCentredTitle(pen, 'Order Details', 0, CONTENT_W_MM, Y_ORDER_TITLE_MM, ROW_TITLE_MM);
  drawRule(pen, 0, Y_ORDER_DETAILS_MM - INNER_BORDER_MM, CONTENT_W_MM, INNER_BORDER_MM);

  const orderRowHeight = Y_FOOTER_MM - Y_ORDER_DETAILS_MM;
  drawRule(pen, COL1_W_MM, Y_ORDER_DETAILS_MM, INNER_BORDER_MM, orderRowHeight);
  withCellClip(pen, 0, Y_ORDER_DETAILS_MM, COL1_W_MM, orderRowHeight, () => drawOrderCell(pen, label));
  withCellClip(
    pen,
    COL1_W_MM + INNER_BORDER_MM,
    Y_ORDER_DETAILS_MM,
    CONTENT_W_MM - COL1_W_MM - INNER_BORDER_MM,
    orderRowHeight,
    () => drawDescriptionCell(pen, label),
  );
  drawRule(pen, 0, Y_FOOTER_MM - INNER_BORDER_MM, CONTENT_W_MM, INNER_BORDER_MM);

  pen.ctx.fillStyle = '#000';
  setFont(pen, 7, 700, FONT_SANS, 0.5);
  pen.ctx.textAlign = 'center';
  pen.ctx.textBaseline = 'middle';
  pen.ctx.fillText(FOOTER_TEXT, pen.mm(CONTENT_W_MM / 2), pen.mm(Y_FOOTER_MM + ROW_FOOTER_MM / 2));
  pen.ctx.textAlign = 'left';
  pen.ctx.textBaseline = 'top';
}

export async function renderWaybillCanvas(
  label: WaybillLabelData,
  dpi: number = DEFAULT_WAYBILL_DPI,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((SHEET_W_MM * dpi) / 25.4);
  canvas.height = Math.round((SHEET_H_MM * dpi) / 25.4);

  const ctx = canvas.getContext('2d') as SpacedContext | null;
  if (!ctx) throw new Error('This browser cannot render waybill images.');

  const pen: Pen = {
    ctx,
    mm: (value) => (value * dpi) / 25.4,
    cssPx: (value) => (value * dpi) / 96,
  };

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, pen.mm(OUTER_BORDER_MM));
  ctx.strokeRect(
    ctx.lineWidth / 2,
    ctx.lineWidth / 2,
    canvas.width - ctx.lineWidth,
    canvas.height - ctx.lineWidth,
  );

  const logo = await loadLogo();

  ctx.save();
  ctx.translate(pen.mm(OUTER_BORDER_MM), pen.mm(OUTER_BORDER_MM));
  drawWaybill(pen, label, logo);
  ctx.restore();

  return canvas;
}

export async function renderWaybillPng(
  label: WaybillLabelData,
  dpi: number = DEFAULT_WAYBILL_DPI,
): Promise<Blob> {
  const canvas = await renderWaybillCanvas(label, dpi);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not build the waybill image.'));
    }, 'image/png');
  });
}

export function waybillFileName(label: WaybillLabelData) {
  const safeId = label.waybillId.replace(/[^A-Za-z0-9_-]/g, '') || String(label.shipmentId);
  return `waybill-${safeId}.png`;
}
