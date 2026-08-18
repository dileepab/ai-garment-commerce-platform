/**
 * Fills in the customer names that Messenger and Instagram threads are missing.
 *
 * The webhook now resolves a name on every inbound message, but it only runs
 * when a customer writes in. Threads already sitting in the inbox stay headed
 * "Unknown" until then, so this walks them once.
 *
 * Read-only against Meta; the only writes are Customer name rows.
 *
 *   node --env-file=.env.production.local --experimental-strip-types \
 *     scripts/backfill-meta-contact-names.ts [--commit]
 *
 * Without --commit it reports what it would name and writes nothing.
 */

import { PrismaClient } from '@prisma/client';
import {
  buildConversationParticipantsRequest,
  buildMessengerProfileRequest,
  buildInstagramProfileRequest,
  getInstagramProfileDisplayName,
  getMessengerProfileDisplayName,
  parseConversationParticipantName,
  parseInstagramUserProfile,
  parseMessengerUserProfile,
} from '../src/lib/meta-profile.ts';
import { isSyntheticSenderId } from '../src/lib/synthetic-sender.ts';

const prisma = new PrismaClient();
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const COMMIT = process.argv.includes('--commit');

async function readJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function resolveName(params: {
  channel: string;
  senderId: string;
  pageOrAccountId: string;
  accessToken: string;
}): Promise<string> {
  const { channel, senderId, pageOrAccountId, accessToken } = params;

  const profileRequest =
    channel === 'instagram'
      ? buildInstagramProfileRequest({
          graphVersion: GRAPH_VERSION,
          senderId,
          accessToken,
          useInstagramGraph: false,
        })
      : buildMessengerProfileRequest({ graphVersion: GRAPH_VERSION, senderId, accessToken });

  const profilePayload = await readJson(profileRequest.url, profileRequest.init);
  if (channel === 'instagram') {
    const profile = parseInstagramUserProfile(profilePayload);
    const name = profile ? getInstagramProfileDisplayName(profile) : '';
    if (name) return name;
  } else {
    const profile = parseMessengerUserProfile(profilePayload);
    const name = profile ? getMessengerProfileDisplayName(profile) : '';
    if (name) return name;
  }

  const conversationRequest = buildConversationParticipantsRequest({
    graphVersion: GRAPH_VERSION,
    pageOrAccountId,
    senderId,
    accessToken,
    platform: channel === 'instagram' ? 'instagram' : 'messenger',
  });
  const conversationPayload = await readJson(conversationRequest.url, conversationRequest.init);

  return parseConversationParticipantName(conversationPayload, { senderId, pageOrAccountId });
}

async function main() {
  const configs = await prisma.brandChannelConfig.findMany({
    select: {
      brand: true,
      facebookPageId: true,
      facebookPageAccessToken: true,
      instagramAccountId: true,
      instagramAccessToken: true,
    },
  });
  const configByBrand = new Map(configs.map((config) => [config.brand, config]));

  const identities = await prisma.chatMessage.groupBy({
    by: ['brand', 'channel', 'senderId'],
    where: { channel: { in: ['messenger', 'instagram'] } },
    _count: { _all: true },
  });

  const senderIds = Array.from(new Set(identities.map((identity) => identity.senderId)));
  const known = await prisma.customer.findMany({
    where: { externalId: { in: senderIds } },
    select: { id: true, externalId: true, name: true },
  });
  const knownByExternalId = new Map(
    known.map((customer) => [customer.externalId as string, customer])
  );

  let named = 0;
  let skipped = 0;
  let unresolved = 0;

  for (const identity of identities) {
    const { brand, channel, senderId } = identity;

    if (isSyntheticSenderId(senderId)) {
      skipped += 1;
      continue;
    }

    const existing = knownByExternalId.get(senderId);
    if (existing?.name && existing.name.toLowerCase() !== 'unknown') {
      skipped += 1;
      continue;
    }

    const config = brand ? configByBrand.get(brand) : undefined;
    const pageOrAccountId =
      channel === 'instagram' ? config?.instagramAccountId : config?.facebookPageId;
    const accessToken =
      (channel === 'instagram' ? config?.instagramAccessToken : config?.facebookPageAccessToken) ||
      process.env.META_PAGE_ACCESS_TOKEN;

    if (!pageOrAccountId || !accessToken) {
      console.log(`  no ${channel} credentials for brand ${brand ?? 'unknown'} — skipping`);
      unresolved += 1;
      continue;
    }

    const name = await resolveName({ channel, senderId, pageOrAccountId, accessToken });

    if (!name) {
      unresolved += 1;
      console.log(`  ${channel} ${senderId} — Meta returned no name`);
      continue;
    }

    named += 1;
    console.log(`  ${channel} ${senderId} → ${name}${COMMIT ? '' : ' (dry run)'}`);

    if (!COMMIT) continue;

    if (existing) {
      await prisma.customer.update({ where: { id: existing.id }, data: { name } });
    } else {
      await prisma.customer.create({
        data: { externalId: senderId, name, channel, preferredBrand: brand || null },
      });
    }
  }

  console.log(
    `\n${named} named, ${unresolved} still unnamed, ${skipped} skipped (already named or simulator).`
  );
  if (!COMMIT && named > 0) console.log('Re-run with --commit to save these names.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
