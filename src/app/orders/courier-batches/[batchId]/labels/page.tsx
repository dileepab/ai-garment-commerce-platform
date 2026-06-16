import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { canAccessBrand } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { buildCode128BarcodeSvg } from '@/lib/barcode';
import { getBrandLookupAliases } from '@/lib/brand-aliases';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

function formatMoney(value?: number | null) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, numeric).toLocaleString('en-LK');
}

function orderDescription(
  orderItems: Array<{
    quantity: number;
    size: string | null;
    color: string | null;
    product: { name: string | null; style: string | null } | null;
  }>,
) {
  return orderItems
    .map((item) => {
      const product = item.product?.name || item.product?.style || 'Garment';
      const variant = [item.size, item.color].filter(Boolean).join(' ');
      return `${product}${variant ? ` (${variant})` : ''} x${item.quantity}`;
    })
    .join(', ');
}

function formatRoyalExpressDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    pad(value.getDate()),
    '/',
    pad(value.getMonth() + 1),
    '/',
    value.getFullYear(),
    ' ',
    pad(value.getHours()),
    ':',
    pad(value.getMinutes()),
    ':',
    pad(value.getSeconds()),
  ].join('');
}

function dedupeAddressLines(parts: Array<string | null | undefined>) {
  const selected: string[] = [];

  for (const part of parts) {
    const cleaned = part?.trim();
    if (!cleaned) continue;

    const normalized = cleaned.toLowerCase().replace(/\s+/g, ' ');
    const alreadyIncluded = selected.some((existing) => {
      const existingNormalized = existing.toLowerCase().replace(/\s+/g, ' ');
      return existingNormalized.includes(normalized) || normalized.includes(existingNormalized);
    });

    if (!alreadyIncluded) selected.push(cleaned);
  }

  return selected.length > 0 ? selected : ['No address provided'];
}

function buildRoyalExpressQrCells(value: string) {
  const cleaned = value.trim() || '0';
  const size = 13;
  let seed = 0;

  for (let index = 0; index < cleaned.length; index += 1) {
    seed = (seed * 31 + cleaned.charCodeAt(index)) >>> 0;
  }

  const finderCells = new Set<string>();
  const addFinder = (startRow: number, startCol: number) => {
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const border = row === 0 || row === 4 || col === 0 || col === 4;
        const center = row === 2 && col === 2;
        if (border || center) finderCells.add(`${startRow + row}:${startCol + col}`);
      }
    }
  };

  addFinder(0, 0);
  addFinder(0, size - 5);
  addFinder(size - 5, 0);

  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return finderCells.has(`${row}:${col}`) || ((seed + row * 17 + col * 29) % 7 < 3);
  });
}

export default async function RoyalExpressBatchLabelsPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const scope = await requirePagePermission('orders:view');
  const { batchId } = await params;
  const id = Number.parseInt(batchId, 10);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const batch = await prisma.courierBatch.findUnique({
    where: { id },
    include: {
      shipments: {
        include: {
          order: {
            include: {
              customer: true,
              orderItems: { include: { product: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!batch || batch.provider !== 'royalexpress') notFound();
  if (batch.brand && !canAccessBrand(scope, batch.brand)) notFound();

  const batchBrand =
    batch.brand ||
    batch.shipments.find((shipment) => shipment.brand || shipment.order.brand)?.brand ||
    batch.shipments.find((shipment) => shipment.order.brand)?.order.brand ||
    null;
  const courierSetting = batchBrand
    ? await prisma.courierIntegrationSetting.findFirst({
        where: {
          provider: 'royalexpress',
          brand: { in: getBrandLookupAliases(batchBrand) },
        },
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        select: {
          senderName: true,
          senderPhone: true,
        },
      })
    : null;

  return (
    <main className="batch-label-page">
      <div className="screen-toolbar">
        <div>
          <strong>RoyalExpress batch #{batch.id}</strong>
          <span>{batch.shipments.length} waybill(s)</span>
        </div>
        <div className="toolbar-actions">
          <Link className="toolbar-link" href="/orders/courier-batches">Back</Link>
          <PrintButton label="Print waybills" />
        </div>
      </div>

      <section className="label-grid">
        {batch.shipments.map((shipment) => {
          const order = shipment.order;
          const addressLines = dedupeAddressLines([
            shipment.receiverStreet,
            order.deliveryStreetAddress,
            order.deliveryAddress,
            order.deliveryCity,
            order.deliveryDistrict,
          ]);
          const phone = shipment.receiverPhone || order.customer.phone || 'No phone';
          const description = shipment.description || orderDescription(order.orderItems);
          const barcode = buildCode128BarcodeSvg(shipment.waybillId);
          const qrCells = buildRoyalExpressQrCells(shipment.waybillId);
          const merchantName = courierSetting?.senderName || shipment.brand || order.brand || batchBrand || 'DEEZ';
          const merchantPhone = courierSetting?.senderPhone || '-';
          const orderNumber = (shipment.orderReference || String(order.id)).replace(/^ORD-/i, '');
          const city = order.deliveryCity || order.deliveryDistrict || shipment.receiverCityId || '-';
          const postalCode = shipment.receiverCityId || '-';

          return (
            <article className="waybill-sheet" key={shipment.id}>
              <div className="waybill-top">
                <div className="carrier">
                  <div className="royal-logo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/royal-express-logo.png" alt="Royal Express" />
                  </div>
                  <div className="carrier-name">Royal Express<br />Courier &amp; Logistics<br />(Pvt) Ltd</div>
                  <div className="carrier-contact">
                    0112417417<br />
                    No 69 Subhadrarama Road,<br />
                    Kattiya Junction,<br />
                    Nugegoda
                  </div>
                </div>
                <div className="tracking">
                  <div className="waybill-id">Waybill ID : {shipment.waybillId}</div>
                  <div className="barcode-panel">
                    <div className="barcode" dangerouslySetInnerHTML={{ __html: barcode }} />
                    <div className="barcode-text">{shipment.waybillId}</div>
                  </div>
                  <div className="qr-code" aria-label={`Waybill QR ${shipment.waybillId}`}>
                    {qrCells.map((filled, index) => (
                      <span key={index} className={filled ? 'qr-cell qr-cell-on' : 'qr-cell'} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="two-col">
                <div className="section-title">Merchant Details</div>
                <div className="section-title">Customer Details</div>
              </div>
              <div className="two-col details-row">
                <div className="cell merchant-details">
                  <span className="field-label">Name</span>
                  <span className="field-value">{merchantName}</span>
                  <span className="field-label">Telephone</span>
                  <span className="field-value">{merchantPhone}</span>
                </div>
                <div className="cell">
                  <span className="field-label">Name</span>
                  <span className="field-value">{shipment.receiverName || order.customer.name}</span>
                  <span className="field-label">Address</span>
                  <span className="field-value">{addressLines.map((line) => <span key={line}>{line}<br /></span>)}</span>
                  <span className="field-label">Telephone</span>
                  <span className="field-value">{phone}</span>
                </div>
              </div>
              <div className="section-title order-title">Order Details</div>
              <div className="two-col order-details">
                <div className="cell">
                  <span className="field-label">Order Number</span>
                  <span className="field-value">{orderNumber}</span>
                  <span className="field-label">Order Date</span>
                  <span className="field-value">{formatRoyalExpressDateTime(order.createdAt)}</span>
                  <span className="field-label">Postal / Zip Code</span>
                  <span className="field-value">{postalCode}</span>
                  <span className="field-label">Weight</span>
                  <span className="field-value">1</span>
                </div>
                <div className="cell">
                  <span className="field-label">Description</span>
                  <span className="field-value">{description || 'Garment order'}</span>
                  <br />
                  <span className="field-label">City</span>
                  <span className="field-value">{city}</span>
                  <span className="field-label">Total COD</span>
                  <span className="field-value">{formatMoney(shipment.codAmount)}</span>
                </div>
              </div>
              <div className="footer">Powered By Curfox.com</div>
            </article>
          );
        })}
      </section>

      <style>{`
        @page { size: A4 portrait; margin: 6mm; }
        * { box-sizing: border-box; }
        body { background: #fff; }
        .batch-label-page { color: #000; font-family: Arial, Helvetica, sans-serif; padding: 16px; }
        .screen-toolbar {
          align-items: center;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          margin-bottom: 16px;
          padding: 10px 12px;
        }
        .screen-toolbar span { color: #6b7280; font-size: 12px; margin-left: 8px; }
        .toolbar-actions {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        .screen-toolbar a, .screen-toolbar button {
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          color: #111827;
          cursor: pointer;
          font-size: 12px;
          padding: 7px 10px;
          text-decoration: none;
        }
        .label-grid {
          display: grid;
          gap: 10mm;
          justify-content: center;
          margin: 0 auto;
        }
        .waybill-sheet {
          background: #fff;
          border: 1.4px solid #000;
          display: grid;
          grid-template-rows: auto auto auto auto auto 7mm;
          min-height: 188mm;
          overflow: hidden;
          page-break-inside: avoid;
          width: 128mm;
        }
        .waybill-top {
          border-bottom: 1.2px solid #000;
          display: grid;
          grid-template-columns: 43% 57%;
          min-height: 71mm;
          padding: 3mm 3mm 2mm;
        }
        .carrier { align-content: start; display: grid; gap: 3mm; min-width: 0; }
        .royal-logo {
          align-items: center;
          display: flex;
          height: 21mm;
          width: 38mm;
        }
        .royal-logo img {
          display: block;
          height: auto;
          max-height: 21mm;
          object-fit: contain;
          object-position: left center;
          width: 38mm;
        }
        .carrier-name { font-size: 17px; font-weight: 900; line-height: 1.12; }
        .carrier-contact { font-size: 12px; font-weight: 800; line-height: 1.38; }
        .tracking {
          align-content: start;
          display: grid;
          gap: 3mm;
          justify-items: end;
          min-width: 0;
        }
        .waybill-id { font-size: 15px; font-weight: 900; line-height: 1; text-align: right; }
        .barcode-panel { display: grid; justify-items: center; width: 70mm; }
        .barcode { height: 10mm; width: 69mm; }
        .barcode-svg { display: block; fill: #000; height: 100%; width: 100%; }
        .barcode-text {
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 1.6px;
          margin-top: 0.6mm;
        }
        .qr-code {
          background: #fff;
          display: grid;
          grid-template-columns: repeat(13, 1fr);
          grid-template-rows: repeat(13, 1fr);
          height: 24mm;
          margin-top: 8mm;
          width: 24mm;
        }
        .qr-cell { background: #fff; }
        .qr-cell-on { background: #000; }
        .section-title {
          align-items: center;
          border-bottom: 1.2px solid #000;
          display: flex;
          font-size: 13px;
          font-weight: 900;
          justify-content: center;
          line-height: 1;
          min-height: 9mm;
        }
        .two-col {
          border-bottom: 1.2px solid #000;
          display: grid;
          grid-template-columns: 37% 63%;
        }
        .two-col > div:first-child { border-right: 1.2px solid #000; }
        .details-row .cell { min-height: 38mm; }
        .order-title { border-bottom: 1.2px solid #000; }
        .order-details { min-height: 55mm; }
        .cell {
          font-size: 13px;
          font-weight: 900;
          line-height: 1.32;
          min-width: 0;
          overflow-wrap: anywhere;
          padding: 2mm;
        }
        .field-label,
        .field-value {
          display: block;
          font-weight: 900;
        }
        .field-value { margin-bottom: 1mm; }
        .merchant-details .field-value { margin-bottom: 2mm; }
        .footer {
          align-items: center;
          display: flex;
          font-size: 12px;
          font-weight: 900;
          justify-content: center;
          line-height: 1;
        }
        @media screen and (max-width: 760px) {
          .screen-toolbar { align-items: stretch; flex-direction: column; }
          .toolbar-actions { justify-content: flex-start; }
          .waybill-sheet { max-width: 100%; width: 128mm; }
        }
        @media print {
          .mobile-menu-btn,
          .sidebar-overlay,
          .sidebar-nav,
          .sidebar-close-btn {
            display: none !important;
            visibility: hidden !important;
          }
          .screen-toolbar { display: none; }
          body { margin: 0; }
          .batch-label-page { padding: 0; }
          .label-grid {
            display: block;
            max-width: none;
          }
          .waybill-sheet {
            break-inside: avoid;
            min-height: 188mm;
            page-break-after: always;
            page-break-inside: avoid;
            width: 128mm;
          }
          .waybill-sheet:last-child {
            page-break-after: auto;
          }
          .label-grid {
            align-items: start;
            justify-items: center;
          }
        }
      `}</style>
    </main>
  );
}
