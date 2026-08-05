const DEFAULT_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

type FetchLike = typeof fetch;

interface TikTokEnvelope<T = Record<string, unknown>> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

export interface TikTokAccountTokenResult {
  accessToken: string;
  refreshToken: string;
  openId: string | null;
  scopes: string[];
  expiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
  requestId: string | null;
}

export interface TikTokAccountSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
  requestId?: string | null;
}

interface TikTokAccountCredentials {
  clientId: string;
  clientSecret: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface ExchangeTokenInput extends TikTokAccountCredentials {
  authorizationCode: string;
  redirectUri: string;
}

interface RefreshTokenInput extends TikTokAccountCredentials {
  refreshToken: string;
}

interface RevokeTokenInput extends TikTokAccountCredentials {
  accessToken: string;
}

interface SendCommentReplyInput {
  accessToken: string;
  businessId: string;
  videoId: string;
  commentId: string;
  text: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface SendDirectMessageInput {
  accessToken: string;
  businessId: string;
  conversationId: string;
  text: string;
  referencedMessageId?: string | null;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface ConfigureWebhookInput extends TikTokAccountCredentials {
  eventType: 'COMMENT' | 'DIRECT_MESSAGE';
  callbackUrl: string;
}

export class TikTokAccountApiError extends Error {
  readonly code: number | null;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: { code?: number | null; status?: number | null; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = 'TikTokAccountApiError';
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
  const parsed = new URL((value?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, ''));
  if (parsed.protocol !== 'https:') throw new Error('TikTok API base URL must use HTTPS.');
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeScopes(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  return Array.from(new Set(values.map(String).map((scope) => scope.trim()).filter(Boolean)));
}

function positiveSeconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

async function safeFetch(
  fetchImpl: FetchLike,
  endpoint: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetchImpl(endpoint, {
      ...init,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TikTokAccountApiError(`${operation} could not reach TikTok.`);
  }
}

async function parseEnvelope<T>(response: Response): Promise<TikTokEnvelope<T>> {
  try {
    return await response.json() as TikTokEnvelope<T>;
  } catch {
    throw new TikTokAccountApiError('TikTok returned an unreadable response.', {
      status: response.status,
    });
  }
}

function assertSuccessfulEnvelope<T>(
  response: Response,
  envelope: TikTokEnvelope<T>,
  operation: string,
): T | undefined {
  if (!response.ok || envelope.code !== 0) {
    throw new TikTokAccountApiError(
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

function parseTokenResult(
  response: Response,
  envelope: TikTokEnvelope<{
    access_token?: string;
    refresh_token?: string;
    open_id?: string;
    scope?: string | string[];
    expires_in?: number;
    refresh_token_expires_in?: number;
  }>,
  operation: string,
): TikTokAccountTokenResult {
  const data = assertSuccessfulEnvelope(response, envelope, operation);
  const accessToken = data?.access_token?.trim();
  const refreshToken = data?.refresh_token?.trim();
  if (!accessToken || !refreshToken || data?.scope === undefined || data.scope === null) {
    throw new TikTokAccountApiError(`${operation} returned incomplete credentials.`, {
      status: response.status,
      requestId: envelope.request_id ?? null,
    });
  }

  return {
    accessToken,
    refreshToken,
    openId: data?.open_id?.trim() || null,
    scopes: normalizeScopes(data?.scope),
    expiresInSeconds: positiveSeconds(data?.expires_in, 86_400),
    refreshTokenExpiresInSeconds: positiveSeconds(
      data?.refresh_token_expires_in,
      365 * 24 * 60 * 60,
    ),
    requestId: envelope.request_id ?? null,
  };
}

export async function exchangeTikTokAccountAuthorizationCode(
  input: ExchangeTokenInput,
): Promise<TikTokAccountTokenResult> {
  const response = await safeFetch(
    input.fetchImpl ?? fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/tt_user/oauth2/token/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: requireValue(input.clientId, 'TikTok client ID'),
        client_secret: requireValue(input.clientSecret, 'TikTok client secret'),
        grant_type: 'authorization_code',
        auth_code: requireValue(input.authorizationCode, 'TikTok authorization code'),
        redirect_uri: requireValue(input.redirectUri, 'TikTok account redirect URI'),
      }),
    },
    'TikTok account token exchange',
  );
  return parseTokenResult(response, await parseEnvelope(response), 'TikTok account token exchange');
}

export async function refreshTikTokAccountAccessToken(
  input: RefreshTokenInput,
): Promise<TikTokAccountTokenResult> {
  const response = await safeFetch(
    input.fetchImpl ?? fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/tt_user/oauth2/refresh_token/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: requireValue(input.clientId, 'TikTok client ID'),
        client_secret: requireValue(input.clientSecret, 'TikTok client secret'),
        grant_type: 'refresh_token',
        refresh_token: requireValue(input.refreshToken, 'TikTok refresh token'),
      }),
    },
    'TikTok account token refresh',
  );
  return parseTokenResult(response, await parseEnvelope(response), 'TikTok account token refresh');
}

export async function revokeTikTokAccountAccessToken(input: RevokeTokenInput): Promise<void> {
  const response = await safeFetch(
    input.fetchImpl ?? fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/tt_user/oauth2/revoke/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: requireValue(input.clientId, 'TikTok client ID'),
        client_secret: requireValue(input.clientSecret, 'TikTok client secret'),
        access_token: requireValue(input.accessToken, 'TikTok access token'),
      }),
    },
    'TikTok account token revocation',
  );
  assertSuccessfulEnvelope(response, await parseEnvelope(response), 'TikTok account token revocation');
}

