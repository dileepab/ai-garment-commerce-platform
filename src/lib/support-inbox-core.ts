import { createHash } from 'node:crypto';

const CONVERSATION_KEY_PREFIX = 'sc1.';

export interface SupportConversationIdentity {
  brand: string | null;
  channel: string;
  senderId: string;
}

export interface SupportCaseTiming {
  status: string;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export class SupportInboxError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SupportInboxError';
    this.status = status;
  }
}

function assertValidIdentity(
  identity: SupportConversationIdentity
): SupportConversationIdentity {
  if (
    (identity.brand !== null &&
      (typeof identity.brand !== 'string' || !identity.brand.trim())) ||
    typeof identity.channel !== 'string' ||
    !identity.channel.trim() ||
    typeof identity.senderId !== 'string' ||
    !identity.senderId.trim()
  ) {
    throw new SupportInboxError('Invalid support conversation key.');
  }

  if (
    (identity.brand?.length ?? 0) > 160 ||
    identity.channel.length > 80 ||
    identity.senderId.length > 512
  ) {
    throw new SupportInboxError('Support conversation key is too long.');
  }

  return identity;
}

function getKeyChecksum(encodedIdentity: string): string {
  return createHash('sha256')
    .update(encodedIdentity, 'utf8')
    .digest('base64url')
    .slice(0, 16);
}

export function createSupportConversationKey(
  identity: SupportConversationIdentity
): string {
  const validIdentity = assertValidIdentity(identity);
  const payload = Buffer.from(
    JSON.stringify([
      validIdentity.brand,
      validIdentity.channel,
      validIdentity.senderId,
    ]),
    'utf8'
  ).toString('base64url');

  return `${CONVERSATION_KEY_PREFIX}${payload}.${getKeyChecksum(payload)}`;
}

export function parseSupportConversationKey(
  conversationKey: string
): SupportConversationIdentity {
  if (
    typeof conversationKey !== 'string' ||
    !conversationKey.startsWith(CONVERSATION_KEY_PREFIX)
  ) {
    throw new SupportInboxError('Invalid support conversation key.');
  }

  try {
    const keyParts = conversationKey
      .slice(CONVERSATION_KEY_PREFIX.length)
      .split('.');
    if (keyParts.length !== 2) throw new Error('Malformed conversation key.');
    const [encoded, checksum] = keyParts;
    if (
      !encoded ||
      !checksum ||
      !/^[A-Za-z0-9_-]+$/.test(encoded) ||
      !/^[A-Za-z0-9_-]+$/.test(checksum) ||
      checksum !== getKeyChecksum(encoded)
    ) {
      throw new Error('Conversation key checksum mismatch.');
    }

    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) {
      throw new Error('Non-canonical conversation key.');
    }
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));

    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      (parsed[0] !== null && typeof parsed[0] !== 'string') ||
      typeof parsed[1] !== 'string' ||
      typeof parsed[2] !== 'string'
    ) {
      throw new Error('Malformed conversation identity.');
    }

    return assertValidIdentity({
      brand: parsed[0],
      channel: parsed[1],
      senderId: parsed[2],
    });
  } catch (error) {
    if (error instanceof SupportInboxError) throw error;
    throw new SupportInboxError('Invalid support conversation key.');
  }
}

function resolvedCaseTime(supportCase: SupportCaseTiming): Date {
  return supportCase.resolvedAt ?? supportCase.updatedAt;
}

export function shouldAttachResolvedSupportCase(
  supportCase: SupportCaseTiming,
  latestMessageAt: Date | null
): boolean {
  return (
    supportCase.status.toLowerCase() === 'resolved' &&
    (latestMessageAt === null ||
      resolvedCaseTime(supportCase).getTime() >= latestMessageAt.getTime())
  );
}
