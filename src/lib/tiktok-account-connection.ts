import prisma from '@/lib/prisma';
import {
  refreshTikTokAccountAccessToken,
  type TikTokAccountTokenResult,
} from '@/lib/tiktok-account-api';
import { getTikTokAccountRuntimeConfig } from '@/lib/tiktok-account-config';
import { decryptTikTokAccessToken, encryptTikTokAccessToken } from '@/lib/tiktok-security';

const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 5 * 60 * 1000;
const REFRESH_LEASE_MS = 30 * 1000;
const REFRESH_WAIT_ATTEMPTS = 12;
const REFRESH_WAIT_MS = 250;

export const TIKTOK_ACCOUNT_REVOCATION_PENDING_MESSAGE =
  'TikTok Account token revocation failed. The encrypted tokens were kept so you can retry safely.';

export const TIKTOK_DM_REQUIRED_SCOPES = [
  'message.list.read',
  'message.list.send',
  'message.list.manage',
  'user.account.type',
] as const;

export interface TikTokAccountConnectionView {
  brand: string;
  connected: boolean;
  openId: string | null;
  displayName: string | null;
  username: string | null;
  grantedScopes: string[];
  authorizedAt: Date | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  dmAutoReplyEnabled: boolean;
}

export interface ResolvedTikTokAccountConnection {
  id: number;
  brand: string;
  openId: string;
  displayName: string | null;
  username: string | null;
  accessToken: string;
  grantedScopes: string[];
}

type AccountRecord = Awaited<ReturnType<typeof prisma.tikTokAccountConnection.findUnique>>;

export function parseTikTokAccountScopes(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map(String).map((scope) => scope.trim()).filter(Boolean)))
      : [];
  } catch {
    return [];
  }
}

