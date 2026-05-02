/**
 * Channel normalization layer for Meta webhook payloads.
 *
 * Messenger and Instagram DM webhook structures are similar but not identical.
 * This module normalizes both into a single unified shape before handing
 * the data to the orchestrator.
 */

export type MetaChannel = 'messenger' | 'instagram';

export interface NormalizedMessage {
  eventId?: string;
  senderId: string;
  channel: MetaChannel;
  pageOrAccountId: string;
  messageText: string;
  imageUrl?: string;
  isEcho: boolean;
  isPostback: boolean;
  postbackPayload?: string;
}

/** Shape of an individual attachment in a Meta webhook message. */
interface MetaAttachment {
  type: string;
  payload?: {
    url?: string;
    reel_video_url?: string;
  };
}

/** Shape of a Meta webhook messaging event (Messenger or Instagram). */
interface MetaMessagingEvent {
  sender?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MetaAttachment[];
    quick_reply?: {
      payload?: string;
    };
  };
  postback?: {
    mid?: string;
    payload?: string;
    title?: string;
  };
}

function getTrimmedValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function decodeMetaValue(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getStructuredPostbackMessage(payload?: string): string | null {
  const trimmedPayload = getTrimmedValue(payload);

  if (!trimmedPayload?.startsWith('ORDER_NOW|')) {
    return null;
  }

  const attributes = trimmedPayload
    .split('|')
    .slice(1)
    .reduce<Record<string, string>>((acc, part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex > 0) {
        const key = part.slice(0, separatorIndex);
        const value = part.slice(separatorIndex + 1);
        acc[key] = value;
      }

      return acc;
    }, {});

  const productName = decodeMetaValue(attributes.productName);

  return productName ? `I want to order ${productName}` : 'Order Now';
}

function getNormalizedPostbackText(postback?: MetaMessagingEvent['postback']): string | null {
  return (
    getStructuredPostbackMessage(postback?.payload) ??
    getTrimmedValue(postback?.payload) ??
    getTrimmedValue(postback?.title) ??
    null
  );
}

function getNormalizedMessageText(message?: MetaMessagingEvent['message']): string {
  return (
    getStructuredPostbackMessage(message?.quick_reply?.payload) ??
    getTrimmedValue(message?.quick_reply?.payload) ??
    getTrimmedValue(message?.text) ??
    'What is this item?'
  );
}

function buildMessagingEventId(params: {
  channel: MetaChannel;
  pageOrAccountId: string;
  senderId: string;
  webhookEvent: MetaMessagingEvent;
}): string | undefined {
  const directId = getTrimmedValue(
    params.webhookEvent.message?.mid ?? params.webhookEvent.postback?.mid
  );

  if (directId) {
    return `${params.channel}:${params.pageOrAccountId}:${directId}`;
  }

  if (!params.webhookEvent.postback) {
    return undefined;
  }

  const postbackKey = getTrimmedValue(params.webhookEvent.postback.payload) ??
    getTrimmedValue(params.webhookEvent.postback.title);

  if (!postbackKey || !params.webhookEvent.timestamp) {
    return undefined;
  }

  return [
    params.channel,
    params.pageOrAccountId,
    params.senderId,
    'postback',
    params.webhookEvent.timestamp,
    encodeURIComponent(postbackKey),
  ].join(':');
}

/**
 * Normalize a Messenger webhook messaging event.
 */
export function normalizeMessengerEvent(
  webhookEvent: MetaMessagingEvent,
  pageId: string
): NormalizedMessage | null {
  // Skip echo events (messages sent BY the page)
  if (webhookEvent.message?.is_echo) {
    return null;
  }

  const senderId = webhookEvent.sender?.id;

  if (!senderId) {
    return null;
  }

  // Handle postback events (e.g. from carousel buttons)
  if (webhookEvent.postback) {
    const postbackText = getNormalizedPostbackText(webhookEvent.postback);

    if (!postbackText) {
      return null;
    }

    return {
      eventId: buildMessagingEventId({
        channel: 'messenger',
        pageOrAccountId: pageId,
        senderId,
        webhookEvent,
      }),
      senderId,
      channel: 'messenger',
      pageOrAccountId: pageId,
      messageText: postbackText,
      isEcho: false,
      isPostback: true,
      postbackPayload: getTrimmedValue(webhookEvent.postback.payload) ?? postbackText,
    };
  }

  // Handle regular messages
  if (!webhookEvent.message) {
    return null;
  }

  const hasText = Boolean(
    getTrimmedValue(webhookEvent.message.text) ??
      getTrimmedValue(webhookEvent.message.quick_reply?.payload)
  );
  const hasAttachments = Boolean(webhookEvent.message.attachments?.length);

  if (!hasText && !hasAttachments) {
    return null;
  }

  const messageText = getNormalizedMessageText(webhookEvent.message);
  const imageAttachment = webhookEvent.message.attachments?.find(
    (att) => att.type === 'image'
  );

  return {
    eventId: buildMessagingEventId({
      channel: 'messenger',
      pageOrAccountId: pageId,
      senderId,
      webhookEvent,
    }),
    senderId,
    channel: 'messenger',
    pageOrAccountId: pageId,
    messageText,
    imageUrl: imageAttachment?.payload?.url || undefined,
    isEcho: false,
    isPostback: false,
  };
}

