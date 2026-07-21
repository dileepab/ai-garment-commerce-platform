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

export interface ResolvedWhatsAppConfig {
  brand: string;
  businessAccountId: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  accessToken: string;
}

export interface BrandChannelConfigView {
  brand: string;
  facebookPageId: string | null;
  hasFacebookPageAccessToken: boolean;
  instagramAccountId: string | null;
  hasInstagramAccessToken: boolean;
  whatsappBusinessAccountId: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappDisplayPhoneNumber: string | null;
  hasWhatsappAccessToken: boolean;
  isTestBrand: boolean;
  notes: string | null;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanAccessToken(value?: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, '').trim().replace(/^["'`]+|["'`]+$/g, '');
  return cleaned ? cleaned : null;
}

function brandEnvKey(brand: string): string {
  return brand.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function resolveEnv(brand: string, suffix: string, fallback?: string): string | undefined {
  const brandKey = brandEnvKey(brand);
  const happybuyKey =
    brandKey === 'HAPPYBUY' || brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY'
      ? process.env[`${suffix}_HAPPYBUY`]
      : undefined;
  const legacyHappybyKey =
    brandKey === 'HAPPYBUY' || brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY'
      ? process.env[`${suffix}_HAPPYBY`]
      : undefined;
  return process.env[`${suffix}_${brandKey}`] ?? happybuyKey ?? legacyHappybyKey ?? process.env[suffix] ?? fallback;
}

function resolveBrandEnv(brand: string, suffix: string): string | undefined {
  const brandKey = brandEnvKey(brand);
  const happybuyKey =
    brandKey === 'HAPPYBUY' || brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY'
      ? process.env[`${suffix}_HAPPYBUY`]
      : undefined;
  const legacyHappybyKey =
    brandKey === 'HAPPYBUY' || brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY'
      ? process.env[`${suffix}_HAPPYBY`]
      : undefined;
  return process.env[`${suffix}_${brandKey}`] ?? happybuyKey ?? legacyHappybyKey;
}

function legacyFacebookPageIdForBrand(brand: string): string | undefined {
  const brandKey = brandEnvKey(brand);

  if (brandKey === 'HAPPYBUY' || brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY') {
    return process.env.HAPPYBUY_PAGE_ID ?? process.env.HAPPYBY_PAGE_ID;
  }
  if (brandKey === 'CLEOPATRA') return process.env.CLEOPATRA_PAGE_ID;
  if (brandKey === 'MODABELLA') return process.env.MODABELLA_PAGE_ID;

  return undefined;
}

function legacyInstagramAccountIdForBrand(brand: string): string | undefined {
  const brandKey = brandEnvKey(brand);

  if (brandKey === 'HAPPYBUY' || brandKey === 'HAPPYBY' || brandKey === 'HAPPY_BUY') {
    return process.env.HAPPYBUY_INSTAGRAM_ID ?? process.env.HAPPYBY_INSTAGRAM_ID;
  }
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
      whatsappBusinessAccountId: true,
      whatsappPhoneNumberId: true,
      whatsappDisplayPhoneNumber: true,
      whatsappAccessToken: true,
      isTestBrand: true,
      notes: true,
    },
  });

