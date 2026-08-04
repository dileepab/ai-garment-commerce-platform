const DEFAULT_TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIKTOK_AUTHORIZATION_URL = 'https://ads.tiktok.com/marketing_api/auth';
const TIKTOK_CALLBACK_PATH = '/api/integrations/tiktok/callback';
const TIKTOK_OAUTH_NONCE_COOKIE = 'garmentos-tiktok-oauth-nonce';

export interface TikTokConfigStatus {
  appIdConfigured: boolean;
  appSecretConfigured: boolean;
  tokenEncryptionConfigured: boolean;
  redirectUri: string | null;
  ready: boolean;
}

export interface TikTokServerConfig {
  appId: string;
  appSecret: string;
  tokenEncryptionKey: string;
  redirectUri: string;
  authorizationUrl: string;
  apiBaseUrl: string;
  scope: string | null;
}

function cleanConfiguredValue(value?: string | null): string | null {
  const cleaned = value?.trim();
  if (!cleaned) return null;

  const lowered = cleaned.toLowerCase();
  if (
    lowered.includes('your_')
    || lowered.includes('your-')
    || lowered.includes('change_this')
    || lowered.includes('generate_with_')
    || lowered.includes('example.com')
  ) {
    return null;
  }
  return cleaned;
}

function normalizeHttpsUrl(value: string, label: string, allowLocalhost = false): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && !(allowLocalhost && parsed.hostname === 'localhost')) {
    throw new Error(`${label} must use HTTPS.`);
  }
  return parsed.toString();
}

function resolveRedirectUri(): string | null {
  const explicit = cleanConfiguredValue(process.env.TIKTOK_REDIRECT_URI);
  if (!explicit) return null;
  try {
    return normalizeHttpsUrl(explicit, 'TikTok redirect URI', true);
  } catch {
    return null;
  }
}

export function getTikTokConfigStatus(): TikTokConfigStatus {
  const appIdConfigured = Boolean(cleanConfiguredValue(process.env.TIKTOK_APP_ID));
  const appSecretConfigured = Boolean(cleanConfiguredValue(process.env.TIKTOK_APP_SECRET));
  const encryptionKey = cleanConfiguredValue(process.env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  const tokenEncryptionConfigured = Boolean(encryptionKey && encryptionKey.length >= 24);
  const redirectUri = resolveRedirectUri();

  return {
    appIdConfigured,
    appSecretConfigured,
    tokenEncryptionConfigured,
    redirectUri,
    ready: appIdConfigured && appSecretConfigured && tokenEncryptionConfigured && Boolean(redirectUri),
  };
}

export function getTikTokServerConfig(): TikTokServerConfig {
  const appId = cleanConfiguredValue(process.env.TIKTOK_APP_ID);
  const appSecret = cleanConfiguredValue(process.env.TIKTOK_APP_SECRET);
  const encryptionKey = cleanConfiguredValue(process.env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  const tokenEncryptionKey = encryptionKey && encryptionKey.length >= 24 ? encryptionKey : null;
  const redirectUri = resolveRedirectUri();
  const missing = [
    !appId ? 'TIKTOK_APP_ID' : null,
    !appSecret ? 'TIKTOK_APP_SECRET' : null,
    !tokenEncryptionKey ? 'TIKTOK_TOKEN_ENCRYPTION_KEY' : null,
    !redirectUri ? 'TIKTOK_REDIRECT_URI' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`TikTok integration is not configured. Missing: ${missing.join(', ')}.`);
  }

  return {
    appId: appId!,
    appSecret: appSecret!,
    tokenEncryptionKey: tokenEncryptionKey!,
    redirectUri: redirectUri!,
    authorizationUrl: normalizeHttpsUrl(
      cleanConfiguredValue(process.env.TIKTOK_AUTHORIZATION_URL) || DEFAULT_TIKTOK_AUTHORIZATION_URL,
      'TikTok authorization URL',
    ),
    apiBaseUrl: normalizeHttpsUrl(
      cleanConfiguredValue(process.env.TIKTOK_API_BASE_URL) || DEFAULT_TIKTOK_API_BASE_URL,
      'TikTok API base URL',
    ).replace(/\/+$/, ''),
    scope: cleanConfiguredValue(process.env.TIKTOK_OAUTH_SCOPE),
  };
}

export { TIKTOK_CALLBACK_PATH, TIKTOK_OAUTH_NONCE_COOKIE };
