'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertBrandAccess, requireActionPermission } from '@/lib/authz';
import { buildMerchantSettingsPersistenceInput } from '@/lib/runtime-config';

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
  });
  const { storeKey, ...updateData } = data;

  await prisma.merchantSettings.upsert({
    where: { storeKey },
    create: data,
    update: updateData,
  });

  if (brand) {
    const facebookPageId = cleanOptionalText(readText(formData, 'facebookPageId'));
    const facebookPageAccessToken = cleanOptionalText(readText(formData, 'facebookPageAccessToken'));
    const instagramAccountId = cleanOptionalText(readText(formData, 'instagramAccountId'));
    const instagramAccessToken = cleanOptionalText(readText(formData, 'instagramAccessToken'));
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

  revalidatePath('/settings');
}
