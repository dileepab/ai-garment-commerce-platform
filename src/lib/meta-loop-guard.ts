type EnvSource = Record<string, string | undefined>;

export type MetaBusinessLoopSkipReason =
  | 'configured_business_account'
  | 'configured_internal_sender'
  | 'managed_autoreply_greeting'
  | 'managed_autoreply_fallback';

export type InstagramBusinessLoopSkipReason = MetaBusinessLoopSkipReason;
export type MessengerBusinessLoopSkipReason = MetaBusinessLoopSkipReason;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitIdentifierList(value?: string): string[] {
  return (value ?? '')
    .split(/[\s,;]+/)
    .map((item) => cleanOptionalText(item))
    .filter((item): item is string => Boolean(item));
}

function brandEnvKey(brand?: string | null): string | null {
  const key = cleanOptionalText(brand)?.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return key || null;
}

function brandEnvKeys(brand?: string | null): string[] {
  const key = brandEnvKey(brand);
  if (!key) return [];

  const keys = new Set([key]);
  if (key === 'HAPPYBUY' || key === 'HAPPYBY' || key === 'HAPPY_BUY') {
    keys.add('HAPPYBUY');
    keys.add('HAPPYBY');
    keys.add('HAPPY_BUY');
  }

  return [...keys];
}

export function getWebhookSenderId(webhookEvent: Record<string, unknown>): string | null {
  const sender = webhookEvent.sender;
  if (isRecord(sender) && typeof sender.id === 'string') {
    return cleanOptionalText(sender.id);
  }

  return null;
}

export function getWebhookMessageTextForLoopGuard(webhookEvent: Record<string, unknown>): string | null {
  const message = webhookEvent.message;
  if (isRecord(message)) {
    const quickReply = message.quick_reply;
    const quickReplyPayload = isRecord(quickReply) && typeof quickReply.payload === 'string'
      ? cleanOptionalText(quickReply.payload)
      : null;
    return quickReplyPayload ?? (typeof message.text === 'string' ? cleanOptionalText(message.text) : null);
  }

  const postback = webhookEvent.postback;
  if (isRecord(postback)) {
    return typeof postback.payload === 'string'
      ? cleanOptionalText(postback.payload)
      : typeof postback.title === 'string'
        ? cleanOptionalText(postback.title)
        : null;
  }

  return null;
}

export function isManagedMetaAutoReplyText(messageText?: string | null): boolean {
  return Boolean(getManagedMetaAutoReplyTextKind(messageText));
}

export function isManagedInstagramAutoReplyText(messageText?: string | null): boolean {
  return isManagedMetaAutoReplyText(messageText);
}

function getManagedMetaAutoReplyTextKind(messageText?: string | null): 'greeting' | 'fallback' | null {
  const normalized = normalizeSpaces(messageText ?? '');
  if (!normalized) return null;

  if (/^hello(?:\s+[A-Za-z][A-Za-z.'-]*)?\.\s+how can i help you with\s+.{1,80}\s+today\??$/i.test(normalized)) {
    return 'greeting';
  }

  const lower = normalized.toLowerCase();
  if (
    lower.includes("sorry, i didn't quite catch that") ||
    lower.includes('you can reach our support team directly') ||
    lower.includes('i have also flagged this conversation for a team follow-up') ||
    lower.includes('i want to make sure you get the right help for this')
  ) {
    return 'fallback';
  }

  return null;
}

export function getMessengerInternalSenderIdsForBrand(
  brand?: string | null,
  env: EnvSource = process.env,
): Set<string> {
  const senderIds = new Set<string>();
  const envNames = [
    'META_FB_INTERNAL_SENDER_IDS',
    'META_FACEBOOK_INTERNAL_SENDER_IDS',
    'META_MESSENGER_INTERNAL_SENDER_IDS',
  ];

  for (const key of brandEnvKeys(brand)) {
    envNames.push(
      `META_FB_INTERNAL_SENDER_IDS_${key}`,
      `META_FACEBOOK_INTERNAL_SENDER_IDS_${key}`,
      `META_MESSENGER_INTERNAL_SENDER_IDS_${key}`,
      `${key}_FB_INTERNAL_SENDER_IDS`,
      `${key}_FACEBOOK_INTERNAL_SENDER_IDS`,
      `${key}_MESSENGER_INTERNAL_SENDER_IDS`,
    );
  }

  for (const name of envNames) {
    for (const senderId of splitIdentifierList(env[name])) {
      senderIds.add(senderId);
    }
  }

  return senderIds;
}

export function getInstagramInternalSenderIdsForBrand(
  brand?: string | null,
  env: EnvSource = process.env,
): Set<string> {
  const senderIds = new Set<string>();
  const envNames = [
    'META_IG_INTERNAL_SENDER_IDS',
    'META_INSTAGRAM_INTERNAL_SENDER_IDS',
  ];

  for (const key of brandEnvKeys(brand)) {
    envNames.push(
      `META_IG_INTERNAL_SENDER_IDS_${key}`,
      `META_INSTAGRAM_INTERNAL_SENDER_IDS_${key}`,
      `${key}_IG_INTERNAL_SENDER_IDS`,
      `${key}_INSTAGRAM_INTERNAL_SENDER_IDS`,
    );
  }

  for (const name of envNames) {
    for (const senderId of splitIdentifierList(env[name])) {
      senderIds.add(senderId);
    }
  }

  return senderIds;
}

export function getMetaBusinessLoopSkipReason(params: {
  senderId?: string | null;
  messageText?: string | null;
  configuredAccountIds: Set<string>;
  internalSenderIds?: Set<string>;
}): MetaBusinessLoopSkipReason | null {
  const senderId = cleanOptionalText(params.senderId);

  if (senderId && params.configuredAccountIds.has(senderId)) {
    return 'configured_business_account';
  }

  if (senderId && params.internalSenderIds?.has(senderId)) {
    return 'configured_internal_sender';
  }

  const autoReplyKind = getManagedMetaAutoReplyTextKind(params.messageText);
  if (autoReplyKind === 'greeting') {
    return 'managed_autoreply_greeting';
  }
  if (autoReplyKind === 'fallback') {
    return 'managed_autoreply_fallback';
  }

  return null;
}

export function getInstagramBusinessLoopSkipReason(params: {
  senderId?: string | null;
  messageText?: string | null;
  configuredAccountIds: Set<string>;
  internalSenderIds?: Set<string>;
}): InstagramBusinessLoopSkipReason | null {
  return getMetaBusinessLoopSkipReason(params);
}

export function getMessengerBusinessLoopSkipReason(params: {
  senderId?: string | null;
  messageText?: string | null;
  configuredPageIds: Set<string>;
  internalSenderIds?: Set<string>;
}): MessengerBusinessLoopSkipReason | null {
  return getMetaBusinessLoopSkipReason({
    senderId: params.senderId,
    messageText: params.messageText,
    configuredAccountIds: params.configuredPageIds,
    internalSenderIds: params.internalSenderIds,
  });
}
