'use client';

import type { WaybillLabelData } from '@/lib/waybill-label';
import { DEFAULT_WAYBILL_DPI, renderWaybillCanvas } from './waybill-image';

/**
 * Builds a multi-page PDF where every page is one 4in x 6in waybill, so the
 * MarkLife app can open a whole batch as a single file.
 *
 * Pages carry a lossless grayscale bitmap (Flate) so barcodes stay crisp; JPEG
 * is only used when the browser has no CompressionStream.
 */

const PAGE_W_PT = 288; // 4in at 72pt/in
const PAGE_H_PT = 432; // 6in at 72pt/in

export type WaybillPdfPage = {
  width: number;
  height: number;
  bytes: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
  colorSpace: 'DeviceGray' | 'DeviceRGB';
};

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;

  try {
    // CompressionStream('deflate') emits zlib-wrapped data, which is exactly
    // what the PDF /FlateDecode filter expects.
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function toGrayscale(image: ImageData): Uint8Array {
  const { data, width, height } = image;
  const gray = new Uint8Array(width * height);

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    // Rec. 601 luma, integer weights.
    gray[index] = (data[offset] * 77 + data[offset + 1] * 150 + data[offset + 2] * 29) >> 8;
  }

  return gray;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not encode the waybill page.'));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      'image/jpeg',
      0.95,
    );
  });
}

export async function buildWaybillPdfPage(
  label: WaybillLabelData,
  dpi: number = DEFAULT_WAYBILL_DPI,
): Promise<WaybillPdfPage> {
  const canvas = await renderWaybillCanvas(label, dpi);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot render waybill pages.');

  const gray = toGrayscale(ctx.getImageData(0, 0, canvas.width, canvas.height));
  const compressed = await deflate(gray);

  if (compressed) {
    return {
      width: canvas.width,
      height: canvas.height,
      bytes: compressed,
      filter: 'FlateDecode',
      colorSpace: 'DeviceGray',
    };
  }

  return {
    width: canvas.width,
    height: canvas.height,
    bytes: await canvasToJpeg(canvas),
    filter: 'DCTDecode',
    colorSpace: 'DeviceRGB',
  };
}

export function assembleWaybillPdf(pages: WaybillPdfPage[]): Blob {
  if (pages.length === 0) throw new Error('No waybills selected.');

  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    chunks.push(bytes as BlobPart);
    cursor += bytes.length;
  };

  const addObject = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = cursor;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  const pageId = (index: number) => 3 + index * 3;
  const contentId = (index: number) => 4 + index * 3;
  const imageId = (index: number) => 5 + index * 3;
  const objectCount = 2 + pages.length * 3;

  // Binary comment marks the file as containing 8-bit data.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(' ');
  addObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

  pages.forEach((page, index) => {
    addObject(
      pageId(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${PAGE_H_PT}] ` +
        `/Resources << /XObject << /Im0 ${imageId(index)} 0 R >> >> ` +
        `/Contents ${contentId(index)} 0 R >>`,
    );

    // Scale the unit image square to fill the whole page.
    const content = encoder.encode(`q ${PAGE_W_PT} 0 0 ${PAGE_H_PT} 0 0 cm /Im0 Do Q`);
    addObject(contentId(index), `<< /Length ${content.length} >>`, content);

    addObject(
      imageId(index),
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /${page.colorSpace} /BitsPerComponent 8 /Filter /${page.filter} ` +
        `/Length ${page.bytes.length} >>`,
      page.bytes,
    );
  });

  const xrefOffset = cursor;
  push(`xref\n0 ${objectCount + 1}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id <= objectCount; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

export function waybillPdfName(labels: WaybillLabelData[], batchId: number) {
  if (labels.length === 1) {
    const safeId = labels[0].waybillId.replace(/[^A-Za-z0-9_-]/g, '') || String(labels[0].shipmentId);
    return `waybill-${safeId}.pdf`;
  }

  return `waybills-batch-${batchId}.pdf`;
}
