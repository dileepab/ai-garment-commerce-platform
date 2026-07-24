import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { canAccessBrand } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { buildCode128BarcodeSvg } from '@/lib/barcode';
import { getBrandLookupAliases } from '@/lib/brand-aliases';
import {
  buildRoyalExpressLabelAddressLines,
  buildRoyalExpressQrMatrix,
  formatRoyalExpressLabelPhone,
  resolveRoyalExpressLabelLocation,
} from '@/lib/royal-express-label';
import { getMerchantSettings } from '@/lib/runtime-config';
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
  const brandSettings = batchBrand ? await getMerchantSettings(batchBrand) : null;

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
          const { city, postalCode } = resolveRoyalExpressLabelLocation({
            receiverCityId: shipment.receiverCityId,
            deliveryCity: order.deliveryCity,
            deliveryDistrict: order.deliveryDistrict,
            addressParts: [shipment.receiverStreet, order.deliveryStreetAddress, order.deliveryAddress],
          });
          const addressLines = buildRoyalExpressLabelAddressLines([
            shipment.receiverStreet,
            order.deliveryStreetAddress,
            order.deliveryAddress,
          ], [city, order.deliveryCity, order.deliveryDistrict]);
          const phone = formatRoyalExpressLabelPhone(
            shipment.receiverPhone || order.customer.phone || 'No phone',
          );
          const description = shipment.description || orderDescription(order.orderItems);
          const barcode = buildCode128BarcodeSvg(shipment.waybillId);
          const qr = buildRoyalExpressQrMatrix(shipment.waybillId);
          const merchantName = courierSetting?.senderName || shipment.brand || order.brand || batchBrand || 'DEEZ';
          const merchantPhone = formatRoyalExpressLabelPhone(
            brandSettings?.support.whatsapp ||
            brandSettings?.support.phone ||
            courierSetting?.senderPhone ||
            '-',
          );
          const orderNumber = (shipment.orderReference || String(order.id)).replace(/^ORD-/i, '');
          const codAmount = shipment.codAmount ?? order.totalAmount;
          const specialNote = shipment.specialNote?.trim();
          const showSpecialNote = Boolean(specialNote && !/^DEEZ\s+.+\s+order\s+#\d+$/i.test(specialNote));

          return (
            <article className="waybill-sheet" key={shipment.id}>
              <div className="waybill-top">
                <div className="carrier">
                  <div className="royal-logo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/royal-express-logo.png" alt="Royal Express" />
                  </div>
                  <div className="carrier-contact">
                    <strong>0112 417 417</strong><br />
                    No. 69, Subhadrarama Rd,<br />
                    Nugegoda
                  </div>
                </div>
                <div className="tracking">
                  <div className="waybill-heading">
                    <span>WAYBILL</span>
                    <strong>{shipment.waybillId}</strong>
                  </div>
                  <div className="barcode-panel">
                    <div className="barcode" dangerouslySetInnerHTML={{ __html: barcode }} />
                  </div>
                  <div
                    className="qr-code"
                    aria-label={`Waybill QR ${shipment.waybillId}`}
                    style={{
                      gridTemplateColumns: `repeat(${qr.size}, 1fr)`,
                      gridTemplateRows: `repeat(${qr.size}, 1fr)`,
                    }}
                  >
                    {qr.cells.map((filled, index) => (
                      <span key={index} className={filled ? 'qr-cell qr-cell-on' : 'qr-cell'} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="two-col">
                <div className="section-title">Ship From</div>
                <div className="section-title">Ship To</div>
              </div>
              <div className="two-col details-row">
                <div className="cell merchant-details">
                  <span className="field-label">Name</span>
                  <span className="field-value merchant-name">{merchantName}</span>
                  <span className="field-label">Telephone</span>
                  <span className="field-value merchant-phone">{merchantPhone}</span>
                </div>
                <div className="cell">
                  <span className="field-label">Name</span>
                  <span className="field-value recipient-name">{shipment.receiverName || order.customer.name}</span>
                  <span className="field-label">Address</span>
                  <span className="field-value recipient-address">{addressLines.map((line) => <span key={line}>{line}<br /></span>)}</span>
                  <div className="location-row">
                    <span>
                      <span className="field-label">City</span>
                      <span className="field-value">{city}</span>
                    </span>
                    <span>
                      <span className="field-label">Postal / Zip</span>
                      <span className="field-value">{postalCode}</span>
                    </span>
                  </div>
                  <span className="field-label">Telephone</span>
                  <span className="field-value recipient-phone">{phone}</span>
                </div>
              </div>
              <div className="section-title order-title">Order Details</div>
              <div className="two-col order-details">
                <div className="cell">
                  <span className="field-label">Order Number</span>
                  <span className="field-value">{orderNumber}</span>
                  <span className="field-label">Order Date</span>
                  <span className="field-value">{formatRoyalExpressDateTime(order.createdAt)}</span>
                  <span className="field-label">Weight</span>
                  <span className="field-value">1 kg</span>
                </div>
                <div className="cell">
                  <span className="field-label">Description</span>
                  <span className="field-value">{description || 'Garment order'}</span>
                  {showSpecialNote && (
                    <>
                      <span className="field-label">Special Note</span>
                      <span className="field-value special-note">{specialNote}</span>
                    </>
                  )}
                  <span className="field-value cod-value">COD: LKR {formatMoney(codAmount)}</span>
                </div>
              </div>
              <div className="footer">Powered By Curfox.com</div>
            </article>
          );
        })}
      </section>

      <style>{`
        @page { size: 4in 6in; margin: 0; }
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
          gap: 8mm;
          justify-content: center;
          margin: 0 auto;
        }
        .waybill-sheet {
          background: #fff;
          border: 0.35mm solid #000;
          display: grid;
          grid-template-rows: 39mm 7mm 44mm 7mm 1fr 5mm;
          height: 152.4mm;
          overflow: hidden;
          page-break-inside: avoid;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          width: 101.6mm;
        }
        .waybill-top {
          border-bottom: 0.2mm solid #000;
          display: grid;
          grid-template-columns: 40% 60%;
          padding: 2.4mm 2.8mm 1.8mm;
        }
        .carrier { align-content: start; display: grid; gap: 1.6mm; min-width: 0; }
        .royal-logo {
          align-items: center;
          display: flex;
          height: 18mm;
          width: 35mm;
        }
        .royal-logo img {
          display: block;
          filter: grayscale(1) contrast(1.15);
          height: auto;
          max-height: 18mm;
          object-fit: contain;
          object-position: left center;
          width: 35mm;
        }
        .carrier-contact { font-size: 8.5px; font-weight: 700; line-height: 1.25; }
        .tracking {
          align-content: start;
          display: grid;
          gap: 0.8mm;
          justify-items: end;
          min-width: 0;
        }
        .waybill-heading {
          align-items: baseline;
          display: flex;
          gap: 1.5mm;
          justify-content: flex-end;
          line-height: 1;
          white-space: nowrap;
        }
        .waybill-heading span {
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1.2px;
        }
        .waybill-heading strong {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 14px;
          font-weight: 900;
        }
        .barcode-panel { display: grid; justify-items: center; width: 56mm; }
        .barcode { height: 9mm; width: 55mm; }
        .barcode-svg { display: block; fill: #000; height: 100%; width: 100%; }
        .qr-code {
          align-self: end;
          background: #fff;
          display: grid;
          height: 15mm;
          margin-top: 0.4mm;
          padding: 1mm;
          width: 15mm;
        }
        .qr-cell { background: #fff; }
        .qr-cell-on { background: #000; }
        .section-title {
          align-items: center;
          background: #fff;
          border-bottom: 0.2mm solid #000;
          color: #000;
          display: flex;
          font-size: 9.5px;
          font-weight: 900;
          justify-content: center;
          letter-spacing: 0.8px;
          line-height: 1;
          min-height: 7mm;
          text-transform: uppercase;
        }
        .two-col {
          border-bottom: 0.2mm solid #000;
          display: grid;
          gap: 0;
          grid-template-columns: 34% 66%;
          margin: 0;
        }
        .two-col > div:first-child { border-right: 0.2mm solid #000; }
        .details-row .cell { min-height: 44mm; }
        .order-title { border-bottom: 0.2mm solid #000; margin: 0; }
        .order-details { min-height: 0; }
        .cell {
          font-size: 9px;
          font-weight: 700;
          line-height: 1.18;
          min-width: 0;
          overflow-wrap: anywhere;
          padding: 2.4mm 2.6mm;
        }
        .field-label,
        .field-value {
          display: block;
          font-weight: 800;
        }
        .field-label {
          color: #222;
          font-size: 7.5px;
          letter-spacing: 0.45px;
          text-transform: uppercase;
        }
        .field-value { font-size: 10.5px; margin-bottom: 1.1mm; }
        .details-row > .cell:last-child .field-value { font-size: 11px; }
        .merchant-details .field-value { margin-bottom: 2mm; }
        .merchant-name { font-size: 13px; line-height: 1.05; }
        .merchant-phone { font-size: 11.5px; }
        .recipient-name { font-size: 12.5px !important; }
        .recipient-address { font-size: 11.5px !important; line-height: 1.22; }
        .recipient-phone { font-size: 12px !important; }
        .location-row { display: grid; gap: 2mm; grid-template-columns: 1fr 1fr; }
        .special-note {
          border: 0.3mm solid #000;
          font-size: 8.5px;
          padding: 0.8mm;
        }
        .cod-value {
          background: #000;
          color: #fff;
          display: inline-block;
          font-size: 13.5px;
          font-weight: 900;
          letter-spacing: 0.35px;
          margin-top: 0.3mm;
          padding: 1mm 1.4mm;
          white-space: nowrap;
        }
        .footer {
          align-items: center;
          display: flex;
          font-size: 7px;
          font-weight: 700;
          justify-content: center;
          letter-spacing: 0.5px;
          line-height: 1;
          text-transform: uppercase;
        }
        @media screen and (max-width: 760px) {
          .screen-toolbar { align-items: stretch; flex-direction: column; }
          .toolbar-actions { justify-content: flex-start; }
          .waybill-sheet { max-width: 100%; width: 101.6mm; }
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
            margin: 0 auto;
            height: 152.4mm;
            page-break-after: always;
            page-break-inside: avoid;
            width: 101.6mm;
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
