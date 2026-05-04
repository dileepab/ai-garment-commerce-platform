import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import ContentPageClient from './ContentPageClient';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const scope = await requirePagePermission('content:view');

  const posts = await prisma.socialPost.findMany({
    where: getBrandScopedWhere(scope),
    orderBy: { createdAt: 'desc' },
  });

  const totalDrafts = posts.filter((p) => p.status === 'draft').length;
  const totalReady = posts.filter((p) => p.status === 'ready').length;

  const availableBrands =
    scope.brandAccess === 'limited' ? scope.brands : null;

  return (
    <ContentPageClient
      initialPosts={posts}
      stats={{ totalDrafts, totalReady, total: posts.length }}
      canWrite={canScope(scope, 'content:write')}
      availableBrands={availableBrands}
    />
  );
}
