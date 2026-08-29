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

export type TikTokPrivacyLevel =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

export type TikTokPublishStatus =
  | 'PROCESSING_DOWNLOAD'
  | 'PUBLISH_COMPLETE'
  | 'FAILED'
  | 'SEND_TO_USER_INBOX';

export interface TikTokAccountRequestInput {
  accessToken: string;
  businessId: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface PublishTikTokPhotoInput extends TikTokAccountRequestInput {
  imageUrls: string[];
  caption: string;
  privacyLevel: TikTokPrivacyLevel;
  disableComment: boolean;
  isBrandOrganic: boolean;
  isBrandedContent: boolean;
  autoAddMusic?: boolean;
}

export interface TikTokPhotoPublishResult {
  shareId: string;
  requestId: string | null;
}

export interface GetTikTokPublishStatusInput extends TikTokAccountRequestInput {
  publishId: string;
}

export interface TikTokPublishStatusResult {
  status: TikTokPublishStatus;
  postIds: string[];
  reason: string | null;
  requestId: string | null;
}

export interface TikTokPostSettingsResult {
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSeconds: number;
  requestId: string | null;
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

const TIKTOK_PRIVACY_LEVELS = new Set<TikTokPrivacyLevel>([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
]);

const TIKTOK_PUBLISH_STATUSES = new Set<TikTokPublishStatus>([
  'PROCESSING_DOWNLOAD',
  'PUBLISH_COMPLETE',
  'FAILED',
  'SEND_TO_USER_INBOX',
]);

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function normalizePhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error('TikTok photo publish requires at least one HTTPS image URL.');
  }
  if (value.length > 35) throw new Error('TikTok photo publish supports at most 35 image URLs.');

