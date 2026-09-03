'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
import {
  configureTikTokAccountWebhook,
  revokeTikTokAccountAccessToken,
} from '@/lib/tiktok-account-api';
import {
  getTikTokAccountConfigStatus,
  getTikTokAccountRuntimeConfig,
  getTikTokWebhookCallbackUrl,
} from '@/lib/tiktok-account-config';
import {
  hasTikTokDmPermissions,
  parseTikTokAccountScopes,
  resolveTikTokAccountConnection,
  TIKTOK_ACCOUNT_REVOCATION_PENDING_MESSAGE,
} from '@/lib/tiktok-account-connection';
import { getPublicAssetUrl } from '@/lib/runtime-config';
import {
  addTikTokUrlPrefix,
  listTikTokUrlProperties,
  verifyTikTokUrlPrefix,
} from '@/lib/tiktok-url-property';

function readRequiredText(formData: FormData, key: string, label: string): string {
  const value = formData.get(key);
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

async function requireTikTokBrandAccess(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const brand = readRequiredText(formData, 'brand', 'Brand');
  assertBrandAccess(scope, brand, 'TikTok connection');
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

export async function disconnectTikTokAccountAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const existing = await prisma.tikTokAccountConnection.findUnique({ where: { brand } });
  if (!existing) {
    revalidatePath('/settings/tiktok');
    return;
  }

  await prisma.tikTokAccountConnection.update({
    where: { id: existing.id },
    data: { dmAutoReplyEnabled: false },
  });

  if (existing.refreshTokenExpiresAt <= new Date()) {
    await prisma.tikTokAccountConnection.delete({ where: { id: existing.id } });
    await logAdminAudit({
      action: 'tiktok_account_disconnected',
      entityType: 'tiktok_account_connection',
      entityId: existing.id,
      brand,
      actorEmail: scope.email ?? null,
      summary: `Removed expired TikTok Business Account authorization for ${brand}.`,
      metadata: { openId: existing.openId, revocationStatus: 'authorization_expired' },
    });
    revalidatePath('/settings/tiktok');
    return;
  }

  try {
    const config = getTikTokAccountRuntimeConfig();
    const connection = await resolveTikTokAccountConnection(brand);
    if (!connection) throw new Error('TikTok Business Account is not connected.');
    await revokeTikTokAccountAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: connection.accessToken,
      apiBaseUrl: config.apiBaseUrl,
    });
  } catch {
    await prisma.tikTokAccountConnection.update({
      where: { brand },
      data: {
        dmAutoReplyEnabled: false,
        lastError: TIKTOK_ACCOUNT_REVOCATION_PENDING_MESSAGE,
      },
    });
    await logAdminAudit({
      action: 'tiktok_account_disconnect_failed',
      entityType: 'tiktok_account_connection',
      entityId: existing.id,
      brand,
      actorEmail: scope.email ?? null,
      summary: `Could not revoke TikTok Business Account for ${brand}; kept encrypted tokens for retry.`,
      metadata: { openId: existing.openId },
    });
    revalidatePath('/settings/tiktok');
    return;
  }

  await prisma.tikTokAccountConnection.delete({ where: { id: existing.id } });
  await logAdminAudit({
    action: 'tiktok_account_disconnected',
    entityType: 'tiktok_account_connection',
    entityId: existing.id,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Disconnected TikTok Business Account for ${brand}.`,
    metadata: { openId: existing.openId, revocationStatus: 'revoked' },
  });
  revalidatePath('/settings/tiktok');
}

export async function forceDisconnectTikTokAccountAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const existing = await prisma.tikTokAccountConnection.findUnique({ where: { brand } });
  await prisma.tikTokAccountConnection.deleteMany({ where: { brand } });
  await logAdminAudit({
    action: 'tiktok_account_local_credentials_removed',
    entityType: 'tiktok_account_connection',
    entityId: existing?.id ?? null,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Removed local TikTok Business Account credentials for ${brand}.`,
    metadata: {
      openId: existing?.openId ?? null,
      remoteRevocationConfirmed: false,
    },
  });
  revalidatePath('/settings/tiktok');
}

export async function configureTikTokWebhooksAction(): Promise<void> {
  const scope = await requireActionPermission('settings:write');
  let configured = false;
  try {
    const config = getTikTokAccountRuntimeConfig();
    const callbackUrl = getTikTokWebhookCallbackUrl();
    await Promise.all([
      configureTikTokAccountWebhook({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        apiBaseUrl: config.apiBaseUrl,
        eventType: 'COMMENT',
        callbackUrl,
      }),
      configureTikTokAccountWebhook({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        apiBaseUrl: config.apiBaseUrl,
        eventType: 'DIRECT_MESSAGE',
        callbackUrl,
      }),
    ]);
    configured = true;
    await logAdminAudit({
      action: 'tiktok_webhooks_configured',
      entityType: 'tiktok_app',
      entityId: null,
      actorEmail: scope.email ?? null,
      summary: 'Configured TikTok comment and direct-message webhook subscriptions.',
      metadata: { callbackUrl, eventTypes: ['COMMENT', 'DIRECT_MESSAGE'] },
    });
  } catch {
    await logAdminAudit({
      action: 'tiktok_webhooks_configuration_failed',
      entityType: 'tiktok_app',
      entityId: null,
      actorEmail: scope.email ?? null,
      summary: 'Could not configure TikTok comment and direct-message webhooks.',
      metadata: { eventTypes: ['COMMENT', 'DIRECT_MESSAGE'] },
    });
  }
  revalidatePath('/settings/tiktok');
  redirect(`/settings/tiktok?${configured ? 'status=webhooks_configured' : 'error=webhook_configuration_failed'}`);
}

