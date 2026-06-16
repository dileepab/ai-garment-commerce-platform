import prisma from '@/lib/prisma';
import { canAccessBrand, type UserScope } from '@/lib/access-control';

function uniqueBrands(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve the set of brands a user may work with — the source of truth shared by
 * the global brand switcher (`/api/brands`) and the per-page brand pickers.
 *
 * - Limited users get exactly their assigned brands.
 * - Owner/admin users get every brand configured anywhere in the platform
 *   (settings, channel configs, products, social posts, generated creatives),
 *   filtered through {@link canAccessBrand} as a safety net.
 */
export async function getAvailableBrands(scope: UserScope): Promise<string[]> {
  if (scope.brandAccess === 'limited') {
    return scope.brands;
  }

  const [settingsBrands, channelBrands, productBrands, postBrands, creativeBrands] =
    await Promise.all([
      prisma.merchantSettings.findMany({ select: { brand: true } }),
      prisma.brandChannelConfig.findMany({ select: { brand: true } }),
      prisma.product.findMany({ distinct: ['brand'], select: { brand: true } }),
      prisma.socialPost.findMany({ distinct: ['brand'], select: { brand: true } }),
      prisma.generatedCreative.findMany({ distinct: ['brand'], select: { brand: true } }),
    ]);

  return uniqueBrands([
    ...settingsBrands.map((row) => row.brand),
    ...channelBrands.map((row) => row.brand),
    ...productBrands.map((row) => row.brand),
    ...postBrands.map((row) => row.brand),
    ...creativeBrands.map((row) => row.brand),
  ]).filter((brand) => canAccessBrand(scope, brand));
}