  return value.map((item, index) => {
    const label = `TikTok photo image URL ${index + 1}`;
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${label} is required.`);
    }

    let parsed: URL;
    try {
      parsed = new URL(item.trim());
    } catch {
      throw new Error(`${label} must be a valid HTTPS URL.`);
    }
    if (
      parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.hash
    ) {
      throw new Error(`${label} must be a valid HTTPS URL without credentials or a fragment.`);
    }
    return parsed.toString();
  });
}

function normalizePhotoCaption(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('TikTok photo caption is required.');
  }
  const caption = value.trim();
  if (caption.length > 4_000) {
    throw new Error('TikTok photo caption must not exceed 4,000 UTF-16 code units.');
  }
  const mentionCount = Array.from(caption.matchAll(/(?:^|\s)@[\p{L}\p{N}._]+/gu)).length;
  if (mentionCount > 30) {
    throw new Error('TikTok photo caption must not include more than 30 mentions.');
  }
  return caption;
}

function normalizePrivacyLevel(value: unknown, label = 'TikTok privacy level'): TikTokPrivacyLevel {
  if (typeof value !== 'string' || !TIKTOK_PRIVACY_LEVELS.has(value as TikTokPrivacyLevel)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as TikTokPrivacyLevel;
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

function invalidResponse(
  response: Response,
  envelope: TikTokEnvelope<unknown>,
  operation: string,
): never {
  throw new TikTokAccountApiError(`${operation} returned incomplete data.`, {
    status: response.status,
    requestId: envelope.request_id ?? null,
  });
}

async function getTikTokAccountEnvelope<T>(
  input: TikTokAccountRequestInput,
  endpoint: string,
  query: Record<string, string>,
  operation: string,
): Promise<{ response: Response; envelope: TikTokEnvelope<T>; data: T | undefined }> {
  const url = new URL(`${normalizeApiBaseUrl(input.apiBaseUrl)}${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await safeFetch(
    input.fetchImpl ?? fetch,
    url.toString(),
    {
      method: 'GET',
      headers: {
        'Access-Token': requireValue(input.accessToken, 'TikTok access token'),
      },
    },
    operation,
  );
  const envelope = await parseEnvelope<T>(response);
  return {
    response,
    envelope,
    data: assertSuccessfulEnvelope(response, envelope, operation),
  };
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

export async function publishTikTokPhoto(
  input: PublishTikTokPhotoInput,
): Promise<TikTokPhotoPublishResult> {
  const postInfo: Record<string, unknown> = {
    caption: normalizePhotoCaption(input.caption),
    privacy_level: normalizePrivacyLevel(input.privacyLevel),
    disable_comment: requireBoolean(input.disableComment, 'TikTok disable-comment setting'),
    is_brand_organic: requireBoolean(input.isBrandOrganic, 'TikTok brand-organic setting'),
    is_branded_content: requireBoolean(input.isBrandedContent, 'TikTok branded-content setting'),
  };
  if (input.autoAddMusic !== undefined) {
    postInfo.auto_add_music = requireBoolean(input.autoAddMusic, 'TikTok auto-add-music setting');
  }

  const operation = 'TikTok photo publish';
  const response = await safeFetch(
    input.fetchImpl ?? fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/business/photo/publish/`,
    {
      method: 'POST',
      headers: {
        'Access-Token': requireValue(input.accessToken, 'TikTok access token'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_id: requireValue(input.businessId, 'TikTok Business Account ID'),
        photo_images: normalizePhotoUrls(input.imageUrls),
        post_info: postInfo,
      }),
    },
    operation,
  );
  const envelope = await parseEnvelope<{ share_id?: unknown }>(response);
  const data = assertSuccessfulEnvelope(response, envelope, operation);
  if (typeof data?.share_id !== 'string' || !data.share_id.trim()) {
    return invalidResponse(response, envelope, operation);
  }
  return {
    shareId: data.share_id.trim(),
    requestId: envelope.request_id ?? null,
  };
}

export async function getTikTokPostSettings(
  input: TikTokAccountRequestInput,
): Promise<TikTokPostSettingsResult> {
  const operation = 'TikTok post settings lookup';
  const { response, envelope, data } = await getTikTokAccountEnvelope<{
    privacy_level_options?: unknown;
    comment_disabled?: unknown;
    duet_disabled?: unknown;
    stitch_disabled?: unknown;
    max_video_post_duration_sec?: unknown;
  }>(
    input,
    '/business/video/settings/',
    { business_id: requireValue(input.businessId, 'TikTok Business Account ID') },
    operation,
  );
  if (
    !Array.isArray(data?.privacy_level_options)
    || !data.privacy_level_options.every(
      (value) => typeof value === 'string' && TIKTOK_PRIVACY_LEVELS.has(value as TikTokPrivacyLevel),
    )
    || typeof data.comment_disabled !== 'boolean'
    || typeof data.duet_disabled !== 'boolean'
    || typeof data.stitch_disabled !== 'boolean'
    || typeof data.max_video_post_duration_sec !== 'number'
    || !Number.isInteger(data.max_video_post_duration_sec)
    || data.max_video_post_duration_sec < 0
  ) {
    return invalidResponse(response, envelope, operation);
  }

  return {
    privacyLevelOptions: data.privacy_level_options as TikTokPrivacyLevel[],
    commentDisabled: data.comment_disabled,
    duetDisabled: data.duet_disabled,
    stitchDisabled: data.stitch_disabled,
    maxVideoPostDurationSeconds: data.max_video_post_duration_sec,
    requestId: envelope.request_id ?? null,
  };
}

export async function getTikTokPublishStatus(
  input: GetTikTokPublishStatusInput,
): Promise<TikTokPublishStatusResult> {
  const operation = 'TikTok publish status lookup';
  const { response, envelope, data } = await getTikTokAccountEnvelope<{
    status?: unknown;
    post_ids?: unknown;
    reason?: unknown;
  }>(
    input,
    '/business/publish/status/',
    {
      business_id: requireValue(input.businessId, 'TikTok Business Account ID'),
      publish_id: requireValue(input.publishId, 'TikTok publish ID'),
    },
    operation,
  );
  if (
    typeof data?.status !== 'string'
    || !TIKTOK_PUBLISH_STATUSES.has(data.status as TikTokPublishStatus)
  ) {
    return invalidResponse(response, envelope, operation);
  }

  let postIds: string[] = [];
  if (data.post_ids !== undefined && data.post_ids !== null) {
    if (
      !Array.isArray(data.post_ids)
      || !data.post_ids.every((value) => typeof value === 'string' && Boolean(value.trim()))
    ) {
      return invalidResponse(response, envelope, operation);
    }
    postIds = data.post_ids.map((value) => (value as string).trim());
  }

  let reason: string | null = null;
  if (data.reason !== undefined && data.reason !== null) {
    if (typeof data.reason !== 'string') return invalidResponse(response, envelope, operation);
    reason = data.reason.trim() || null;
  }

  return {
    status: data.status as TikTokPublishStatus,
    postIds,
    reason,
    requestId: envelope.request_id ?? null,
  };
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
