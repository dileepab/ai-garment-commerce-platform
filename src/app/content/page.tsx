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

  const [posts, creatives, linkableProducts, availableBrands] = await Promise.all([
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
                imageUrl: true,
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
        imageUrl: true,
        generatedImageData: true,
        prompt: true,
        personaStyle: true,
        productContext: true,
        sourceImageUrl: true,
        status: true,
        publishedAt: true,
        createdBy: true,
        createdAt: true,
        // Which product this creative represents. Splitting one product into
        // several colourways leaves creatives pointing at the original, so the
        // link has to be visible and correctable.
        productId: true,
        product: { select: { id: true, name: true, sku: true, brand: true } },
      },
    }),
    // Targets for re-linking a creative that ended up on the wrong product.
    prisma.product.findMany({
      where: { ...brandWhere, status: { notIn: ['archived', 'deleted'] } },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sku: true, brand: true },
    }),
    getAvailableBrands(scope),
  ]);

  const totalDrafts = posts.filter((p) => p.status === 'draft').length;
  const totalReady = posts.filter((p) => p.status === 'ready').length;

  return (
    <ContentPageClient
      initialPosts={posts}
      initialCreatives={creatives}
      linkableProducts={linkableProducts}
      stats={{ totalDrafts, totalReady, total: posts.length }}
      canWrite={canScope(scope, 'content:write')}
      availableBrands={availableBrands}
    />
  );
}
