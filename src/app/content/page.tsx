import prisma from '@/lib/prisma';
import { canAccessBrand, canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import ContentPageClient from './ContentPageClient';

export const dynamic = 'force-dynamic';

function uniqueBrands(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

export default async function ContentPage() {
  const scope = await requirePagePermission('content:view');

  const brandWhere = getBrandScopedWhere(scope);

  const [
    posts,
    creatives,
    settingsBrands,
    channelBrands,
    productBrands,
    postBrands,
    creativeBrands,
  ] = await Promise.all([
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
    prisma.merchantSettings.findMany({ select: { brand: true } }),
    prisma.brandChannelConfig.findMany({ select: { brand: true } }),
    prisma.product.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.socialPost.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.generatedCreative.findMany({ distinct: ['brand'], select: { brand: true } }),
  ]);

  const totalDrafts = posts.filter((p) => p.status === 'draft').length;
  const totalReady = posts.filter((p) => p.status === 'ready').length;

  const availableBrands =
    scope.brandAccess === 'limited'
      ? scope.brands
      : uniqueBrands([
        ...settingsBrands.map((row) => row.brand),
        ...channelBrands.map((row) => row.brand),
        ...productBrands.map((row) => row.brand),
        ...postBrands.map((row) => row.brand),
        ...creativeBrands.map((row) => row.brand),
      ]).filter((brand) => canAccessBrand(scope, brand));

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
