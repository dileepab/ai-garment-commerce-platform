import webpush, { WebPushError } from 'web-push';
import prisma from '@/lib/prisma';
import { subscriptionCoversBrand } from '@/lib/push-targeting';
import { logInfo, logWarn } from '@/lib/app-log';
import { getSupportChannelLabel } from '@/lib/channel-display';
import { isSyntheticSenderId } from '@/lib/synthetic-sender';

/**
 * Web Push for the support inbox.
 *
 * Subscriptions are stored per browser rather than per operator: the same
 * person signs in on a phone and a laptop and generally wants to be buzzed on
 * the phone only, and each browser issues its own endpoint and key pair.
 *
 * Notification text is the customer's name and channel, never what they wrote.
 * A notification is delivered by a third-party push service and shown on a lock
 * screen, so the message stays behind the login the same way it stays out of
 * the logs.
 */

export type SupportPushKind = 'escalation' | 'message';

export interface SupportPushInput {
  kind: SupportPushKind;
  brand?: string | null;
  /** Shown as the notification title — a customer name, never their words. */
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Collapses repeat notifications for one conversation into the latest. */
  tag?: string;
}

let configuredKey: string | null = null;

function vapidDetails(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;

  // A mailto: or https: subject is required by the push services; the support
  // address is the right contact for a delivery problem.
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    (process.env.SUPPORT_EMAIL?.trim() ? `mailto:${process.env.SUPPORT_EMAIL.trim()}` : '') ||
    'https://app.deez.lk';

  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return vapidDetails() !== null;
}

const EXPECTED_VAPID_VARIABLES = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
] as const;

export interface PushConfigurationReport {
  present: Record<string, boolean>;
  /**
   * Variables whose name mentions VAPID but is not one of the three expected.
   * Only counted, never named: pasting a whole `NAME=value` line into a
   * hosting dashboard's name field is the usual cause, and the name would then
   * carry the private key inside it.
   */
  unrecognisedCount: number;
  /** The signature of that mistake — an `=` inside a variable name. */
  looksLikePastedAssignment: boolean;
}

/**
 * What the running server can actually see, for when the switch does not
 * appear and the dashboard says the variables are set.
 *
 * Reports presence only. No value is ever returned, and no unrecognised name
 * is echoed back.
 */
export function describePushConfiguration(): PushConfigurationReport {
  const present: Record<string, boolean> = {};
  for (const name of EXPECTED_VAPID_VARIABLES) {
    present[name] = Boolean(process.env[name]?.trim());
  }

  const strays = Object.keys(process.env).filter(
    (name) =>
      /vapid/i.test(name) &&
      !EXPECTED_VAPID_VARIABLES.includes(name as (typeof EXPECTED_VAPID_VARIABLES)[number])
  );

  return {
    present,
    unrecognisedCount: strays.length,
    looksLikePastedAssignment: strays.some((name) => name.includes('=')),
  };
}

export function getPushPublicKey(): string {
  return vapidDetails()?.publicKey ?? '';
}

function ensureVapidConfigured(): boolean {
  const details = vapidDetails();
  if (!details) return false;

  // setVapidDetails mutates module state, so it only needs doing when the key
  // changes rather than on every send.
  if (configuredKey !== details.publicKey) {
    webpush.setVapidDetails(details.subject, details.publicKey, details.privateKey);
    configuredKey = details.publicKey;
  }

  return true;
}

export async function saveOperatorPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  operatorEmail: string;
  brands: string[];
  deviceLabel?: string | null;
  notifyEscalations?: boolean;
  notifyAllMessages?: boolean;
}): Promise<void> {
  const brands = JSON.stringify(input.brands);
  const preferences = {
    ...(input.notifyEscalations === undefined ? {} : { notifyEscalations: input.notifyEscalations }),
    ...(input.notifyAllMessages === undefined ? {} : { notifyAllMessages: input.notifyAllMessages }),
  };

  await prisma.operatorPushSubscription.upsert({
    where: { endpoint: input.endpoint },
    // A browser hands back the same endpoint when it re-subscribes, so this
    // re-points an existing row rather than accumulating duplicates.
    update: {
      p256dh: input.p256dh,
      auth: input.auth,
      operatorEmail: input.operatorEmail,
      brands,
      deviceLabel: input.deviceLabel ?? null,
      failureCount: 0,
      ...preferences,
    },
    create: {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      operatorEmail: input.operatorEmail,
      brands,
      deviceLabel: input.deviceLabel ?? null,
      ...preferences,
    },
  });
}

export async function deleteOperatorPushSubscription(endpoint: string): Promise<void> {
  await prisma.operatorPushSubscription.deleteMany({ where: { endpoint } });
}