/**
 * Normalize an Instagram DM webhook messaging event.
 *
 * Key differences from Messenger:
 * - Instagram uses `sender.id` as the Instagram-scoped ID (IGSID), not a page-scoped ID.
 * - Attachments can come from story replies with different structure.
 * - Postbacks are not supported the same way.
 */
export function normalizeInstagramEvent(
  webhookEvent: MetaMessagingEvent,
  accountId: string
): NormalizedMessage | null {
  // Skip echo events
  if (webhookEvent.message?.is_echo) {
    return null;
  }

  const senderId = webhookEvent.sender?.id;

  if (!senderId) {
    return null;
  }

  if (webhookEvent.postback) {
    const postbackText = getNormalizedPostbackText(webhookEvent.postback);

    if (!postbackText) {
      return null;
    }

    return {
      eventId: buildMessagingEventId({
        channel: 'instagram',
        pageOrAccountId: accountId,
        senderId,
        webhookEvent,
      }),
      senderId,
      channel: 'instagram',
      pageOrAccountId: accountId,
      messageText: postbackText,
      isEcho: false,
      isPostback: true,
      postbackPayload: getTrimmedValue(webhookEvent.postback.payload) ?? postbackText,
    };
  }

  // Handle regular messages
  if (!webhookEvent.message) {
    return null;
  }

  const hasText = Boolean(
    getTrimmedValue(webhookEvent.message.text) ??
      getTrimmedValue(webhookEvent.message.quick_reply?.payload)
  );
  const hasAttachments = Boolean(webhookEvent.message.attachments?.length);

  if (!hasText && !hasAttachments) {
    return null;
  }

  const messageText = getNormalizedMessageText(webhookEvent.message);

  // Instagram attachments use a slightly different structure.
  // Image attachments may come from story replies or direct shares.
  const imageAttachment = webhookEvent.message.attachments?.find(
    (att) => att.type === 'image' || att.type === 'ig_reel' || att.type === 'story_mention'
  );

  const imageUrl =
    imageAttachment?.payload?.url ||
    imageAttachment?.payload?.reel_video_url ||
    undefined;

  return {
    eventId: buildMessagingEventId({
      channel: 'instagram',
      pageOrAccountId: accountId,
      senderId,
      webhookEvent,
    }),
    senderId,
    channel: 'instagram',
    pageOrAccountId: accountId,
    messageText,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
    isEcho: false,
    isPostback: false,
  };
}

export interface NormalizedComment {
  commentId: string;
  senderId: string;
  message: string;
  channel: 'facebook' | 'instagram';
  pageOrAccountId: string;
  postId?: string;
}

interface FacebookCommentChange {
  item: string;
  verb: string;
  comment_id: string;
  from?: { id: string };
  message?: string;
  post_id?: string;
}

/**
 * Normalize a Facebook feed comment change.
 */
export function normalizeFacebookComment(
  changeValue: FacebookCommentChange,
  pageId: string
): NormalizedComment | null {
  if (changeValue.item !== 'comment' || changeValue.verb !== 'add') {
    return null;
  }

  // Prevent replying to ourselves
  if (changeValue.from?.id === pageId) {
    return null;
  }

  return {
    commentId: changeValue.comment_id,
    senderId: changeValue.from?.id || '',
    message: changeValue.message || '',
    channel: 'facebook',
    pageOrAccountId: pageId,
    postId: changeValue.post_id,
  };
}

interface InstagramCommentChange {
  id: string;
  from?: { id: string };
  text?: string;
  media?: { id: string };
}

/**
 * Normalize an Instagram comment change.
 */
export function normalizeInstagramComment(
  changeValue: InstagramCommentChange,
  accountId: string
): NormalizedComment | null {
  // Prevent replying to ourselves
  if (changeValue.from?.id === accountId) {
    return null;
  }

  return {
    commentId: changeValue.id,
    senderId: changeValue.from?.id || '',
    message: changeValue.text || '',
    channel: 'instagram',
    pageOrAccountId: accountId,
    postId: changeValue.media?.id, // Instagram media ID
  };
}
