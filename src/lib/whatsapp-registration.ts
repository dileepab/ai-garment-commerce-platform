const DEFAULT_META_GRAPH_VERSION = 'v22.0';
const PIN_PATTERN = /^\d{6}$/;
const PHONE_NUMBER_ID_PATTERN = /^\d+$/;

interface MetaRegistrationResponse {
  success?: boolean | string;
  error?: {
    message?: string;
    code?: string | number;
    type?: string;
  };
}

export interface WhatsAppRegistrationResult {
  ok: boolean;
  status: number;
  errorCode?: string | number;
  error?: string;
}

type FetchImplementation = typeof fetch;

export function isValidWhatsAppRegistrationPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function buildWhatsAppRegistrationUrl(
  phoneNumberId: string,
  graphVersion = process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION,
): string {
  if (!PHONE_NUMBER_ID_PATTERN.test(phoneNumberId)) {
    throw new Error('WhatsApp Phone Number ID must contain digits only.');
  }

  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error('Meta Graph version is invalid.');
  }

  return `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`;
}

export function buildWhatsAppSubscriptionUrl(
  businessAccountId: string,
  graphVersion = process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION,
): string {
  if (!PHONE_NUMBER_ID_PATTERN.test(businessAccountId)) {
    throw new Error('WhatsApp Business Account ID must contain digits only.');
  }

  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error('Meta Graph version is invalid.');
  }

  return `https://graph.facebook.com/${graphVersion}/${businessAccountId}/subscribed_apps`;
}

function parseMetaResponse(rawBody: string): MetaRegistrationResponse {
  if (!rawBody) return {};

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as MetaRegistrationResponse
      : {};
  } catch {
    return {};
  }
}

function sanitizeErrorMessage(
  value: unknown,
  secrets: string[],
  fallback: string,
): string {
  let message = typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback;

  for (const secret of secrets) {
    if (secret) {
      message = message.split(secret).join('[redacted]');
    }
  }

  message = message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return message.slice(0, 320);
}

export async function registerWhatsAppPhone(params: {
  phoneNumberId: string;
  accessToken: string;
  pin: string;
  graphVersion?: string;
  fetchImpl?: FetchImplementation;
}): Promise<WhatsAppRegistrationResult> {
  if (!isValidWhatsAppRegistrationPin(params.pin)) {
    return {
      ok: false,
      status: 0,
      error: 'Enter exactly six digits for the WhatsApp two-step PIN.',
    };
  }

  if (!params.accessToken.trim()) {
    return {
      ok: false,
      status: 0,
      error: 'WhatsApp system-user token is missing.',
    };
  }

  const url = buildWhatsAppRegistrationUrl(
    params.phoneNumberId,
    params.graphVersion,
  );
  const fetchImpl = params.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: params.pin,
      }),
    });
    const rawBody = await response.text();
    const data = parseMetaResponse(rawBody);
    const ok = response.ok && (data.success === true || data.success === 'true');

    return {
      ok,
      status: response.status,
      errorCode: data.error?.code,
      error: ok
        ? undefined
        : sanitizeErrorMessage(
            data.error?.message,
            [params.accessToken, params.pin],
            `Meta Graph returned ${response.status}.`,
          ),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : error,
        [params.accessToken, params.pin],
        'Could not reach Meta Graph.',
      ),
    };
  }
}

export async function subscribeWhatsAppBusinessAccount(params: {
  businessAccountId: string;
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: FetchImplementation;
}): Promise<WhatsAppRegistrationResult> {
  if (!params.accessToken.trim()) {
    return {
      ok: false,
      status: 0,
      error: 'WhatsApp system-user token is missing.',
    };
  }

  const url = buildWhatsAppSubscriptionUrl(
    params.businessAccountId,
    params.graphVersion,
  );
  const fetchImpl = params.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    });
    const rawBody = await response.text();
    const data = parseMetaResponse(rawBody);
    const ok = response.ok && (data.success === true || data.success === 'true');

    return {
      ok,
      status: response.status,
      errorCode: data.error?.code,
      error: ok
        ? undefined
        : sanitizeErrorMessage(
            data.error?.message,
            [params.accessToken],
            `Meta Graph returned ${response.status}.`,
          ),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : error,
        [params.accessToken],
        'Could not reach Meta Graph.',
      ),
    };
  }
}