export async function updateOperatorPushPreferences(input: {
  endpoint: string;
  operatorEmail: string;
  notifyEscalations: boolean;
  notifyAllMessages: boolean;
}): Promise<boolean> {
  const updated = await prisma.operatorPushSubscription.updateMany({
    // Scoped to the signed-in operator so one login cannot retune another's device.
    where: { endpoint: input.endpoint, operatorEmail: input.operatorEmail },
    data: {
      notifyEscalations: input.notifyEscalations,
      notifyAllMessages: input.notifyAllMessages,
    },
  });

  return updated.count > 0;
}

export async function getOperatorPushSubscription(input: {
  endpoint: string;
  operatorEmail: string;
}) {
  return prisma.operatorPushSubscription.findFirst({
    where: { endpoint: input.endpoint, operatorEmail: input.operatorEmail },
    select: { endpoint: true, notifyEscalations: true, notifyAllMessages: true, deviceLabel: true },
  });
}

/** A push service answering 404 or 410 means the subscription is gone for good. */
function isGoneError(error: unknown): boolean {
  return error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410);
}

export async function sendSupportPush(input: SupportPushInput): Promise<number> {
  if (!ensureVapidConfigured()) return 0;

  const subscriptions = await prisma.operatorPushSubscription.findMany({
    where: input.kind === 'escalation' ? { notifyEscalations: true } : { notifyAllMessages: true },
    select: { id: true, endpoint: true, p256dh: true, auth: true, brands: true },
  });

  const targets = subscriptions.filter((subscription) =>
    subscriptionCoversBrand(subscription, input.brand)
  );

  if (targets.length === 0) return 0;

  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    url: input.url,
    tag: input.tag || input.url,
  });

  const goneIds: number[] = [];
  let delivered = 0;

  // allSettled rather than all: one dead phone must not stop the others, and
  // this runs inside a webhook that has to answer Meta quickly either way.
  const results = await Promise.allSettled(
    targets.map((subscription) =>
      webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload
      )
    )
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      delivered += 1;
      return;
    }

    if (isGoneError(result.reason)) {
      goneIds.push(targets[index].id);
      return;
    }

    logWarn('Push', 'Could not deliver a support notification.', {
      kind: input.kind,
      status: result.reason instanceof WebPushError ? result.reason.statusCode : undefined,
    });
  });

  if (goneIds.length > 0) {
    await prisma.operatorPushSubscription.deleteMany({ where: { id: { in: goneIds } } });
    logInfo('Push', 'Removed push subscriptions the browser has discarded.', {
      removed: goneIds.length,
    });
  }

  if (delivered > 0) {
    await prisma.operatorPushSubscription.updateMany({
      where: { id: { in: targets.map((subscription) => subscription.id) } },
      data: { lastNotifiedAt: new Date() },
    });
  }

  return delivered;
}


/** The regression suite drives the real webhooks; it must not buzz a phone. */
function pushSuppressed(senderId?: string | null): boolean {
  if (process.env.CHAT_TEST_MODE === '1') return true;
  return isSyntheticSenderId(senderId);
}

/**
 * A name for the notification title.
 *
 * Meta channels can still leave a customer unnamed, and "Unknown just wrote in"
 * reads worse than naming the channel they arrived on.
 */
function describeCustomer(contactName: string | null | undefined, channel: string): string {
  const name = (contactName || '').trim();
  return name || `New ${getSupportChannelLabel(channel)} customer`;
}

function supportUrl(brand?: string | null): string {
  return brand ? `/support?brand=${encodeURIComponent(brand)}` : '/support';
}

/** The bot has handed a conversation to a human. */
export async function notifySupportEscalation(input: {
  senderId: string;
  channel: string;
  brand?: string | null;
  contactName?: string | null;
}): Promise<void> {
  if (pushSuppressed(input.senderId)) return;

  await sendSupportPush({
    kind: 'escalation',
    brand: input.brand,
    title: describeCustomer(input.contactName, input.channel),
    body: `${getSupportChannelLabel(input.channel)} · needs a reply`,
    url: supportUrl(input.brand),
    // One conversation, one notification slot, so a customer sending five
    // messages does not leave five entries on the lock screen.
    tag: `support:${input.channel}:${input.senderId}`,
  });
}

/** A customer wrote in, whether or not the bot could answer them. */
export async function notifyInboundCustomerMessage(input: {
  senderId: string;
  channel: string;
  brand?: string | null;
  contactName?: string | null;
}): Promise<void> {
  if (pushSuppressed(input.senderId)) return;

  await sendSupportPush({
    kind: 'message',
    brand: input.brand,
    title: describeCustomer(input.contactName, input.channel),
    body: `${getSupportChannelLabel(input.channel)} · new message`,
    url: supportUrl(input.brand),
    tag: `support:${input.channel}:${input.senderId}`,
  });
}
