import prisma from '@/lib/prisma';
import { canAccessBrand, describeScope } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { PageHeader } from '@/components/PageHeader';
import { ChatSimulatorClient } from './ChatSimulatorClient';

export const dynamic = 'force-dynamic';

function uniqueBrands(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));
}

export default async function SupportSimulatorPage() {
  const scope = await requirePagePermission('support:view');
  const [productBrands, orderBrands, supportBrands] = await Promise.all([
    prisma.product.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.order.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.supportEscalation.findMany({ distinct: ['brand'], select: { brand: true } }),
  ]);
  const brands = uniqueBrands([
    ...productBrands.map((row) => row.brand),
    ...orderBrands.map((row) => row.brand),
    ...supportBrands.map((row) => row.brand),
  ]).filter((brand) => canAccessBrand(scope, brand));

  return (
    <main className="main">
      <PageHeader
        title="Chat Simulator"
        subtitle="Test multilingual customer replies, catalog cards, support handoff, and order flows before Meta review"
        actions={<span className="app-chip app-chip-neutral">{describeScope(scope)}</span>}
      />
      <ChatSimulatorClient brands={brands} />
    </main>
  );
}
