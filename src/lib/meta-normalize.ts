/**
 * Channel normalization layer for Meta webhook payloads.
 *
 * Messenger and Instagram DM webhook structures are similar but not identical.
 * This module normalizes both into a single unified shape before handing
 * the data to the orchestrator.
 */

export type MetaChannel = 'messenger' | 'instagram' | 'whatsapp';

export interface NormalizedMessage {
  eventId?: string;
  senderId: string;
  channel: MetaChannel;
  pageOrAccountId: string;
  messageText: string;
  /** True when `messageText` was supplied by us, not by the customer — a bare
   *  photo with no caption gets a presumed question so the router has input. */
  messageTextInferred?: boolean;
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
    is_self?: boolean;
    attachments?: MetaAttachment[];
    quick_reply?: {
      payload?: string;
    };
  };
  postback?: {
    mid?: string;
    payload?: string;
    title?: string;
    /** Present when a brand-new thread starts from a link carrying a ref. */
    referral?: MetaReferral;
  };
  /** Present when an existing thread is reopened from such a link. */
  referral?: MetaReferral;
}

/**
 * How someone arrived. An m.me link can carry "?ref=HAP-0001", and Meta hands
 * that value back here — before the customer has typed anything.
 *
 * Which field it lands in depends on whether the thread already existed:
 * a first-ever contact taps Get Started and the ref rides on the postback,
 * while a returning customer produces a bare referral event with no message
 * and no postback at all. Both mean the same thing, so both are read.
 */
interface MetaReferral {
  ref?: string;
  source?: string;
  type?: string;
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

export function getStructuredPostbackMessage(payload?: string): string | null {
  const trimmedPayload = getTrimmedValue(payload);

  if (
    !trimmedPayload?.startsWith('ORDER_NOW|') &&
    !trimmedPayload?.startsWith('PRODUCT_DETAILS|') &&
    !trimmedPayload?.startsWith('ORDER_SIZE|') &&
    !trimmedPayload?.startsWith('ORDER_COLOR|')
  ) {
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

  if (trimmedPayload.startsWith('ORDER_SIZE|')) {
    const size = decodeMetaValue(attributes.size || attributes.value);
    return size ? `${size} size` : null;
  }

  if (trimmedPayload.startsWith('ORDER_COLOR|')) {
    const color = decodeMetaValue(attributes.color || attributes.value);
    return color ? `${color} color` : null;
  }

  if (trimmedPayload.startsWith('PRODUCT_DETAILS|')) {
    return productName ? `Please send details for ${productName}` : 'Please send item details';
  }

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
  return getCustomerMessageText(message) ?? 'What is this item?';
}

/** What the customer actually sent, or null when they sent no words at all. */
function getCustomerMessageText(message?: MetaMessagingEvent['message']): string | null {
  return (
    getStructuredPostbackMessage(message?.quick_reply?.payload) ??
    getTrimmedValue(message?.quick_reply?.payload) ??
    getTrimmedValue(message?.text) ??
    null
  );
}

/** The ref a link carried, from wherever Meta put it on this event. */
function getReferralRef(webhookEvent: MetaMessagingEvent): string | undefined {
  return getTrimmedValue(
    webhookEvent.referral?.ref ?? webhookEvent.postback?.referral?.ref
  );
}

/**
 * What a customer arriving from a link is taken to have said.
 *
 * The ref is the product's item code, so this reads as an order for it and
 * resolves through the same path as a customer typing the code themselves.
 * Anything else is passed through as-is: an unknown ref should still open the
 * conversation rather than be dropped.
 */
export function buildReferralMessage(ref: string): string {
  return /^[a-z]{2,5}[\s\-_/]*[0-9]{2,6}$/i.test(ref.trim())
    ? `Order ${ref.trim()}`
    : ref.trim();
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

  const referralRef = getReferralRef(params.webhookEvent);
  if (referralRef && !params.webhookEvent.postback && params.webhookEvent.timestamp) {
    return [
      params.channel,
      params.pageOrAccountId,
      params.senderId,
      'referral',
      params.webhookEvent.timestamp,
      encodeURIComponent(referralRef),
    ].join(':');
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

  // Someone arriving from a link that carried a ref, before typing anything.
  // A first-ever contact taps Get Started and the ref rides on that postback,
  // so the postback branch below handles it; a returning customer produces an
  // event with neither message nor postback, which used to be dropped as
  // unsupported — they landed in an empty chat and had to open the
  // conversation themselves.
  const referralRef = getReferralRef(webhookEvent);

  // Both arrival shapes go down this path. Our own quick-reply payloads never
  // carry a ref — Meta only attaches one when a thread is opened from a link —
  // so its presence is the reliable signal, and it beats the generic
  // "GET_STARTED" payload that would otherwise win.
  if (referralRef && !webhookEvent.message) {
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
      messageText: buildReferralMessage(referralRef),
      isEcho: false,
      // Routed as a normal message: the ref reads as an order for the item, and
      // the postback path is for buttons whose payloads we authored.
      isPostback: false,
    };
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
  const messageTextInferred = getCustomerMessageText(webhookEvent.message) === null;
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
    messageTextInferred,
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
  const senderId = webhookEvent.sender?.id;

  if (!senderId) {
    return null;
  }

  // Skip events created by the Instagram business account itself. Depending on
  // the Instagram API setup, Meta can mark these as either echoes, self messages,
  // or simply send them with the business account as the sender.
  if (webhookEvent.message?.is_echo || webhookEvent.message?.is_self || senderId === accountId) {
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
  const messageTextInferred = getCustomerMessageText(webhookEvent.message) === null;

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
    messageTextInferred,
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
  createdTime?: string | number;
  hideComment?: boolean;
}

interface FacebookCommentChange {
  item: string;
  verb: string;
  comment_id: string;
  from?: { id: string };
  message?: string;
  post_id?: string;
  created_time?: string | number;
  hide_comment?: boolean;
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
    createdTime: changeValue.created_time,
    hideComment: changeValue.hide_comment,
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
