import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { canAccessBrand } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { buildCode128BarcodeSvg } from '@/lib/barcode';
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

  return (
    <main className="batch-label-page">
      <div className="screen-toolbar">
        <div>
          <strong>RoyalExpress batch #{batch.id}</strong>
          <span>{batch.shipments.length} label(s)</span>
        </div>
        <div>
          <Link href="/orders/courier-batches">Back</Link>
          <PrintButton />
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
                <div>
                  <div className="courier">RoyalExpress</div>
                  <div className="brand">{shipment.brand || order.brand || 'DEEZ'}</div>
                </div>
                <div className="order-ref">ORD-{order.id}</div>
              </div>

              <div className="barcode" dangerouslySetInnerHTML={{ __html: barcode }} />
              <div className="waybill">{shipment.waybillId}</div>

              <div className="two-col">
                <div>
                  <div className="label">Receiver</div>
                  <div className="strong">{shipment.receiverName || order.customer.name}</div>
                  <div>{phone}</div>
                  <div>{address}</div>
                </div>
                <div>
                  <div className="label">COD</div>
                  <div className="cod">Rs {formatMoney(shipment.codAmount)}</div>
                  <div className="label">Batch</div>
                  <div>#{batch.id}</div>
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
        @page { size: A4 landscape; margin: 6mm; }
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
        .screen-toolbar a, .screen-toolbar button {
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          color: #111827;
          cursor: pointer;
          font-size: 12px;
          margin-left: 8px;
          padding: 7px 10px;
          text-decoration: none;
        }
        .label-grid {
          display: grid;
          gap: 5mm;
          grid-template-columns: repeat(2, 1fr);
        }
        .label-card {
          border: 1.5px solid #111827;
          min-height: 132mm;
          padding: 6mm;
          page-break-inside: avoid;
        }
        .label-head, .two-col {
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr auto;
        }
        .courier { font-size: 22px; font-weight: 800; letter-spacing: 0; }
        .brand, .label { color: #4b5563; font-size: 11px; text-transform: uppercase; }
        .order-ref { font-size: 18px; font-weight: 800; text-align: right; }
        .barcode { height: 22mm; margin-top: 5mm; }
        .barcode-svg { display: block; height: 100%; width: 100%; }
        .waybill {
          border-bottom: 1px solid #111827;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0;
          margin-bottom: 5mm;
          padding: 2mm 0;
          text-align: center;
        }
        .two-col { align-items: start; font-size: 14px; line-height: 1.35; }
        .strong, .cod { font-size: 17px; font-weight: 800; }
        .description {
          border-top: 1px solid #d1d5db;
          font-size: 13px;
          line-height: 1.35;
          margin-top: 5mm;
          padding-top: 4mm;
        }
        @media print {
          .screen-toolbar { display: none; }
          .batch-label-page { padding: 0; }
        }
      `}</style>
    </main>
  );
}