export function hasTikTokDmPermissions(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  return TIKTOK_DM_REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

function serializeScopes(scopes: string[]): string | null {
  const normalized = Array.from(new Set(scopes.map(String).map((scope) => scope.trim()).filter(Boolean)));
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function expiryFrom(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function saveTikTokAccountConnection(input: {
  brand: string;
  token: TikTokAccountTokenResult;
  displayName?: string | null;
  username?: string | null;
  now?: Date;
}) {
  const openId = input.token.openId?.trim();
  if (!openId) throw new Error('TikTok Account authorization returned no Business Account ID.');
  const config = getTikTokAccountRuntimeConfig();
  const now = input.now ?? new Date();
  const data = {
    openId,
    displayName: input.displayName?.trim() || null,
    username: input.username?.trim() || null,
    accessTokenEncrypted: encryptTikTokAccessToken(
      input.token.accessToken,
      config.tokenEncryptionKey,
    ),
    refreshTokenEncrypted: encryptTikTokAccessToken(
      input.token.refreshToken,
      config.tokenEncryptionKey,
    ),
    accessTokenExpiresAt: expiryFrom(now, input.token.expiresInSeconds),
    refreshTokenExpiresAt: expiryFrom(now, input.token.refreshTokenExpiresInSeconds),
    grantedScopes: serializeScopes(input.token.scopes),
    authorizedAt: now,
    lastVerifiedAt: now,
    lastError: null,
    refreshLeaseUntil: null,
  };

  return prisma.tikTokAccountConnection.upsert({
    where: { brand: input.brand },
    create: { brand: input.brand, ...data },
    update: data,
  });
}

async function resolveRecord(
  record: NonNullable<AccountRecord>,
  now = new Date(),
): Promise<ResolvedTikTokAccountConnection> {
  const config = getTikTokAccountRuntimeConfig();
  if (record.accessTokenExpiresAt.getTime() > now.getTime() + ACCESS_TOKEN_REFRESH_LEEWAY_MS) {
    return {
      id: record.id,
      brand: record.brand,
      openId: record.openId,
      displayName: record.displayName,
      username: record.username,
      accessToken: decryptTikTokAccessToken(record.accessTokenEncrypted, config.tokenEncryptionKey),
      grantedScopes: parseTikTokAccountScopes(record.grantedScopes),
    };
  }

  if (record.refreshTokenExpiresAt <= now) {
    await prisma.tikTokAccountConnection.update({
      where: { id: record.id },
      data: { lastError: 'TikTok Account authorization expired. Reconnect this brand.' },
    });
    throw new Error('TikTok Account authorization expired. Reconnect this brand.');
  }

  const leaseUntil = new Date(now.getTime() + REFRESH_LEASE_MS);
  const acquired = await prisma.tikTokAccountConnection.updateMany({
    where: {
      id: record.id,
      refreshTokenEncrypted: record.refreshTokenEncrypted,
      OR: [
        { refreshLeaseUntil: null },
        { refreshLeaseUntil: { lte: now } },
      ],
    },
    data: { refreshLeaseUntil: leaseUntil },
  });
  if (acquired.count === 0) {
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt += 1) {
      await delay(REFRESH_WAIT_MS);
      const winner = await prisma.tikTokAccountConnection.findUnique({ where: { id: record.id } });
      if (!winner) return Promise.reject(new Error('TikTok Business Account was disconnected.'));
      const checkedAt = new Date();
      if (
        winner.accessTokenExpiresAt.getTime()
        > checkedAt.getTime() + ACCESS_TOKEN_REFRESH_LEEWAY_MS
      ) {
        return resolveRecord(winner, checkedAt);
      }
      if (!winner.refreshLeaseUntil || winner.refreshLeaseUntil <= checkedAt) {
        return resolveRecord(winner, checkedAt);
      }
    }
    throw new Error('TikTok Account token refresh is already in progress. Try again shortly.');
  }

  try {
    const refreshed = await refreshTikTokAccountAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: decryptTikTokAccessToken(
        record.refreshTokenEncrypted,
        config.tokenEncryptionKey,
      ),
      apiBaseUrl: config.apiBaseUrl,
    });
    if (refreshed.openId && refreshed.openId !== record.openId) {
      throw new Error('TikTok refreshed a different Business Account identity.');
    }

    const scopes = refreshed.scopes;
    const refreshedAt = new Date();
    const persisted = await prisma.tikTokAccountConnection.updateMany({
      where: {
        id: record.id,
        refreshTokenEncrypted: record.refreshTokenEncrypted,
        refreshLeaseUntil: leaseUntil,
      },
      data: {
        accessTokenEncrypted: encryptTikTokAccessToken(
          refreshed.accessToken,
          config.tokenEncryptionKey,
        ),
        refreshTokenEncrypted: encryptTikTokAccessToken(
          refreshed.refreshToken,
          config.tokenEncryptionKey,
        ),
        accessTokenExpiresAt: expiryFrom(refreshedAt, refreshed.expiresInSeconds),
        refreshTokenExpiresAt: expiryFrom(refreshedAt, refreshed.refreshTokenExpiresInSeconds),
        grantedScopes: serializeScopes(scopes),
        lastVerifiedAt: refreshedAt,
        lastError: null,
        refreshLeaseUntil: null,
      },
    });
    if (persisted.count !== 1) {
      const winner = await prisma.tikTokAccountConnection.findUnique({ where: { id: record.id } });
      if (winner) return resolveRecord(winner, new Date());
      throw new Error('TikTok Business Account was disconnected during token refresh.');
    }

    return {
      id: record.id,
      brand: record.brand,
      openId: record.openId,
      displayName: record.displayName,
      username: record.username,
      accessToken: refreshed.accessToken,
      grantedScopes: scopes,
    };
  } catch {
    await prisma.tikTokAccountConnection.updateMany({
      where: {
        id: record.id,
        refreshTokenEncrypted: record.refreshTokenEncrypted,
        refreshLeaseUntil: leaseUntil,
      },
      data: {
        refreshLeaseUntil: null,
        lastError: 'TikTok Account token refresh failed. Reconnect or try again.',
      },
    });
    throw new Error('TikTok Account token refresh failed. Reconnect or try again.');
  }
}

export async function resolveTikTokAccountConnection(
  brand: string,
): Promise<ResolvedTikTokAccountConnection | null> {
  const record = await prisma.tikTokAccountConnection.findUnique({ where: { brand } });
  return record ? resolveRecord(record) : null;
}

export async function resolveTikTokAccountConnectionByOpenId(
  openId: string,
): Promise<ResolvedTikTokAccountConnection | null> {
  const record = await prisma.tikTokAccountConnection.findUnique({ where: { openId } });
  return record ? resolveRecord(record) : null;
}

export async function getTikTokAccountConnectionView(
  brand: string,
): Promise<TikTokAccountConnectionView> {
  const record = await prisma.tikTokAccountConnection.findUnique({
    where: { brand },
    select: {
      brand: true,
      openId: true,
      displayName: true,
      username: true,
      grantedScopes: true,
      authorizedAt: true,
      accessTokenExpiresAt: true,
      refreshTokenExpiresAt: true,
      lastVerifiedAt: true,
      lastError: true,
      dmAutoReplyEnabled: true,
    },
  });
  if (!record) {
    return {
      brand,
      connected: false,
      openId: null,
      displayName: null,
      username: null,
      grantedScopes: [],
      authorizedAt: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      lastVerifiedAt: null,
      lastError: null,
      dmAutoReplyEnabled: false,
    };
  }
  return {
    ...record,
    connected: true,
    grantedScopes: parseTikTokAccountScopes(record.grantedScopes),
  };
}
