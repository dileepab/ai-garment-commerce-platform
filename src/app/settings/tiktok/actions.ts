'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertBrandAccess, requireActionPermission } from '@/lib/authz';
import { logAdminAudit } from '@/lib/admin-audit';
import { listTikTokAdvertisers, revokeTikTokAccessToken } from '@/lib/tiktok-api';
import { getTikTokServerConfig } from '@/lib/tiktok-config';
import {
  resolveTikTokConnection,
  TIKTOK_REVOCATION_PENDING_MESSAGE,
} from '@/lib/tiktok-connection';
import { decryptTikTokAccessToken } from '@/lib/tiktok-security';

function readRequiredText(formData: FormData, key: string, label: string): string {
  const value = formData.get(key);
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

async function requireTikTokBrandAccess(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = readRequiredText(formData, 'brand', 'Brand');
  assertBrandAccess(scope, brand, 'TikTok Ads connection');
  return { scope, brand };
}

export async function testTikTokConnectionAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const connection = await resolveTikTokConnection(brand);
  if (!connection) throw new Error('TikTok Ads is not connected for this brand.');

  let ok = false;
  let resolvedAdvertiserId: string | null = null;
  let resolvedAdvertiserName: string | null = null;
  try {
    const config = getTikTokServerConfig();
    const { advertisers } = await listTikTokAdvertisers({
      appId: config.appId,
      appSecret: config.appSecret,
      accessToken: connection.accessToken,
      apiBaseUrl: config.apiBaseUrl,
    });
    const selected = connection.advertiserId
      ? advertisers.find((advertiser) => advertiser.advertiserId === connection.advertiserId)
      : advertisers.length === 1
        ? advertisers[0]
        : null;
    ok = Boolean(selected);
    resolvedAdvertiserId = selected?.advertiserId ?? null;
    resolvedAdvertiserName = selected?.advertiserName ?? null;

    await prisma.tikTokConnection.update({
      where: { brand },
      data: {
        ...(selected ? {
          advertiserId: selected.advertiserId,
          advertiserName: selected.advertiserName,
        } : {}),
        lastVerifiedAt: new Date(),
        lastError: selected ? null : 'Select an authorized TikTok advertiser account.',
      },
    });
  } catch {
    await prisma.tikTokConnection.update({
      where: { brand },
      data: {
        lastVerifiedAt: new Date(),
        lastError: 'TikTok connection test failed. Reauthorize or try again later.',
      },
    });
  }

  await logAdminAudit({
    action: 'tiktok_connection_test',
    entityType: 'tiktok_connection',
    entityId: connection.id,
    brand,
    actorEmail: scope.email ?? null,
    summary: `${ok ? 'Verified' : 'Could not verify'} TikTok Ads for ${brand}.`,
    metadata: {
      ok,
      advertiserId: resolvedAdvertiserId,
      advertiserName: resolvedAdvertiserName,
    },
  });
  revalidatePath('/settings/tiktok');
}

export async function selectTikTokAdvertiserAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const advertiserId = readRequiredText(formData, 'advertiserId', 'TikTok advertiser');
  const connection = await resolveTikTokConnection(brand);
  if (!connection) throw new Error('TikTok Ads is not connected for this brand.');

  let selectedName: string | null = null;
  try {
    const config = getTikTokServerConfig();
    const { advertisers } = await listTikTokAdvertisers({
      appId: config.appId,
      appSecret: config.appSecret,
      accessToken: connection.accessToken,
      apiBaseUrl: config.apiBaseUrl,
    });
    const selected = advertisers.find((advertiser) => advertiser.advertiserId === advertiserId);
    if (!selected) {
      await prisma.tikTokConnection.update({
        where: { brand },
        data: { lastError: 'The selected TikTok advertiser is not authorized.' },
      });
      revalidatePath('/settings/tiktok');
      return;
    }
    selectedName = selected.advertiserName;
    await prisma.tikTokConnection.update({
      where: { brand },
      data: {
        advertiserId: selected.advertiserId,
        advertiserName: selected.advertiserName,
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });
  } catch {
    await prisma.tikTokConnection.update({
      where: { brand },
      data: { lastError: 'Could not load authorized TikTok advertisers.' },
    });
    revalidatePath('/settings/tiktok');
    return;
  }

  await logAdminAudit({
    action: 'tiktok_advertiser_selected',
    entityType: 'tiktok_connection',
    entityId: connection.id,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Selected a TikTok advertiser for ${brand}.`,
    metadata: { advertiserId, advertiserName: selectedName },
  });
  revalidatePath('/settings/tiktok');
}

export async function disconnectTikTokAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const existing = await prisma.tikTokConnection.findUnique({ where: { brand } });
  if (!existing) {
    revalidatePath('/settings/tiktok');
    return;
  }

  try {
    const config = getTikTokServerConfig();
    const accessToken = decryptTikTokAccessToken(
      existing.accessTokenEncrypted,
      config.tokenEncryptionKey,
    );
    await revokeTikTokAccessToken({
      appId: config.appId,
      appSecret: config.appSecret,
      accessToken,
      apiBaseUrl: config.apiBaseUrl,
    });
  } catch {
    await prisma.tikTokConnection.update({
      where: { brand },
      data: { lastError: TIKTOK_REVOCATION_PENDING_MESSAGE },
    });
    await logAdminAudit({
      action: 'tiktok_disconnect_failed',
      entityType: 'tiktok_connection',
      entityId: existing.id,
      brand,
      actorEmail: scope.email ?? null,
      summary: `Could not revoke TikTok Ads for ${brand}; kept the encrypted token for retry.`,
      metadata: { advertiserId: existing.advertiserId ?? null },
    });
    revalidatePath('/settings/tiktok');
    return;
  }

  await prisma.tikTokConnection.deleteMany({ where: { brand } });
  await logAdminAudit({
    action: 'tiktok_disconnected',
    entityType: 'tiktok_connection',
    entityId: existing?.id ?? null,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Disconnected TikTok Ads for ${brand}.`,
    metadata: {
      advertiserId: existing?.advertiserId ?? null,
      revocationStatus: 'revoked',
    },
  });
  revalidatePath('/settings/tiktok');
}

export async function forceDisconnectTikTokAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const existing = await prisma.tikTokConnection.findUnique({ where: { brand } });
  await prisma.tikTokConnection.deleteMany({ where: { brand } });
  await logAdminAudit({
    action: 'tiktok_local_credentials_removed',
    entityType: 'tiktok_connection',
    entityId: existing?.id ?? null,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Removed the local TikTok credential for ${brand} without confirmed remote revocation.`,
    metadata: {
      advertiserId: existing?.advertiserId ?? null,
      remoteRevocationConfirmed: false,
    },
  });
  revalidatePath('/settings/tiktok');
}