export async function verifyTikTokMediaUrlAction(): Promise<void> {
  const scope = await requireActionPermission('settings:write');
  const propertyUrl = getPublicAssetUrl('/api/content/creatives/');
  if (!propertyUrl) throw new Error('APP_BASE_URL is required for TikTok media verification.');

  let verified = false;
  try {
    const config = getTikTokAccountRuntimeConfig();
    const credentials = {
      appId: config.clientId,
      appSecret: config.clientSecret,
      apiBaseUrl: config.apiBaseUrl,
    };
    const existing = (await listTikTokUrlProperties(credentials))
      .find((property) => property.url === propertyUrl);
    const prepared = existing ?? await addTikTokUrlPrefix(credentials, propertyUrl);

    await prisma.tikTokUrlProperty.upsert({
      where: { url: propertyUrl },
      create: {
        url: propertyUrl,
        propertyType: prepared.propertyType,
        status: prepared.status,
        signature: prepared.signature,
        fileName: prepared.fileName,
        requestId: prepared.requestId,
        verifiedAt: prepared.status === 1 ? new Date() : null,
      },
      update: {
        propertyType: prepared.propertyType,
        status: prepared.status,
        signature: prepared.signature,
        fileName: prepared.fileName,
        requestId: prepared.requestId,
        verifiedAt: prepared.status === 1 ? new Date() : null,
      },
    });

    const checked = prepared.status === 1
      ? prepared
      : await verifyTikTokUrlPrefix(credentials, propertyUrl);
    verified = checked.status === 1;
    await prisma.tikTokUrlProperty.update({
      where: { url: propertyUrl },
      data: {
        status: checked.status,
        signature: checked.signature ?? prepared.signature,
        fileName: checked.fileName ?? prepared.fileName,
        requestId: checked.requestId,
        verifiedAt: verified ? new Date() : null,
      },
    });

    await logAdminAudit({
      action: verified ? 'tiktok_media_url_verified' : 'tiktok_media_url_verification_pending',
      entityType: 'tiktok_app',
      entityId: null,
      actorEmail: scope.email ?? null,
      summary: `${verified ? 'Verified' : 'Prepared'} TikTok Content Studio media URL ownership.`,
      metadata: { propertyUrl, propertyType: 2, status: checked.status },
    });
  } catch (error) {
    await logAdminAudit({
      action: 'tiktok_media_url_verification_failed',
      entityType: 'tiktok_app',
      entityId: null,
      actorEmail: scope.email ?? null,
      summary: 'Could not verify TikTok Content Studio media URL ownership.',
      metadata: {
        propertyUrl,
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
      },
    });
  }

  revalidatePath('/settings/tiktok');
  redirect(`/settings/tiktok?${verified ? 'status=media_url_verified' : 'error=media_url_verification_failed'}`);
}

export async function setTikTokDmAutomationAction(formData: FormData): Promise<void> {
  const { scope, brand } = await requireTikTokBrandAccess(formData);
  const enabled = readRequiredText(formData, 'enabled', 'DM automation state') === '1';
  if (enabled && !getTikTokAccountConfigStatus().dmAutoReplyEnabled) {
    throw new Error('Enable the server-side TikTok DM automation safety gate first.');
  }
  const existing = await prisma.tikTokAccountConnection.findUnique({ where: { brand } });
  if (!existing) throw new Error('TikTok Business Account is not connected for this brand.');
  if (enabled && !hasTikTokDmPermissions(parseTikTokAccountScopes(existing.grantedScopes))) {
    throw new Error('Reconnect TikTok after all Business Messaging permissions are approved.');
  }

  await prisma.tikTokAccountConnection.update({
    where: { brand },
    data: { dmAutoReplyEnabled: enabled },
  });
  await logAdminAudit({
    action: enabled ? 'tiktok_dm_automation_enabled' : 'tiktok_dm_automation_disabled',
    entityType: 'tiktok_account_connection',
    entityId: existing.id,
    brand,
    actorEmail: scope.email ?? null,
    summary: `${enabled ? 'Enabled' : 'Disabled'} TikTok DM chatbot for ${brand}.`,
    metadata: { openId: existing.openId, enabled },
  });
  revalidatePath('/settings/tiktok');
}
