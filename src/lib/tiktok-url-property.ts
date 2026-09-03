const DEFAULT_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

type FetchLike = typeof fetch;

interface TikTokEnvelope<T> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

export interface TikTokUrlPropertyInfo {
  url: string;
  propertyType: number;
  status: number;
  signature: string | null;
  fileName: string | null;
  requestId: string | null;
}

interface TikTokUrlPropertyCredentials {
  appId: string;
  appSecret: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

function required(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function normalizeApiBaseUrl(value?: string): string {
  const url = new URL((value?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, ''));
  if (url.protocol !== 'https:') throw new Error('TikTok API base URL must use HTTPS.');
  return url.toString().replace(/\/+$/, '');
}

function normalizePropertyUrl(value: string): string {
  const url = new URL(required(value, 'TikTok URL property'));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('TikTok URL property must be a clean HTTPS URL.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function apiError(operation: string, envelope: TikTokEnvelope<unknown>): Error {
  const detail = text(envelope.message);
  const code = integer(envelope.code);
  return new Error(`${operation} failed${code === null ? '' : ` (TikTok code ${code})`}${detail ? `: ${detail.slice(0, 300)}` : ''}.`);
}

async function request<T>(
  credentials: TikTokUrlPropertyCredentials,
  endpoint: string,
  init: RequestInit,
  operation: string,
): Promise<TikTokEnvelope<T>> {
  const response = await (credentials.fetchImpl ?? fetch)(
    `${normalizeApiBaseUrl(credentials.apiBaseUrl)}${endpoint}`,
    {
      ...init,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    },
  );
  let envelope: TikTokEnvelope<T>;
  try {
    envelope = await response.json() as TikTokEnvelope<T>;
  } catch {
    throw new Error(`${operation} returned an unreadable response.`);
  }
  if (!response.ok || envelope.code !== 0) throw apiError(operation, envelope);
  return envelope;
}

function parseInfo(value: unknown, requestId: string | null): TikTokUrlPropertyInfo {
  if (!value || typeof value !== 'object') {
    throw new Error('TikTok URL property response returned incomplete data.');
  }
  const record = value as Record<string, unknown>;
  const url = text(record.url);
  const propertyType = integer(record.property_type);
  const status = integer(record.property_status);
  if (!url || propertyType === null || status === null) {
    throw new Error('TikTok URL property response returned incomplete data.');
  }
  return {
    url,
    propertyType,
    status,
    signature: text(record.signature),
    fileName: text(record.file_name),
    requestId,
  };
}

function credentialsBody(credentials: TikTokUrlPropertyCredentials) {
  return {
    app_id: required(credentials.appId, 'TikTok app ID'),
    secret: required(credentials.appSecret, 'TikTok app secret'),
  };
}

export async function listTikTokUrlProperties(
  credentials: TikTokUrlPropertyCredentials,
): Promise<TikTokUrlPropertyInfo[]> {
  const query = new URLSearchParams(credentialsBody(credentials));
  const envelope = await request<{ url_property_info_list?: unknown }>(
    credentials,
    `/business/property/list/?${query.toString()}`,
    { method: 'GET' },
    'TikTok URL property lookup',
  );
  const list = envelope.data?.url_property_info_list;
  if (!Array.isArray(list)) return [];
  return list.map((item) => parseInfo(item, envelope.request_id ?? null));
}

export async function addTikTokUrlPrefix(
  credentials: TikTokUrlPropertyCredentials,
  propertyUrl: string,
): Promise<TikTokUrlPropertyInfo> {
  const url = normalizePropertyUrl(propertyUrl);
  const envelope = await request<{ url_property_info?: unknown }>(
    credentials,
    '/business/property/add/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...credentialsBody(credentials),
        url_property_meta: { property_type: 2, url },
      }),
    },
    'TikTok URL property creation',
  );
  return parseInfo(envelope.data?.url_property_info, envelope.request_id ?? null);
}

export async function verifyTikTokUrlPrefix(
  credentials: TikTokUrlPropertyCredentials,
  propertyUrl: string,
): Promise<TikTokUrlPropertyInfo> {
  const url = normalizePropertyUrl(propertyUrl);
  const envelope = await request<{ url_property_info?: unknown }>(
    credentials,
    '/business/property/verify/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...credentialsBody(credentials),
        url_property_meta: { property_type: 2, url },
      }),
    },
    'TikTok URL property verification',
  );
  return parseInfo(envelope.data?.url_property_info, envelope.request_id ?? null);
}
