import prisma from '@/lib/prisma';
import { canScope } from '@/lib/access-control';
import { getSelectedBrandScopedWhere } from '@/lib/brand-context';
import { getAvailableBrands } from '@/lib/available-brands';
import { requirePagePermission } from '@/lib/authz';
import ContentPageClient from './ContentPageClient';

export const dynamic = 'force-dynamic';

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const scope = await requirePagePermission('content:view');
  const { brand } = await searchParams;

  const brandWhere = getSelectedBrandScopedWhere(scope, brand);

  const [posts, creatives, availableBrands] = await Promise.all([
    prisma.socialPost.findMany({
      where: brandWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        publishLogs: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            channel: true,
            status: true,
            externalPostId: true,
            errorCode: true,
            errorMessage: true,
            publishedBy: true,
            createdAt: true,
          },
        },
        postCreatives: {
          include: {
            creative: {
              select: {
                id: true,
                generatedImageData: true
              }
            }
          }
        }
      },
    }),
    prisma.generatedCreative.findMany({
      where: brandWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        brand: true,
        generatedImageData: true,
        prompt: true,
        personaStyle: true,
        productContext: true,
        sourceImageUrl: true,
        status: true,
        createdBy: true,
        createdAt: true,
      },
    }),
    getAvailableBrands(scope),
  ]);

  const totalDrafts = posts.filter((p) => p.status === 'draft').length;
  const totalReady = posts.filter((p) => p.status === 'ready').length;

  return (
    <ContentPageClient
      initialPosts={posts}
      initialCreatives={creatives}
      stats={{ totalDrafts, totalReady, total: posts.length }}
      canWrite={canScope(scope, 'content:write')}
      availableBrands={availableBrands}
    />
  );
}
