import Link from 'next/link';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function splitValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getStockClass(quantity: number): string {
  if (quantity <= 0) {
    return 'app-chip app-chip-danger';
  }

  if (quantity <= 3) {
    return 'app-chip app-chip-warning';
  }

  return 'app-chip app-chip-accent';
}

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    include: { inventory: true },
    orderBy: [{ brand: 'asc' }, { createdAt: 'desc' }],
  });

  return (
    <main className="app-shell">
      <div className="app-container space-y-6">
        <div className="app-header">
          <div>
            <p className="app-kicker">Catalog</p>
            <h1 className="app-title">Products and variants at a glance</h1>
            <p className="app-subtitle">
              Sizes, colors, and live inventory now sit on the same card so it is easier to judge availability without
              cross-checking multiple screens.
            </p>
          </div>
          <Link href="/" className="app-link">
            Back to Dashboard
          </Link>
        </div>

        {products.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">No products found</h2>
            <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">
              Once products are seeded or created, the catalog cards will appear here.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const sizes = splitValues(product.sizes);
              const colors = splitValues(product.colors);
              const availableQty = product.inventory?.availableQty || 0;
              const reservedQty = product.inventory?.reservedQty || 0;
              const inProductionQty = product.inventory?.inProductionQty || 0;

              return (
                <article key={product.id} className="app-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="app-chip app-chip-neutral">{product.brand}</span>
                      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{product.name}</h2>
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                        Style: {product.style.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <span className={getStockClass(availableQty)}>{availableQty} available</span>
                  </div>

                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Price
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{formatCurrency(product.price)}</p>
                    </div>
                    <div className="grid gap-2 text-right text-sm text-slate-700">
                      <p>Reserved: {reservedQty}</p>
                      <p>In production: {inProductionQty}</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Sizes
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sizes.map((size) => (
                          <span key={size} className="app-chip app-chip-warning">
                            {size}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Colors
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {colors.map((color) => (
                          <span key={color} className="app-chip app-chip-neutral">
                            {color}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
