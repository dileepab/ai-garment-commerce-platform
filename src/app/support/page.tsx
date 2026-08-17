import { canScope } from '@/lib/access-control';
import { normalizeSelectedBrand } from '@/lib/brand-context';
import { requirePagePermission } from '@/lib/authz';
import { loadSupportInbox } from '@/lib/support-inbox';
import { loadSupportAttachmentCatalog, type SupportAttachmentCatalog } from '@/lib/support-attachments';
import { personaAssetOrigin } from '@/lib/persona-asset';
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

  // Charts and photos are per brand, so the picker is built for each brand the
  // inbox actually contains rather than for the whole catalogue.
  const origin = personaAssetOrigin() ?? '';
  const inboxBrands = [...new Set(threads.map((thread) => thread.brand).filter(Boolean))] as string[];
  const attachmentsByBrand: Record<string, SupportAttachmentCatalog> = {};
  await Promise.all(
    inboxBrands.map(async (inboxBrand) => {
      attachmentsByBrand[inboxBrand] = await loadSupportAttachmentCatalog(inboxBrand, origin);
    })
  );

  return (
    <SupportPageClient
      initialConversations={threads}
      stats={stats}
      canReply={canScope(scope, 'support:reply')}
      selectedBrand={normalizeSelectedBrand(brand)}
      attachmentsByBrand={attachmentsByBrand}
    />
  );
}
