import prisma from '@/lib/prisma';

export interface ResolvedFacebookConfig {
  brand: string;
  pageId: string;
  pageAccessToken: string;
}

export interface ResolvedInstagramConfig {
  brand: string;
  accountId: string;
  accessToken: string;
}

export interface BrandChannelConfigView {
  brand: string;
  facebookPageId: string | null;
  hasFacebookPageAccessToken: boolean;
  instagramAccountId: string | null;
  hasInstagramAccessToken: boolean;
  isTestBrand: boolean;
  notes: string | null;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanAccessToken(value?: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, '').trim();
  return cleaned ? cleaned : null;
}

function brandEnvKey(brand: string): string {
  return brand.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function resolveEnv(brand: string, suffix: string, fallback?: string): string | undefined {
  const brandKey = brandEnvKey(brand);
  return process.env[`${suffix}_${brandKey}`] ?? process.env[suffix] ?? fallback;
}

function legacyFacebookPageIdForBrand(brand: string): string | undefined {
  const brandKey = brandEnvKey(brand);

  if (brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY') return process.env.HAPPYBY_PAGE_ID;
  if (brandKey === 'CLEOPATRA') return process.env.CLEOPATRA_PAGE_ID;
  if (brandKey === 'MODABELLA') return process.env.MODABELLA_PAGE_ID;

  return undefined;
}

function legacyInstagramAccountIdForBrand(brand: string): string | undefined {
  const brandKey = brandEnvKey(brand);

  if (brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY') return process.env.HAPPYBY_INSTAGRAM_ID;
  if (brandKey === 'CLEOPATRA') return process.env.CLEOPATRA_INSTAGRAM_ID;
  if (brandKey === 'MODABELLA') return process.env.MODABELLA_INSTAGRAM_ID;

  return undefined;
}

export async function getBrandChannelConfigView(brand: string): Promise<BrandChannelConfigView> {
  const record = await prisma.brandChannelConfig.findUnique({
    where: { brand },
    select: {
      brand: true,
      facebookPageId: true,
      facebookPageAccessToken: true,
      instagramAccountId: true,
      instagramAccessToken: true,
      isTestBrand: true,
      notes: true,
    },
  });

  if (record) {
    return {
      brand,
      facebookPageId: record.facebookPageId ?? null,
      hasFacebookPageAccessToken: Boolean(record.facebookPageAccessToken),
      instagramAccountId: record.instagramAccountId ?? null,
      hasInstagramAccessToken: Boolean(record.instagramAccessToken),
      isTestBrand: record.isTestBrand,
      notes: record.notes ?? null,
    };
  }

  return {
    brand,
    facebookPageId: legacyFacebookPageIdForBrand(brand) ?? null,
    hasFacebookPageAccessToken: Boolean(resolveEnv(brand, 'META_FB_PAGE_TOKEN', process.env.META_PAGE_ACCESS_TOKEN)),
    instagramAccountId: legacyInstagramAccountIdForBrand(brand) ?? null,
    hasInstagramAccessToken: Boolean(resolveEnv(brand, 'META_IG_TOKEN', process.env.META_PAGE_ACCESS_TOKEN)),
    isTestBrand: false,
    notes: null,
  };
}

export async function resolveFacebookConfigForBrand(brand: string): Promise<ResolvedFacebookConfig | null> {
  const record = await prisma.brandChannelConfig.findUnique({
    where: { brand },
    select: { facebookPageId: true, facebookPageAccessToken: true },
  });

  if (record) {
    const pageId = cleanOptionalText(record.facebookPageId);
    const pageAccessToken = cleanAccessToken(record.facebookPageAccessToken);

    if (!pageId || !pageAccessToken) return null;
    return { brand, pageId, pageAccessToken };
  }

  const pageId = legacyFacebookPageIdForBrand(brand) ?? resolveEnv(brand, 'META_FB_PAGE_ID');
  const pageAccessToken = cleanAccessToken(resolveEnv(brand, 'META_FB_PAGE_TOKEN', process.env.META_PAGE_ACCESS_TOKEN));

  if (!pageId || !pageAccessToken) return null;
  return { brand, pageId, pageAccessToken };
}

export async function resolveInstagramConfigForBrand(brand: string): Promise<ResolvedInstagramConfig | null> {
  const record = await prisma.brandChannelConfig.findUnique({
    where: { brand },
    select: { instagramAccountId: true, instagramAccessToken: true },
  });

  if (record) {
    const accountId = cleanOptionalText(record.instagramAccountId);
    const accessToken = cleanAccessToken(record.instagramAccessToken);

    if (!accountId || !accessToken) return null;
    return { brand, accountId, accessToken };
  }

  const accountId = legacyInstagramAccountIdForBrand(brand) ?? resolveEnv(brand, 'META_IG_ACCOUNT_ID');
  const accessToken = cleanAccessToken(resolveEnv(brand, 'META_IG_TOKEN', process.env.META_PAGE_ACCESS_TOKEN));

  if (!accountId || !accessToken) return null;
  return { brand, accountId, accessToken };
}

export async function resolveBrandForFacebookPageId(pageId: string): Promise<string | null> {
  const record = await prisma.brandChannelConfig.findFirst({
    where: { facebookPageId: pageId },
    select: { brand: true },
  });
  if (record?.brand) return record.brand;

  if (process.env.HAPPYBY_PAGE_ID === pageId) return 'Happyby';
  if (process.env.CLEOPATRA_PAGE_ID === pageId) return 'Cleopatra';
  if (process.env.MODABELLA_PAGE_ID === pageId) return 'Modabella';

  return null;
}

export async function resolveBrandForInstagramAccountId(accountId: string): Promise<string | null> {
  const record = await prisma.brandChannelConfig.findFirst({
    where: { instagramAccountId: accountId },
    select: { brand: true },
  });
  if (record?.brand) return record.brand;

  if (process.env.HAPPYBY_INSTAGRAM_ID === accountId) return 'Happyby';
  if (process.env.CLEOPATRA_INSTAGRAM_ID === accountId) return 'Cleopatra';
  if (process.env.MODABELLA_INSTAGRAM_ID === accountId) return 'Modabella';

  return null;
}

export async function getConfiguredInstagramAccountIds(): Promise<Set<string>> {
  const accountIds = new Set<string>();
  const records = await prisma.brandChannelConfig.findMany({
    where: { instagramAccountId: { not: null } },
    select: { instagramAccountId: true },
  });

  for (const record of records) {
    const accountId = cleanOptionalText(record.instagramAccountId);
    if (accountId) accountIds.add(accountId);
  }

  for (const accountId of [
    process.env.HAPPYBY_INSTAGRAM_ID,
    process.env.CLEOPATRA_INSTAGRAM_ID,
    process.env.MODABELLA_INSTAGRAM_ID,
    process.env.META_IG_ACCOUNT_ID,
  ]) {
    const cleaned = cleanOptionalText(accountId);
    if (cleaned) accountIds.add(cleaned);
  }

  return accountIds;
}

export async function resolveFacebookConfigForPageId(pageId: string): Promise<ResolvedFacebookConfig | null> {
  const record = await prisma.brandChannelConfig.findFirst({
    where: { facebookPageId: pageId },
    select: { brand: true, facebookPageId: true, facebookPageAccessToken: true },
  });

  const pageAccessToken = cleanAccessToken(record?.facebookPageAccessToken);
  if (record?.brand && record.facebookPageId && pageAccessToken) {
    return {
      brand: record.brand,
      pageId: record.facebookPageId,
      pageAccessToken,
    };
  }

  const brand = await resolveBrandForFacebookPageId(pageId);
  return brand ? resolveFacebookConfigForBrand(brand) : null;
}

export async function resolveInstagramConfigForAccountId(accountId: string): Promise<ResolvedInstagramConfig | null> {
  const record = await prisma.brandChannelConfig.findFirst({
    where: { instagramAccountId: accountId },
    select: { brand: true, instagramAccountId: true, instagramAccessToken: true },
  });

  const accessToken = cleanAccessToken(record?.instagramAccessToken);
  if (record?.brand && record.instagramAccountId && accessToken) {
    return {
      brand: record.brand,
      accountId: record.instagramAccountId,
      accessToken,
    };
  }

  const brand = await resolveBrandForInstagramAccountId(accountId);
  return brand ? resolveInstagramConfigForBrand(brand) : null;
}
