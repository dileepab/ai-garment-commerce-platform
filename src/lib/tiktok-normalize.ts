const MAX_INBOUND_TEXT_LENGTH = 10_000;
const DECIMAL_ID_FIELDS = ['comment_id', 'video_id', 'parent_comment_id', 'conversation_id', 'message_id'];

interface TikTokWebhookEnvelope {
  client_key: string;
  event: string;
  create_time: number;
  user_openid: string;
  content: unknown;
}

export interface NormalizedTikTokCommentEvent {
  eventId: string;
  clientKey: string;
  businessOpenId: string;
  commentId: string;
  threadId: string;
  videoId: string;
  parentCommentId: string | null;
  customerOpenId: string | null;
  text: string;
  commentType: 'comment' | 'reply';
  action: 'insert';
  occurredAt: Date;
}

export type TikTokCommentLifecycleAction =
  | 'delete'
  | 'set_to_hidden'
  | 'set_to_friends_only'
  | 'set_to_public';

export interface NormalizedTikTokCommentLifecycleEvent {
  eventId: string;
  clientKey: string;
  businessOpenId: string;
  commentId: string;
  threadId: string;
  videoId: string;
  action: TikTokCommentLifecycleAction;
  occurredAt: Date;
}

export interface NormalizedTikTokDirectMessageEvent {
  eventId: string;
  clientKey: string;
  businessOpenId: string;
  conversationId: string;
  messageId: string;
  customerOpenId: string;
  customerName: string | null;
  text: string;
  messageType: TikTokDirectMessageType;
  providerMetadata: Record<string, string> | null;
  automatable: boolean;
  occurredAt: Date;
}

export interface NormalizedTikTokSentMessageEvent {
  eventId: string;
  clientKey: string;
  businessOpenId: string;
  conversationId: string;
  messageId: string;
  occurredAt: Date;
}

export interface NormalizedTikTokAuthorizationRemovedEvent {
  eventId: string;
  clientKey: string;
  businessOpenId: string;
  occurredAt: Date;
}

type TikTokDirectMessageType =
  | 'text'
  | 'image'
  | 'share_post'
  | 'video'
  | 'emoji'
  | 'sticker'
  | 'reaction'
  | 'template';

const MANUAL_MESSAGE_PLACEHOLDERS: Record<Exclude<TikTokDirectMessageType, 'text'>, string> = {
  image: '[TikTok image received]',
  share_post: '[TikTok post shared]',
  video: '[TikTok video received]',
  emoji: '[TikTok emoji received]',
  sticker: '[TikTok sticker received]',
  reaction: '[TikTok reaction received]',
  template: '[TikTok template message received]',
};

export interface ExtractedTikTokWebhook {
  comments: NormalizedTikTokCommentEvent[];
  commentLifecycleEvents: NormalizedTikTokCommentLifecycleEvent[];
  directMessages: NormalizedTikTokDirectMessageEvent[];
  sentMessages: NormalizedTikTokSentMessageEvent[];
  authorizationsRemoved: NormalizedTikTokAuthorizationRemovedEvent[];
  unsupportedEventCount: number;
}

function emptyExtraction(unsupportedEventCount = 0): ExtractedTikTokWebhook {
  return {
    comments: [],
    commentLifecycleEvents: [],
    directMessages: [],
    sentMessages: [],
    authorizationsRemoved: [],
    unsupportedEventCount,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, MAX_INBOUND_TEXT_LENGTH) : null;
}

