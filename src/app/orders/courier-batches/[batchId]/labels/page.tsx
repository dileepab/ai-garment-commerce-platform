import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { canAccessBrand } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { buildCode128BarcodeSvg } from '@/lib/barcode';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

type LabelLayout = 'thermal' | 'a4';

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

export default async function RoyalExpressBatchLabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams?: Promise<{ layout?: string }>;
}) {
  const scope = await requirePagePermission('orders:view');
  const { batchId } = await params;
  const query = searchParams ? await searchParams : {};
  const layout: LabelLayout = query.layout === 'a4' ? 'a4' : 'thermal';
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

  return (
    <main className={`batch-label-page layout-${layout}`}>
      <div className="screen-toolbar">
        <div>
          <strong>RoyalExpress batch #{batch.id}</strong>
          <span>{batch.shipments.length} label(s)</span>
        </div>
        <div className="toolbar-actions">
          <Link className="toolbar-link" href="/orders/courier-batches">Back</Link>
          <div className="layout-switch" aria-label="Print layout">
            <Link className={layout === 'thermal' ? 'active' : ''} href={`/orders/courier-batches/${batch.id}/labels?layout=thermal`}>
              Thermal 4x6
            </Link>
            <Link className={layout === 'a4' ? 'active' : ''} href={`/orders/courier-batches/${batch.id}/labels?layout=a4`}>
              A4 4-up
            </Link>
          </div>
          <PrintButton label={layout === 'a4' ? 'Print A4' : 'Print thermal'} />
        </div>
      </div>

      <section className="label-grid">
        {batch.shipments.map((shipment) => {
          const order = shipment.order;
          const address = shipment.receiverStreet || order.deliveryAddress || 'No address';
          const phone = shipment.receiverPhone || order.customer.phone || 'No phone';
          const description = shipment.description || orderDescription(order.orderItems);
          const barcode = buildCode128BarcodeSvg(shipment.waybillId);

          return (
            <article className="label-card" key={shipment.id}>
              <div className="label-head">
                <div className="courier-block">
                  <div className="courier">RoyalExpress</div>
                  <div className="brand">{shipment.brand || order.brand || 'DEEZ'}</div>
                </div>
                <div className="order-box">
                  <span>ORDER</span>
                  <strong>ORD-{order.id}</strong>
                </div>
              </div>

              <div className="waybill-band">
                <div className="barcode" dangerouslySetInnerHTML={{ __html: barcode }} />
                <div className="waybill">{shipment.waybillId}</div>
              </div>

              <div className="info-grid">
                <div className="receiver-panel">
                  <div className="label">Receiver</div>
                  <div className="receiver-name">{shipment.receiverName || order.customer.name}</div>
                  <div className="receiver-phone">{phone}</div>
                  <div className="receiver-address">{address}</div>
                </div>
                <div className="cod-panel">
                  <div className="label">COD</div>
                  <div className="cod">Rs {formatMoney(shipment.codAmount)}</div>
                  <div className="batch-chip">Batch #{batch.id}</div>
                </div>
              </div>

              <div className="description">
                <div className="label">Items</div>
                <div>{description || 'Garment order'}</div>
              </div>
            </article>
          );
        })}
      </section>

      <style>{`
        ${layout === 'a4' ? '@page { size: A4 portrait; margin: 8mm; }' : '@page { size: 100mm 150mm; margin: 0; }'}
        * { box-sizing: border-box; }
        body { background: #fff; }
        .batch-label-page { color: #111827; font-family: Arial, sans-serif; padding: 16px; }
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
        .layout-switch {
          align-items: center;
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 7px;
          display: inline-flex;
          gap: 2px;
          padding: 2px;
        }
        .layout-switch a {
          border: 0;
          border-radius: 5px;
          color: #4b5563;
          padding: 6px 9px;
        }
        .layout-switch a.active {
          background: #111827;
          color: #fff;
        }
        .label-grid {
          display: grid;
          gap: 6mm;
          justify-content: center;
          margin: 0 auto;
        }
        .label-card {
          background: #fff;
          border: 1.3px solid #111827;
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          overflow: hidden;
          padding: 5mm;
          page-break-inside: avoid;
        }
        .label-head, .info-grid {
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr auto;
        }
        .label-head {
          align-items: start;
          border-bottom: 1px solid #111827;
          padding-bottom: 3mm;
        }
        .courier { font-size: 18px; font-weight: 900; letter-spacing: 0; line-height: 1; }
        .brand, .label, .order-box span {
          color: #4b5563;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .order-box {
          border: 1px solid #111827;
          min-width: 26mm;
          padding: 2mm;
          text-align: center;
        }
        .order-box strong { display: block; font-size: 13px; line-height: 1.1; }
        .waybill-band {
          border-bottom: 1px solid #111827;
          margin-bottom: 3mm;
          padding: 3mm 0;
        }
        .barcode { height: 17mm; }
        .barcode-svg { display: block; height: 100%; width: 100%; }
        .waybill {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0;
          padding-top: 1.5mm;
          text-align: center;
        }
        .info-grid { align-items: stretch; grid-template-columns: 1fr 33mm; }
        .receiver-panel, .cod-panel {
          border: 1px solid #d1d5db;
          min-width: 0;
          padding: 3mm;
        }
        .receiver-name {
          font-size: 16px;
          font-weight: 900;
          line-height: 1.05;
          overflow-wrap: anywhere;
          text-transform: uppercase;
        }
        .receiver-phone { font-size: 14px; font-weight: 800; margin-top: 1.5mm; }
        .receiver-address {
          font-size: 12px;
          line-height: 1.25;
          margin-top: 1.5mm;
          overflow-wrap: anywhere;
        }
        .cod-panel { display: grid; align-content: center; text-align: center; }
        .cod { font-size: 18px; font-weight: 900; line-height: 1.05; }
        .batch-chip {
          border-top: 1px solid #d1d5db;
          font-size: 10px;
          font-weight: 800;
          margin-top: 3mm;
          padding-top: 2mm;
        }
        .description {
          border-top: 1px solid #d1d5db;
          font-size: 11px;
          line-height: 1.25;
          margin-top: 3mm;
          overflow-wrap: anywhere;
          padding-top: 2.5mm;
        }
        .layout-thermal .label-grid {
          grid-template-columns: 100mm;
          max-width: 100mm;
        }
        .layout-thermal .label-card {
          min-height: 148mm;
          width: 100mm;
        }
        .layout-a4 .label-grid {
          gap: 5mm;
          grid-template-columns: repeat(2, 1fr);
          max-width: 194mm;
        }
        .layout-a4 .label-card {
          min-height: 135mm;
        }
        .layout-a4 .courier { font-size: 16px; }
        .layout-a4 .receiver-name { font-size: 14px; }
        .layout-a4 .receiver-phone { font-size: 12px; }
        .layout-a4 .receiver-address { font-size: 11px; }
        .layout-a4 .cod { font-size: 16px; }
        .layout-a4 .info-grid { grid-template-columns: 1fr 28mm; }
        .layout-a4 .barcode { height: 15mm; }
        @media screen and (max-width: 760px) {
          .screen-toolbar { align-items: stretch; flex-direction: column; }
          .toolbar-actions { justify-content: flex-start; }
          .layout-a4 .label-grid { grid-template-columns: 1fr; max-width: 100mm; }
          .layout-a4 .label-card { min-height: 135mm; }
        }
        @media print {
          .screen-toolbar { display: none; }
          body { margin: 0; }
          .batch-label-page { padding: 0; }
          .layout-thermal .label-grid {
            display: block;
            max-width: none;
          }
          .layout-thermal .label-card {
            border: 0;
            height: 150mm;
            min-height: 150mm;
            padding: 5mm;
            width: 100mm;
            page-break-after: always;
          }
          .layout-thermal .label-card:last-child { page-break-after: auto; }
          .layout-a4 .label-grid {
            display: grid;
            gap: 5mm;
            grid-template-columns: repeat(2, 1fr);
            max-width: none;
          }
          .layout-a4 .label-card {
            min-height: 135mm;
          }
          .layout-a4 .label-card {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </main>
  );
}
