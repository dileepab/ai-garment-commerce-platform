import { canScope } from '@/lib/access-control';
import { normalizeSelectedBrand } from '@/lib/brand-context';
import { requirePagePermission } from '@/lib/authz';
import { loadSupportInbox } from '@/lib/support-inbox';
import SupportPageClient from './SupportPageClient';

export const dynamic = 'force-dynamic';

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const scope = await requirePagePermission('support:view');
  const { brand } = await searchParams;
  const { threads, stats } = await loadSupportInbox({
    scope,
    selectedBrand: brand,
    includeMessages: true,
  });

  return (
    <SupportPageClient
      initialConversations={threads}
      stats={stats}
      canReply={canScope(scope, 'support:reply')}
      selectedBrand={normalizeSelectedBrand(brand)}
    />
  );
}