function cleanId(value: unknown): string | null {
  if (typeof value === 'string') {
    const cleaned = value.trim();
    return cleaned && cleaned.length <= 512 && /^[A-Za-z0-9_~.+/=-]+$/.test(cleaned)
      ? cleaned
      : null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

function readUserId(value: unknown): string | null {
  const direct = cleanId(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record) return null;
  return cleanId(
    record.open_id
    ?? record.unique_identifier
    ?? record.unique_id
    ?? record.user_id
    ?? record.id,
  );
}

function parseEventTime(timestamp: string | number, fallbackSeconds: number): Date | null {
  const numeric = typeof timestamp === 'number'
    ? timestamp
    : Number.parseInt(timestamp, 10);
  const timestampMs = Number.isFinite(numeric) && numeric > 0
    ? numeric < 1_000_000_000_000
      ? numeric * 1000
      : numeric
    : fallbackSeconds * 1000;
  const occurredAt = new Date(timestampMs);
  return Number.isNaN(occurredAt.getTime()) ? null : occurredAt;
}

function readUserName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  return cleanText(
    record.display_name
    ?? record.nickname
    ?? record.username
    ?? record.name,
  );
}

/**
 * TikTok documents some snowflake-style IDs as JSON numbers even though they
 * can exceed Number.MAX_SAFE_INTEGER. Quote those known fields before parsing
 * the serialized `content` value so their exact decimal representation is kept.
 */
function quoteLargeDecimalIds(serializedContent: string): string {
  return DECIMAL_ID_FIELDS.reduce((value, field) => {
    const pattern = new RegExp(`("${field}"\\s*:\\s*)(-?\\d+)`, 'g');
    return value.replace(pattern, '$1"$2"');
  }, serializedContent);
}

export function parseTikTokWebhookContent(content: unknown): Record<string, unknown> | null {
  if (typeof content === 'string') {
    try {
      return asRecord(JSON.parse(quoteLargeDecimalIds(content)));
    } catch {
      return null;
    }
  }
  return asRecord(content);
}

function parseEnvelope(value: unknown): TikTokWebhookEnvelope | null {
  const record = asRecord(value);
  const clientKey = cleanText(record?.client_key);
  const event = cleanText(record?.event);
  const businessOpenId = cleanId(record?.user_openid);
  const createTime = record?.create_time;

  if (
    !record
    || !clientKey
    || !event
    || !businessOpenId
    || typeof createTime !== 'number'
    || !Number.isSafeInteger(createTime)
    || createTime <= 0
  ) {
    return null;
  }

  return {
    client_key: clientKey,
    event,
    create_time: createTime,
    user_openid: businessOpenId,
    content: record.content,
  };
}

function normalizeCommentEvent(
  envelope: TikTokWebhookEnvelope,
): NormalizedTikTokCommentEvent | NormalizedTikTokCommentLifecycleEvent | null {
  if (envelope.event !== 'comment.update') return null;
  const content = parseTikTokWebhookContent(envelope.content);
  if (!content) return null;

  const commentId = cleanId(content.comment_id);
  const videoId = cleanId(content.video_id);
  const rawParentCommentId = cleanId(content.parent_comment_id);
  const parentCommentId = rawParentCommentId && rawParentCommentId !== '0'
    ? rawParentCommentId
    : null;
  const customerOpenId = cleanId(content.unique_identifier);
  const text = cleanText(content.text);
  const commentType = content.comment_type;
  const action = content.comment_action;
  const timestamp = content.timestamp;

  if (
    !commentId
    || !videoId
    || (commentType !== 'comment' && commentType !== 'reply')
    || (typeof timestamp !== 'number' && typeof timestamp !== 'string')
  ) {
    return null;
  }

  const occurredAt = parseEventTime(timestamp, envelope.create_time);
  if (!occurredAt) return null;

  const base = {
    eventId: [
      'tiktok',
      'comment',
      envelope.user_openid,
      commentId,
      action,
      String(timestamp),
    ].join(':'),
    clientKey: envelope.client_key,
    businessOpenId: envelope.user_openid,
    commentId,
    threadId: parentCommentId || commentId,
    videoId,
    action,
    occurredAt,
  };

  if (action === 'insert' && text) {
    return {
      ...base,
      parentCommentId,
      customerOpenId,
      text,
      commentType,
      action,
    };
  }
  if (
    action === 'delete'
    || action === 'set_to_hidden'
    || action === 'set_to_friends_only'
    || action === 'set_to_public'
  ) {
    return { ...base, action };
  }
  return null;
}

function readMessageMetadata(
  content: Record<string, unknown>,
  messageType: TikTokDirectMessageType,
): Record<string, string> | null {
  const candidates: Array<[string, unknown]> = messageType === 'image'
    ? [['mediaId', asRecord(content.image)?.media_id]]
    : messageType === 'video'
      ? [
          ['mediaId', asRecord(content.video)?.media_id],
          ['videoId', asRecord(content.video)?.video_id],
        ]
      : messageType === 'share_post'
        ? [
            ['itemId', asRecord(content.share_post)?.item_id],
            ['videoId', asRecord(content.share_post)?.video_id],
          ]
        : messageType === 'sticker'
          ? [['stickerId', asRecord(content.sticker)?.sticker_id]]
          : messageType === 'reaction'
            ? [
                ['referencedMessageId', asRecord(content.reaction)?.referenced_message_id],
                ['reactionType', cleanText(asRecord(content.reaction)?.reaction_type)],
              ]
            : messageType === 'template'
              ? [['templateId', asRecord(content.template)?.template_id]]
              : messageType === 'emoji'
                ? [['emoji', cleanText(asRecord(content.emoji)?.value ?? content.emoji)]]
                : [];
  const metadata = Object.fromEntries(
    candidates.flatMap(([key, value]) => {
      const cleaned = cleanId(value) ?? cleanText(value);
      return cleaned ? [[key, cleaned]] : [];
    }),
  );
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function normalizeDirectMessageEvent(
  envelope: TikTokWebhookEnvelope,
): NormalizedTikTokDirectMessageEvent | null {
  // `im_send_msg` is the business's own echo. The restricted EU event omits
  // the identifiers/content required to create or reply to a conversation.
  if (envelope.event !== 'im_receive_msg') return null;
  const content = parseTikTokWebhookContent(envelope.content);
  if (!content) return null;

  const conversationId = cleanId(content.conversation_id);
  const messageId = cleanId(content.message_id);
  const fromUser = content.from_user;
  const customerOpenId = readUserId(fromUser) ?? readUserId(content.from);
  const rawMessageType = cleanText(content.type)?.toLowerCase();
  const messageType = rawMessageType && (
    rawMessageType === 'text' || rawMessageType in MANUAL_MESSAGE_PLACEHOLDERS
  )
    ? rawMessageType as TikTokDirectMessageType
    : null;
  const textBody = cleanText(asRecord(content.text)?.body);
  const timestamp = content.timestamp;
  const normalizedText = messageType === 'text'
    ? textBody
    : messageType
      ? MANUAL_MESSAGE_PLACEHOLDERS[messageType]
      : null;

  if (
    !conversationId
    || !messageId
    || !customerOpenId
    || customerOpenId === envelope.user_openid
    || !messageType
    || !normalizedText
    || (typeof timestamp !== 'number' && typeof timestamp !== 'string')
  ) {
    return null;
  }

  const occurredAt = parseEventTime(timestamp, envelope.create_time);
  if (!occurredAt) return null;

  return {
    eventId: ['tiktok', 'dm', envelope.user_openid, messageId].join(':'),
    clientKey: envelope.client_key,
    businessOpenId: envelope.user_openid,
    conversationId,
    messageId,
    customerOpenId,
    customerName: cleanText(content.from) ?? readUserName(fromUser),
    text: normalizedText,
    messageType,
    providerMetadata: readMessageMetadata(content, messageType),
    automatable: messageType === 'text',
    occurredAt,
  };
}

function normalizeSentMessageEvent(
  envelope: TikTokWebhookEnvelope,
): NormalizedTikTokSentMessageEvent | null {
  if (envelope.event !== 'im_send_msg') return null;
  const content = parseTikTokWebhookContent(envelope.content);
  if (!content) return null;
  const conversationId = cleanId(content.conversation_id);
  const messageId = cleanId(content.message_id);
  const timestamp = content.timestamp;
  if (
    !conversationId
    || !messageId
    || (typeof timestamp !== 'number' && typeof timestamp !== 'string')
  ) return null;
  const occurredAt = parseEventTime(timestamp, envelope.create_time);
  if (!occurredAt) return null;
  return {
    eventId: ['tiktok', 'dm-sent', envelope.user_openid, messageId].join(':'),
    clientKey: envelope.client_key,
    businessOpenId: envelope.user_openid,
    conversationId,
    messageId,
    occurredAt,
  };
}

function normalizeAuthorizationRemovedEvent(
  envelope: TikTokWebhookEnvelope,
): NormalizedTikTokAuthorizationRemovedEvent | null {
  if (envelope.event !== 'authorization.removed') return null;
  const occurredAt = parseEventTime(envelope.create_time, envelope.create_time);
  if (!occurredAt) return null;
  return {
    eventId: [
      'tiktok',
      'authorization-removed',
      envelope.user_openid,
      String(envelope.create_time),
    ].join(':'),
    clientKey: envelope.client_key,
    businessOpenId: envelope.user_openid,
    occurredAt,
  };
}

export function extractTikTokWebhook(value: unknown): ExtractedTikTokWebhook {
  const envelope = parseEnvelope(value);
  if (!envelope) return emptyExtraction(1);

  const comment = normalizeCommentEvent(envelope);
  if (comment) {
    return comment.action === 'insert'
      ? { ...emptyExtraction(), comments: [comment] }
      : { ...emptyExtraction(), commentLifecycleEvents: [comment] };
  }

  const directMessage = normalizeDirectMessageEvent(envelope);
  if (directMessage) return { ...emptyExtraction(), directMessages: [directMessage] };

  const sentMessage = normalizeSentMessageEvent(envelope);
  if (sentMessage) return { ...emptyExtraction(), sentMessages: [sentMessage] };

  const authorizationRemoved = normalizeAuthorizationRemovedEvent(envelope);
  return authorizationRemoved
    ? { ...emptyExtraction(), authorizationsRemoved: [authorizationRemoved] }
    : emptyExtraction(1);
}
