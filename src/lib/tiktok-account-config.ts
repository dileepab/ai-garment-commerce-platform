const DEFAULT_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const TIKTOK_ACCOUNT_CALLBACK_PATH = '/api/integrations/tiktok/account/callback/';
const TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE = 'garmentos-tiktok-account-oauth-nonce';

export interface TikTokAccountConfigStatus {
  appCredentialsConfigured: boolean;
  tokenEncryptionConfigured: boolean;
  authorizationUrlConfigured: boolean;
  redirectUri: string | null;
  webhookCallbackUrl: string | null;
  webhookReady: boolean;
  readyForAuthorization: boolean;
  dmAutoReplyEnabled: boolean;
}

export interface TikTokAccountRuntimeConfig {
  clientId: string;
  clientSecret: string;
  tokenEncryptionKey: string;
  apiBaseUrl: string;
}

export interface TikTokAccountOAuthConfig extends TikTokAccountRuntimeConfig {
  authorizationUrl: string;
  redirectUri: string;
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
    || lowered.includes('paste_exact_')
    || lowered.includes('example.com')
  ) {
    return null;
  }
  return cleaned;
}

function parseHttpsUrl(value: string, label: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS.`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not include credentials.`);
  return parsed;
}

function resolveAuthorizationUrl(): string | null {
  const value = cleanConfiguredValue(process.env.TIKTOK_ACCOUNT_AUTHORIZATION_URL);
  if (!value) return null;
  try {
    const parsed = parseHttpsUrl(value, 'TikTok account authorization URL');
    if (parsed.hostname !== 'www.tiktok.com') return null;
    if (parsed.searchParams.has('client_secret')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveRedirectUri(): string | null {
  const value = cleanConfiguredValue(process.env.TIKTOK_ACCOUNT_REDIRECT_URI);
  if (!value) return null;
  try {
    const parsed = parseHttpsUrl(value, 'TikTok account redirect URI');
    if (
      parsed.port
      || parsed.search
      || parsed.hash
      || parsed.pathname !== TIKTOK_ACCOUNT_CALLBACK_PATH
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveWebhookCallbackUrl(): string | null {
  const explicit = cleanConfiguredValue(process.env.TIKTOK_WEBHOOK_CALLBACK_URL);
  const appBaseUrl = cleanConfiguredValue(process.env.APP_BASE_URL);
  const value = explicit || (appBaseUrl
    ? `${appBaseUrl.replace(/\/+$/, '')}/api/webhooks/tiktok`
    : null);
  if (!value) return null;
  try {
    const parsed = parseHttpsUrl(value, 'TikTok webhook callback URL');
    if (parsed.search || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function enabled(value?: string): boolean {
  return value?.trim() === '1';
}

function authorizationUrlMatchesApp(
  authorizationUrl: string | null,
  clientId: string | null,
  redirectUri: string | null,
): boolean {
  if (!authorizationUrl || !clientId || !redirectUri) return false;
  const parsed = new URL(authorizationUrl);
  const configuredClientId = parsed.searchParams.get('client_key')
    || parsed.searchParams.get('client_id');
  const configuredRedirect = parsed.searchParams.get('redirect_uri');
  return configuredClientId === clientId && configuredRedirect === redirectUri;
}

export function getTikTokAccountConfigStatus(): TikTokAccountConfigStatus {
  const clientId = cleanConfiguredValue(process.env.TIKTOK_APP_ID);
  const clientSecret = cleanConfiguredValue(process.env.TIKTOK_APP_SECRET);
  const encryptionKey = cleanConfiguredValue(process.env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  const authorizationUrl = resolveAuthorizationUrl();
  const redirectUri = resolveRedirectUri();
  const webhookCallbackUrl = resolveWebhookCallbackUrl();
  const appCredentialsConfigured = Boolean(clientId && clientSecret);
  const tokenEncryptionConfigured = Boolean(encryptionKey && encryptionKey.length >= 24);
  const authorizationUrlReady = authorizationUrlMatchesApp(
    authorizationUrl,
    clientId,
    redirectUri,
  );

  return {
    appCredentialsConfigured,
    tokenEncryptionConfigured,
    authorizationUrlConfigured: authorizationUrlReady,
    redirectUri,
    webhookCallbackUrl,
    webhookReady: Boolean(appCredentialsConfigured && webhookCallbackUrl),
    readyForAuthorization: Boolean(
      appCredentialsConfigured
      && tokenEncryptionConfigured
      && authorizationUrlReady
      && redirectUri,
    ),
    dmAutoReplyEnabled: enabled(process.env.TIKTOK_DM_AUTOREPLY_ENABLED),
  };
}

export function getTikTokWebhookCallbackUrl(): string {
  const value = resolveWebhookCallbackUrl();
  if (!value) throw new Error('TikTok webhook callback URL is not configured.');
  return value;
}

export function getTikTokAccountRuntimeConfig(): TikTokAccountRuntimeConfig {
  const clientId = cleanConfiguredValue(process.env.TIKTOK_APP_ID);
  const clientSecret = cleanConfiguredValue(process.env.TIKTOK_APP_SECRET);
  const encryptionKey = cleanConfiguredValue(process.env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  const tokenEncryptionKey = encryptionKey && encryptionKey.length >= 24 ? encryptionKey : null;
  const missing = [
    !clientId ? 'TIKTOK_APP_ID' : null,
    !clientSecret ? 'TIKTOK_APP_SECRET' : null,
    !tokenEncryptionKey ? 'TIKTOK_TOKEN_ENCRYPTION_KEY' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`TikTok Account integration is not configured. Missing: ${missing.join(', ')}.`);
  }

  const apiBase = parseHttpsUrl(
    cleanConfiguredValue(process.env.TIKTOK_API_BASE_URL) || DEFAULT_API_BASE_URL,
    'TikTok API base URL',
  );
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    tokenEncryptionKey: tokenEncryptionKey!,
    apiBaseUrl: apiBase.toString().replace(/\/+$/, ''),
  };
}

export function getTikTokAccountOAuthConfig(): TikTokAccountOAuthConfig {
  const runtime = getTikTokAccountRuntimeConfig();
  const authorizationUrl = resolveAuthorizationUrl();
  const redirectUri = resolveRedirectUri();
  const authorizationUrlReady = authorizationUrlMatchesApp(
    authorizationUrl,
    runtime.clientId,
    redirectUri,
  );
  const missing = [
    !authorizationUrlReady ? 'TIKTOK_ACCOUNT_AUTHORIZATION_URL' : null,
    !redirectUri ? 'TIKTOK_ACCOUNT_REDIRECT_URI' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`TikTok Account OAuth is not configured. Missing: ${missing.join(', ')}.`);
  }
  return {
    ...runtime,
    authorizationUrl: authorizationUrl!,
    redirectUri: redirectUri!,
  };
}

export function buildTikTokAccountAuthorizationUrl(
  authorizationUrl: string,
  state: string,
): string {
  const parsed = parseHttpsUrl(authorizationUrl, 'TikTok account authorization URL');
  if (parsed.hostname !== 'www.tiktok.com' || parsed.searchParams.has('client_secret')) {
    throw new Error('TikTok account authorization URL is invalid.');
  }
  const cleanedState = state.trim();
  if (!cleanedState) throw new Error('TikTok account authorization state is required.');
  parsed.searchParams.set('state', cleanedState);
  parsed.searchParams.set('disable_auto_auth', '1');
  return parsed.toString();
}

export {
  TIKTOK_ACCOUNT_CALLBACK_PATH,
  TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE,
};