  if (record) {
    const whatsappBusinessAccountId =
      record.whatsappBusinessAccountId ?? resolveBrandEnv(brand, 'META_WHATSAPP_WABA_ID');
    const whatsappPhoneNumberId =
      record.whatsappPhoneNumberId ?? resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID');
    const whatsappDisplayPhoneNumber =
      record.whatsappDisplayPhoneNumber ?? resolveBrandEnv(brand, 'META_WHATSAPP_DISPLAY_PHONE');
    const whatsappAccessToken =
      record.whatsappAccessToken ?? resolveBrandEnv(brand, 'META_WHATSAPP_ACCESS_TOKEN');

    return {
      brand,
      facebookPageId: record.facebookPageId ?? null,
      hasFacebookPageAccessToken: Boolean(record.facebookPageAccessToken),
      instagramAccountId: record.instagramAccountId ?? null,
      hasInstagramAccessToken: Boolean(record.instagramAccessToken),
      whatsappBusinessAccountId: whatsappBusinessAccountId ?? null,
      whatsappPhoneNumberId: whatsappPhoneNumberId ?? null,
      whatsappDisplayPhoneNumber: whatsappDisplayPhoneNumber ?? null,
      hasWhatsappAccessToken: Boolean(whatsappAccessToken),
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
    whatsappBusinessAccountId: resolveBrandEnv(brand, 'META_WHATSAPP_WABA_ID') ?? null,
    whatsappPhoneNumberId: resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID') ?? null,
    whatsappDisplayPhoneNumber: resolveBrandEnv(brand, 'META_WHATSAPP_DISPLAY_PHONE') ?? null,
    hasWhatsappAccessToken: Boolean(resolveBrandEnv(brand, 'META_WHATSAPP_ACCESS_TOKEN')),
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

export async function resolveWhatsAppConfigForBrand(brand: string): Promise<ResolvedWhatsAppConfig | null> {
  const record = await prisma.brandChannelConfig.findUnique({
    where: { brand },
    select: {
      whatsappBusinessAccountId: true,
      whatsappPhoneNumberId: true,
      whatsappDisplayPhoneNumber: true,
      whatsappAccessToken: true,
    },
  });

  if (record) {
    const phoneNumberId = cleanOptionalText(
      record.whatsappPhoneNumberId ?? resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID')
    );
    const accessToken = cleanAccessToken(
      record.whatsappAccessToken ?? resolveBrandEnv(brand, 'META_WHATSAPP_ACCESS_TOKEN')
    );

    if (!phoneNumberId || !accessToken) return null;
    return {
      brand,
      businessAccountId: cleanOptionalText(
        record.whatsappBusinessAccountId ?? resolveBrandEnv(brand, 'META_WHATSAPP_WABA_ID')
      ),
      phoneNumberId,
      displayPhoneNumber: cleanOptionalText(
        record.whatsappDisplayPhoneNumber ?? resolveBrandEnv(brand, 'META_WHATSAPP_DISPLAY_PHONE')
      ),
      accessToken,
    };
  }

  const phoneNumberId = cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID'));
  const accessToken = cleanAccessToken(resolveBrandEnv(brand, 'META_WHATSAPP_ACCESS_TOKEN'));

  if (!phoneNumberId || !accessToken) return null;
  return {
    brand,
    businessAccountId: cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_WABA_ID')),
    phoneNumberId,
    displayPhoneNumber: cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_DISPLAY_PHONE')),
    accessToken,
  };
}

export async function resolveBrandForFacebookPageId(pageId: string): Promise<string | null> {
  const record = await prisma.brandChannelConfig.findFirst({
    where: { facebookPageId: pageId },
    select: { brand: true },
  });
  if (record?.brand) return record.brand;

  if (process.env.HAPPYBUY_PAGE_ID === pageId || process.env.HAPPYBY_PAGE_ID === pageId) {
    return 'Happybuy';
  }
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

  if (
    process.env.HAPPYBUY_INSTAGRAM_ID === accountId ||
    process.env.HAPPYBY_INSTAGRAM_ID === accountId
  ) {
    return 'Happybuy';
  }
  if (process.env.CLEOPATRA_INSTAGRAM_ID === accountId) return 'Cleopatra';
  if (process.env.MODABELLA_INSTAGRAM_ID === accountId) return 'Modabella';

  return null;
}

export async function resolveBrandForWhatsAppPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const record = await prisma.brandChannelConfig.findUnique({
    where: { whatsappPhoneNumberId: phoneNumberId },
    select: { brand: true },
  });
  if (record?.brand) return record.brand;

  for (const brand of ['DEEZ', 'Happybuy', 'Cleopatra', 'Modabella']) {
    if (cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID')) === phoneNumberId) {
      return brand;
    }
  }

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
    process.env.HAPPYBUY_INSTAGRAM_ID,
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

export async function getConfiguredFacebookPageIds(): Promise<Set<string>> {
  const pageIds = new Set<string>();
  const records = await prisma.brandChannelConfig.findMany({
    where: { facebookPageId: { not: null } },
    select: { facebookPageId: true },
  });

  for (const record of records) {
    const pageId = cleanOptionalText(record.facebookPageId);
    if (pageId) pageIds.add(pageId);
  }

  for (const pageId of [
    process.env.HAPPYBUY_PAGE_ID,
    process.env.HAPPYBY_PAGE_ID,
    process.env.CLEOPATRA_PAGE_ID,
    process.env.MODABELLA_PAGE_ID,
    process.env.META_FB_PAGE_ID,
  ]) {
    const cleaned = cleanOptionalText(pageId);
    if (cleaned) pageIds.add(cleaned);
  }

  return pageIds;
}

export async function getConfiguredWhatsAppPhoneNumberIds(): Promise<Set<string>> {
  const phoneNumberIds = new Set<string>();
  const records = await prisma.brandChannelConfig.findMany({
    where: { whatsappPhoneNumberId: { not: null } },
    select: { whatsappPhoneNumberId: true },
  });

  for (const record of records) {
    const phoneNumberId = cleanOptionalText(record.whatsappPhoneNumberId);
    if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
  }

  for (const brand of ['DEEZ', 'Happybuy', 'Cleopatra', 'Modabella']) {
    const phoneNumberId = cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID'));
    if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
  }

  return phoneNumberIds;
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

export async function resolveWhatsAppConfigForPhoneNumberId(
  phoneNumberId: string
): Promise<ResolvedWhatsAppConfig | null> {
  const record = await prisma.brandChannelConfig.findUnique({
    where: { whatsappPhoneNumberId: phoneNumberId },
    select: {
      brand: true,
      whatsappBusinessAccountId: true,
      whatsappPhoneNumberId: true,
      whatsappDisplayPhoneNumber: true,
      whatsappAccessToken: true,
    },
  });

  const accessToken = cleanAccessToken(record?.whatsappAccessToken);
  if (record?.brand && record.whatsappPhoneNumberId && accessToken) {
    return {
      brand: record.brand,
      businessAccountId: cleanOptionalText(record.whatsappBusinessAccountId),
      phoneNumberId: record.whatsappPhoneNumberId,
      displayPhoneNumber: cleanOptionalText(record.whatsappDisplayPhoneNumber),
      accessToken,
    };
  }

  const brand = await resolveBrandForWhatsAppPhoneNumberId(phoneNumberId);
  if (!brand) return null;

  const envPhoneNumberId = cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_PHONE_NUMBER_ID'));
  const envAccessToken = cleanAccessToken(resolveBrandEnv(brand, 'META_WHATSAPP_ACCESS_TOKEN'));

  if (envPhoneNumberId === phoneNumberId && envAccessToken) {
    return {
      brand,
      businessAccountId: cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_WABA_ID')),
      phoneNumberId,
      displayPhoneNumber: cleanOptionalText(resolveBrandEnv(brand, 'META_WHATSAPP_DISPLAY_PHONE')),
      accessToken: envAccessToken,
    };
  }

  return resolveWhatsAppConfigForBrand(brand);
}
