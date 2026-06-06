'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertBrandAccess, requireActionPermission } from '@/lib/authz';
import { buildMerchantSettingsPersistenceInput } from '@/lib/runtime-config';
import { getCourierWebhookSecret } from '@/lib/courier-webhook-secret';
import { logAdminAudit } from '@/lib/admin-audit';
import {
  syncKoombiyoLocationsForBrand,
  testKoombiyoConnectionForBrand,
} from '@/lib/koombiyo-courier';

function readText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' ? value : null;
}

function readNumber(formData: FormData, key: string): number | null {
  const value = Number.parseInt(readText(formData, key) || '', 10);
  return Number.isInteger(value) ? value : null;
}

function readBoolean(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on';
}

function cleanOptionalText(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanAccessToken(value: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, '').trim();
  return cleaned ? cleaned : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function readList(formData: FormData, key: string): string[] {
  return (readText(formData, key) || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function saveMerchantSettingsAction(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = readText(formData, 'brand')?.trim() || null;

  if (brand) {
    assertBrandAccess(scope, brand, 'brand settings');
  }

  const data = buildMerchantSettingsPersistenceInput({
    brand,
    displayName: readText(formData, 'displayName'),
    supportPhone: readText(formData, 'supportPhone'),
    supportWhatsapp: readText(formData, 'supportWhatsapp'),
    supportHours: readText(formData, 'supportHours'),
    supportHandoffMessage: readText(formData, 'supportHandoffMessage'),
    processingErrorMessage: readText(formData, 'processingErrorMessage'),
    paymentMethods: readList(formData, 'paymentMethods'),
    defaultPaymentMethod: readText(formData, 'defaultPaymentMethod'),
    onlineTransferLabel: readText(formData, 'onlineTransferLabel'),
    deliveryColomboCharge: readNumber(formData, 'deliveryColomboCharge'),
    deliveryOutsideColomboCharge: readNumber(formData, 'deliveryOutsideColomboCharge'),
    deliveryColomboEstimate: readText(formData, 'deliveryColomboEstimate'),
    deliveryOutsideColomboEstimate: readText(formData, 'deliveryOutsideColomboEstimate'),
    cartRecoveryEnabled: readBoolean(formData, 'cartRecoveryEnabled'),
    cartRecoveryDelayHours: readNumber(formData, 'cartRecoveryDelayHours'),
    cartRecoveryCooldownHours: readNumber(formData, 'cartRecoveryCooldownHours'),
    supportTimeoutEnabled: readBoolean(formData, 'supportTimeoutEnabled'),
    supportTimeoutDelayHours: readNumber(formData, 'supportTimeoutDelayHours'),
    supportTimeoutCooldownHours: readNumber(formData, 'supportTimeoutCooldownHours'),
    postOrderFollowUpEnabled: readBoolean(formData, 'postOrderFollowUpEnabled'),
    postOrderFollowUpDelayDays: readNumber(formData, 'postOrderFollowUpDelayDays'),
    postOrderFollowUpWindowDays: readNumber(formData, 'postOrderFollowUpWindowDays'),
    reorderReminderEnabled: readBoolean(formData, 'reorderReminderEnabled'),
    reorderReminderDelayDays: readNumber(formData, 'reorderReminderDelayDays'),
    reorderReminderWindowDays: readNumber(formData, 'reorderReminderWindowDays'),
    purchaseNudgeCooldownDays: readNumber(formData, 'purchaseNudgeCooldownDays'),
    commentAutoReplyEnabled: readBoolean(formData, 'commentAutoReplyEnabled'),
  });
  const courierWebhookSecret = brand ? null : cleanAccessToken(readText(formData, 'courierWebhookSecret'));
  const dataWithSecrets = {
    ...data,
    ...(courierWebhookSecret ? { courierWebhookSecret } : {}),
  };
  const { storeKey, ...updateData } = dataWithSecrets;

  await prisma.merchantSettings.upsert({
    where: { storeKey },
    create: dataWithSecrets,
    update: updateData,
  });

  await logAdminAudit({
    action: 'settings_saved',
    entityType: brand ? 'brand_settings' : 'merchant_settings',
    entityId: storeKey,
    brand,
    actorEmail: scope.email ?? null,
    summary: brand
      ? `Saved settings for ${brand}.`
      : 'Saved global merchant settings.',
    metadata: {
      updatedCourierWebhookSecret: Boolean(courierWebhookSecret),
      commentAutoReplyEnabled: data.commentAutoReplyEnabled,
    },
  });

  if (brand) {
    const facebookPageId = cleanOptionalText(readText(formData, 'facebookPageId'));
    const facebookPageAccessToken = cleanAccessToken(readText(formData, 'facebookPageAccessToken'));
    const instagramAccountId = cleanOptionalText(readText(formData, 'instagramAccountId'));
    const instagramAccessToken = cleanAccessToken(readText(formData, 'instagramAccessToken'));
    const notes = cleanOptionalText(readText(formData, 'channelNotes'));
    const channelUpdateData = {
      facebookPageId,
      instagramAccountId,
      isTestBrand: readBoolean(formData, 'isTestBrand'),
      notes,
      ...(facebookPageAccessToken ? { facebookPageAccessToken } : {}),
      ...(instagramAccessToken ? { instagramAccessToken } : {}),
    };

    await prisma.brandChannelConfig.upsert({
      where: { brand },
      create: {
        brand,
        facebookPageId,
        facebookPageAccessToken,
        instagramAccountId,
        instagramAccessToken,
        isTestBrand: readBoolean(formData, 'isTestBrand'),
        notes,
      },
      update: channelUpdateData,
    });
  }

  revalidatePath('/settings');
}

export async function addBrandSettingsAction(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = cleanOptionalText(readText(formData, 'newBrand'));

  if (!brand) {
    return;
  }

  assertBrandAccess(scope, brand, 'brand settings');

  const displayName = cleanOptionalText(readText(formData, 'newDisplayName')) || brand;
  const facebookPageId = cleanOptionalText(readText(formData, 'newFacebookPageId'));
  const instagramAccountId = cleanOptionalText(readText(formData, 'newInstagramAccountId'));
  const notes = cleanOptionalText(readText(formData, 'newChannelNotes'));
  const isTestBrand = readBoolean(formData, 'newIsTestBrand');
  const data = buildMerchantSettingsPersistenceInput({
    brand,
    displayName,
  });
  const { storeKey, ...updateData } = data;

  await prisma.merchantSettings.upsert({
    where: { storeKey },
    create: data,
    update: updateData,
  });

  await prisma.brandChannelConfig.upsert({
    where: { brand },
    create: {
      brand,
      facebookPageId,
      instagramAccountId,
      isTestBrand,
      notes,
    },
    update: {
      ...(facebookPageId ? { facebookPageId } : {}),
      ...(instagramAccountId ? { instagramAccountId } : {}),
      isTestBrand,
      ...(notes ? { notes } : {}),
    },
  });

  await logAdminAudit({
    action: 'brand_settings_created',
    entityType: 'brand_settings',
    entityId: brand,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Created settings shell for ${brand}.`,
    metadata: {
      hasFacebookPageId: Boolean(facebookPageId),
      hasInstagramAccountId: Boolean(instagramAccountId),
      isTestBrand,
    },
  });

  revalidatePath('/settings');
}

export async function testCourierWebhookSettingsAction() {
  const scope = await requireActionPermission('settings:write');
  const configuredSecret = await getCourierWebhookSecret();
  const source = process.env.COURIER_WEBHOOK_SECRET
    ? 'vercel_env'
    : configuredSecret
      ? 'settings'
      : 'missing';

  await logAdminAudit({
    action: 'courier_webhook_test',
    entityType: 'courier_webhook',
    entityId: 'default',
    actorEmail: scope.email ?? null,
    summary: configuredSecret
      ? `Courier webhook configuration check passed using ${source === 'vercel_env' ? 'Vercel env' : 'Settings'} secret.`
      : 'Courier webhook configuration check failed because no secret is configured.',
    metadata: {
      configured: Boolean(configuredSecret),
      source,
    },
  });

  revalidatePath('/settings');
}

export async function saveKoombiyoCourierSettingsAction(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = cleanOptionalText(readText(formData, 'brand'));

  if (!brand) {
    return;
  }

  assertBrandAccess(scope, brand, 'courier settings');

  const apiKey = cleanAccessToken(readText(formData, 'koombiyoApiKey'));
  const data = {
    brand,
    provider: 'koombiyo',
    isActive: readBoolean(formData, 'koombiyoIsActive'),
    senderName: cleanOptionalText(readText(formData, 'koombiyoSenderName')),
    senderAddress: cleanOptionalText(readText(formData, 'koombiyoSenderAddress')),
    senderPhone: cleanOptionalText(readText(formData, 'koombiyoSenderPhone')),
    defaultReceiverDistrictId: cleanOptionalText(readText(formData, 'koombiyoDefaultReceiverDistrictId')),
    defaultReceiverCityId: cleanOptionalText(readText(formData, 'koombiyoDefaultReceiverCityId')),
    notes: cleanOptionalText(readText(formData, 'koombiyoNotes')),
    ...(apiKey ? { apiKey } : {}),
  };
  const { provider, ...updateData } = data;

  await prisma.courierIntegrationSetting.upsert({
    where: { brand_provider: { brand, provider } },
    create: data,
    update: updateData,
  });

  await logAdminAudit({
    action: 'courier_settings_saved',
    entityType: 'courier_settings',
    entityId: `${brand}:koombiyo`,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Saved Koombiyo courier settings for ${brand}.`,
    metadata: {
      provider,
      isActive: data.isActive,
      updatedApiKey: Boolean(apiKey),
      hasDefaultReceiverDistrictId: Boolean(data.defaultReceiverDistrictId),
      hasDefaultReceiverCityId: Boolean(data.defaultReceiverCityId),
    },
  });

  revalidatePath('/settings');
}

export async function testKoombiyoCourierSettingsAction(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = cleanOptionalText(readText(formData, 'brand'));

  if (!brand) {
    return;
  }

  assertBrandAccess(scope, brand, 'courier settings');

  let status = 'failed';
  let message = '';

  try {
    const result = await testKoombiyoConnectionForBrand(brand);
    status = result.ok ? 'success' : 'failed';
    message = result.message;
  } catch (error) {
    message = getErrorMessage(error);
  }

  await prisma.courierIntegrationSetting.upsert({
    where: { brand_provider: { brand, provider: 'koombiyo' } },
    create: {
      brand,
      provider: 'koombiyo',
      isActive: false,
      lastTestAt: new Date(),
      lastTestStatus: status,
      lastTestMessage: message,
    },
    update: {
      lastTestAt: new Date(),
      lastTestStatus: status,
      lastTestMessage: message,
    },
  });

  await logAdminAudit({
    action: 'courier_settings_tested',
    entityType: 'courier_settings',
    entityId: `${brand}:koombiyo`,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Koombiyo connection test ${status} for ${brand}.`,
    metadata: {
      provider: 'koombiyo',
      status,
      message,
    },
  });

  revalidatePath('/settings');
}

export async function syncKoombiyoLocationsAction(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = cleanOptionalText(readText(formData, 'brand'));

  if (!brand) {
    return;
  }

  assertBrandAccess(scope, brand, 'courier settings');

  let status = 'failed';
  let message = '';
  let count = 0;

  try {
    count = await syncKoombiyoLocationsForBrand(brand);
    status = 'success';
    message = `Synced ${count} Koombiyo city mappings for ${brand}.`;
  } catch (error) {
    message = getErrorMessage(error);
  }

  await prisma.courierIntegrationSetting.upsert({
    where: { brand_provider: { brand, provider: 'koombiyo' } },
    create: {
      brand,
      provider: 'koombiyo',
      isActive: false,
      lastTestAt: new Date(),
      lastTestStatus: status,
      lastTestMessage: message,
    },
    update: {
      lastTestAt: new Date(),
      lastTestStatus: status,
      lastTestMessage: message,
    },
  });

  await logAdminAudit({
    action: 'courier_locations_synced',
    entityType: 'courier_settings',
    entityId: `${brand}:koombiyo`,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Koombiyo location sync ${status} for ${brand}.`,
    metadata: {
      provider: 'koombiyo',
      status,
      count,
      message,
    },
  });

  revalidatePath('/settings');
}
