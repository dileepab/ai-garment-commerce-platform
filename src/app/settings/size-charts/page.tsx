import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { canAccessBrand, canScope, describeScope } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { BRAND_QUERY_PARAM, resolveSelectedBrand } from '@/lib/brand-context';
import { listBrandTemplates } from '@/lib/size-chart-store';
import { SizeChartTemplatesClient, type TemplateView } from './SizeChartTemplatesClient';

export const dynamic = 'force-dynamic';

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-LK', {
    dateStyle: 'medium',
    timeZone: 'Asia/Colombo',
  }).format(value);
}

export default async function SizeChartTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const scope = await requirePagePermission('settings:view');
  const { brand: brandParam } = await searchParams;
  const selectedBrand = resolveSelectedBrand(scope, brandParam);
  const canManage = canScope(scope, 'settings:write');

  const productBrands = await prisma.product.findMany({
    distinct: ['brand'],
    select: { brand: true },
    orderBy: { brand: 'asc' },
  });
  const brands = productBrands
    .map((row) => row.brand)
    .filter((brand) => canAccessBrand(scope, brand));

  const templates: TemplateView[] = selectedBrand
    ? (await listBrandTemplates(selectedBrand)).map((entry) => ({
        garmentType: entry.garmentType,
        chart: entry.chart,
        saved: entry.saved,
        updatedAt: formatDate(entry.updatedAt),
      }))
    : [];

  return (
    <main className="main">
      <PageHeader
        title="Size Chart Templates"
        subtitle={`What a new product's chart starts from, per brand and garment type · ${describeScope(scope)}`}
        actions={
          <Link className="btn btn-secondary" href="/settings">
            Settings
          </Link>
        }
      />

      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <section className="app-card" style={{ display: 'grid', gap: 12 }}>
          <div>
            <p className="app-section-label">Brand</p>
            <p className="app-muted" style={{ margin: '4px 0 0', lineHeight: 1.5 }}>
              A template holds the body grading and the typical garment measurements for one type.
              Creating a product copies them in, and they are edited per product from there — so a
              maxi and a midi stop sharing one length.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {brands.map((brand) => (
              <Link
                key={brand}
                href={`/settings/size-charts?${BRAND_QUERY_PARAM}=${encodeURIComponent(brand)}`}
                className={selectedBrand === brand ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ fontSize: 12 }}
              >
                {brand}
              </Link>
            ))}
          </div>
        </section>

        {selectedBrand && templates.length > 0 ? (
          <section className="app-card">
            <SizeChartTemplatesClient
              brand={selectedBrand}
              templates={templates}
              canManage={canManage}
            />
          </section>
        ) : (
          <section className="app-card">
            <p className="app-muted" style={{ margin: 0 }}>
              {brands.length === 0
                ? 'No brands are visible to this account yet.'
                : 'Choose a brand to see its templates.'}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
