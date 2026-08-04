const DEFAULT_AUTHORIZATION_URL = 'https://ads.tiktok.com/marketing_api/auth';
const DEFAULT_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

type FetchLike = typeof fetch;

interface TikTokEnvelope<T> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

export interface TikTokTokenResult {
  accessToken: string;
  advertiserIds: string[];
  scopes: string[];
  requestId: string | null;
}

export interface TikTokAdvertiser {
  advertiserId: string;
  advertiserName: string | null;
}

interface BuildAuthorizationUrlInput {
  appId: string;
  redirectUri: string;
  state: string;
  scope?: string | null;
  authorizationUrl?: string;
}

interface ExchangeAuthorizationCodeInput {
  appId: string;
  appSecret: string;
  authorizationCode: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface ListAdvertisersInput {
  appId: string;
  appSecret: string;
  accessToken: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

type RevokeAccessTokenInput = ListAdvertisersInput;

export class TikTokApiError extends Error {
  readonly code: number | null;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: { code?: number | null; status?: number | null; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = 'TikTokApiError';
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

function requireValue(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function normalizeApiBaseUrl(value?: string): string {
  const baseUrl = (value?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('TikTok API base URL must use HTTPS.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function parseEnvelope<T>(response: Response): Promise<TikTokEnvelope<T>> {
  try {
    return await response.json() as TikTokEnvelope<T>;
  } catch {
    throw new TikTokApiError('TikTok returned an unreadable response.', {
      status: response.status,
    });
  }
}

function assertSuccessfulEnvelope<T>(
  response: Response,
  envelope: TikTokEnvelope<T>,
  operation: string,
): T {
  if (!response.ok || envelope.code !== 0 || !envelope.data) {
    throw new TikTokApiError(
      `${operation} failed${typeof envelope.code === 'number' ? ` (TikTok code ${envelope.code})` : ''}.`,
      {
        code: typeof envelope.code === 'number' ? envelope.code : null,
        status: response.status,
        requestId: envelope.request_id ?? null,
      },
    );
  }
  return envelope.data;
}

async function safeFetch(
  fetchImpl: FetchLike,
  input: string | URL,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetchImpl(input, {
      ...init,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TikTokApiError(`${operation} could not reach TikTok.`);
  }
}

export function buildTikTokAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const authorizationUrl = new URL(input.authorizationUrl?.trim() || DEFAULT_AUTHORIZATION_URL);
  if (authorizationUrl.protocol !== 'https:') {
    throw new Error('TikTok authorization URL must use HTTPS.');
  }

  const redirectUri = new URL(requireValue(input.redirectUri, 'TikTok redirect URI'));
  if (redirectUri.protocol !== 'https:' && redirectUri.hostname !== 'localhost') {
    throw new Error('TikTok redirect URI must use HTTPS.');
  }

  authorizationUrl.searchParams.set('app_id', requireValue(input.appId, 'TikTok App ID'));
  authorizationUrl.searchParams.set('state', requireValue(input.state, 'TikTok OAuth state'));
  authorizationUrl.searchParams.set('redirect_uri', redirectUri.toString());
  if (input.scope?.trim()) {
    authorizationUrl.searchParams.set('scope', input.scope.trim());
  }

  return authorizationUrl.toString();
}

export async function exchangeTikTokAuthorizationCode(
  input: ExchangeAuthorizationCodeInput,
): Promise<TikTokTokenResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = `${normalizeApiBaseUrl(input.apiBaseUrl)}/oauth2/access_token/`;
  const response = await safeFetch(fetchImpl, endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: requireValue(input.appId, 'TikTok App ID'),
      secret: requireValue(input.appSecret, 'TikTok App Secret'),
      auth_code: requireValue(input.authorizationCode, 'TikTok authorization code'),
    }),
  }, 'TikTok token exchange');
  const envelope = await parseEnvelope<{
    access_token?: string;
    advertiser_ids?: Array<string | number>;
    scope?: Array<string | number>;
  }>(response);
  const data = assertSuccessfulEnvelope(response, envelope, 'TikTok token exchange');
  const accessToken = data.access_token?.trim();
  if (!accessToken) {
    throw new TikTokApiError('TikTok token exchange returned no access token.', {
      status: response.status,
      requestId: envelope.request_id ?? null,
    });
  }

  return {
    accessToken,
    advertiserIds: Array.from(new Set((data.advertiser_ids ?? []).map(String).filter(Boolean))),
    scopes: Array.from(new Set((data.scope ?? []).map(String).filter(Boolean))),
    requestId: envelope.request_id ?? null,
  };
}

export async function listTikTokAdvertisers(
  input: ListAdvertisersInput,
): Promise<{ advertisers: TikTokAdvertiser[]; requestId: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = new URL(`${normalizeApiBaseUrl(input.apiBaseUrl)}/oauth2/advertiser/get/`);
  endpoint.searchParams.set('app_id', requireValue(input.appId, 'TikTok App ID'));
  endpoint.searchParams.set('secret', requireValue(input.appSecret, 'TikTok App Secret'));

  const response = await safeFetch(fetchImpl, endpoint, {
    method: 'GET',
    headers: {
      'Access-Token': requireValue(input.accessToken, 'TikTok access token'),
    },
  }, 'TikTok advertiser lookup');
  const envelope = await parseEnvelope<{
    list?: Array<{
      advertiser_id?: string | number;
      advertiser_name?: string;
    }>;
  }>(response);
  const data = assertSuccessfulEnvelope(response, envelope, 'TikTok advertiser lookup');
  const advertisers = (data.list ?? [])
    .map((advertiser) => ({
      advertiserId: String(advertiser.advertiser_id ?? '').trim(),
      advertiserName: advertiser.advertiser_name?.trim() || null,
    }))
    .filter((advertiser) => Boolean(advertiser.advertiserId));

  return {
    advertisers,
    requestId: envelope.request_id ?? null,
  };
}

export async function revokeTikTokAccessToken(
  input: RevokeAccessTokenInput,
): Promise<{ advertiserIds: string[]; requestId: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = `${normalizeApiBaseUrl(input.apiBaseUrl)}/oauth2/revoke_token/`;
  const appId = requireValue(input.appId, 'TikTok App ID');
  const appSecret = requireValue(input.appSecret, 'TikTok App Secret');
  const accessToken = requireValue(input.accessToken, 'TikTok access token');
  const response = await safeFetch(fetchImpl, endpoint, {
    method: 'POST',
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId,
      secret: appSecret,
      access_token: accessToken,
    }),
  }, 'TikTok token revocation');
  const envelope = await parseEnvelope<{
    advertiser_ids?: Array<string | number>;
  }>(response);
  const data = assertSuccessfulEnvelope(response, envelope, 'TikTok token revocation');

  return {
    advertiserIds: Array.from(new Set((data.advertiser_ids ?? []).map(String).filter(Boolean))),
    requestId: envelope.request_id ?? null,
  };
}
