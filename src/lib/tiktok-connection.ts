import prisma from '@/lib/prisma';
import { decryptTikTokAccessToken, encryptTikTokAccessToken } from '@/lib/tiktok-security';
import { getTikTokServerConfig } from '@/lib/tiktok-config';

export interface TikTokConnectionView {
  brand: string;
  connected: boolean;
  advertiserId: string | null;
  advertiserName: string | null;
  grantedScopes: string[];
  authorizedAt: Date | null;
  lastVerifiedAt: Date | null;
  lastError: string | null;
}

export interface ResolvedTikTokConnection {
  id: number;
  brand: string;
  advertiserId: string | null;
  advertiserName: string | null;
  accessToken: string;
  grantedScopes: string[];
}

export const TIKTOK_REVOCATION_PENDING_MESSAGE =
  'TikTok token revocation failed. The encrypted token was kept so you can retry safely.';

function parseScopes(value?: string | null): string[] {
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

function serializeScopes(scopes: string[]): string | null {
  const normalized = Array.from(new Set(scopes.map(String).map((scope) => scope.trim()).filter(Boolean)));
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export async function getTikTokConnectionView(brand: string): Promise<TikTokConnectionView> {
  const record = await prisma.tikTokConnection.findUnique({
    where: { brand },
    select: {
      brand: true,
      advertiserId: true,
      advertiserName: true,
      grantedScopes: true,
      authorizedAt: true,
      lastVerifiedAt: true,
      lastError: true,
    },
  });

  if (!record) {
    return {
      brand,
      connected: false,
      advertiserId: null,
      advertiserName: null,
      grantedScopes: [],
      authorizedAt: null,
      lastVerifiedAt: null,
      lastError: null,
    };
  }

  return {
    ...record,
    connected: true,
    grantedScopes: parseScopes(record.grantedScopes),
  };
}

export async function resolveTikTokConnection(
  brand: string,
): Promise<ResolvedTikTokConnection | null> {
  const record = await prisma.tikTokConnection.findUnique({ where: { brand } });
  if (!record) return null;

  const config = getTikTokServerConfig();
  return {
    id: record.id,
    brand: record.brand,
    advertiserId: record.advertiserId,
    advertiserName: record.advertiserName,
    accessToken: decryptTikTokAccessToken(record.accessTokenEncrypted, config.tokenEncryptionKey),
    grantedScopes: parseScopes(record.grantedScopes),
  };
}

export async function saveTikTokConnection(input: {
  brand: string;
  accessToken: string;
  scopes: string[];
  advertiserId?: string | null;
  advertiserName?: string | null;
}) {
  const config = getTikTokServerConfig();
  const encryptedToken = encryptTikTokAccessToken(input.accessToken, config.tokenEncryptionKey);
  const advertiserId = input.advertiserId?.trim() || null;
  const advertiserName = input.advertiserName?.trim() || null;
  const data = {
    advertiserId,
    advertiserName,
    accessTokenEncrypted: encryptedToken,
    grantedScopes: serializeScopes(input.scopes),
    authorizedAt: new Date(),
    lastVerifiedAt: null,
    lastError: null,
  };

  return prisma.tikTokConnection.upsert({
    where: { brand: input.brand },
    create: { brand: input.brand, ...data },
    update: data,
  });
}