export async function configureTikTokAccountWebhook(
  input: ConfigureWebhookInput,
): Promise<{ requestId: string | null }> {
  const callbackUrl = new URL(requireValue(input.callbackUrl, 'TikTok webhook callback URL'));
  if (callbackUrl.protocol !== 'https:') {
    throw new Error('TikTok webhook callback URL must use HTTPS.');
  }
  const response = await safeFetch(
    input.fetchImpl ?? fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/business/webhook/update/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: requireValue(input.clientId, 'TikTok client ID'),
        secret: requireValue(input.clientSecret, 'TikTok client secret'),
        event_type: input.eventType,
        callback_url: callbackUrl.toString(),
      }),
    },
    `TikTok ${input.eventType} webhook configuration`,
  );
  const envelope = await parseEnvelope(response);
  assertSuccessfulEnvelope(
    response,
    envelope,
    `TikTok ${input.eventType} webhook configuration`,
  );
  return { requestId: envelope.request_id ?? null };
}

function clampCommentReply(text: string): string {
  return Array.from(requireValue(text, 'TikTok comment reply')).slice(0, 1_200).join('');
}

function clampDirectMessage(text: string): string {
  return Array.from(requireValue(text, 'TikTok direct message')).slice(0, 6_000).join('');
}

async function sendTikTokAccountPayload(
  endpoint: string,
  accessToken: string,
  payload: Record<string, unknown>,
  operation: string,
  apiBaseUrl?: string,
  fetchImpl?: FetchLike,
): Promise<TikTokAccountSendResult> {
  try {
    const response = await safeFetch(
      fetchImpl ?? fetch,
      `${normalizeApiBaseUrl(apiBaseUrl)}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Access-Token': requireValue(accessToken, 'TikTok access token'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      operation,
    );
    const envelope = await parseEnvelope(response);
    const data = assertSuccessfulEnvelope(response, envelope, operation);
    return {
      ok: true,
      status: response.status,
      data,
      requestId: envelope.request_id ?? null,
    };
  } catch (error) {
    if (error instanceof TikTokAccountApiError) {
      return {
        ok: false,
        status: error.status ?? undefined,
        error: error.message,
        requestId: error.requestId,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : `${operation} failed.`,
    };
  }
}

export async function sendTikTokDirectMessage(
  input: SendDirectMessageInput,
): Promise<TikTokAccountSendResult> {
  const referencedMessageId = input.referencedMessageId?.trim();
  return sendTikTokAccountPayload(
    '/business/message/send/',
    input.accessToken,
    {
      business_id: requireValue(input.businessId, 'TikTok Business Account ID'),
      recipient_type: 'CONVERSATION',
      recipient: requireValue(input.conversationId, 'TikTok conversation ID'),
      message_type: 'TEXT',
      text: { body: clampDirectMessage(input.text) },
      ...(referencedMessageId
        ? { referenced_message_info: { referenced_message_id: referencedMessageId } }
        : {}),
    },
    'TikTok direct message',
    input.apiBaseUrl,
    input.fetchImpl,
  );
}

export async function sendTikTokCommentReply(
  input: SendCommentReplyInput,
): Promise<TikTokAccountSendResult> {
  return sendTikTokAccountPayload(
    '/business/comment/reply/create/',
    input.accessToken,
    {
      business_id: requireValue(input.businessId, 'TikTok Business Account ID'),
      video_id: requireValue(input.videoId, 'TikTok video ID'),
      comment_id: requireValue(input.commentId, 'TikTok comment ID'),
      text: clampCommentReply(input.text),
    },
    'TikTok comment reply',
    input.apiBaseUrl,
    input.fetchImpl,
  );
}
