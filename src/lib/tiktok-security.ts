import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const OAUTH_STATE_VERSION = 1;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const ENCRYPTION_PREFIX = 'v1';

export interface TikTokOAuthStatePayload {
  version: number;
  brand: string;
  nonceHash: string;
  expiresAt: number;
}

interface CreateTikTokOAuthStateInput {
  brand: string;
  secret: string;
  now?: Date;
  nonce?: string;
}

interface VerifyTikTokOAuthStateInput {
  state: string;
  expectedNonce: string;
  secret: string;
  now?: Date;
}

function requireSecret(secret: string, label: string): string {
  const cleaned = secret.trim();
  if (cleaned.length < 24) {
    throw new Error(`${label} must contain at least 24 characters.`);
  }
  return cleaned;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signState(encodedPayload: string, secret: string): string {
  return createHmac('sha256', requireSecret(secret, 'TikTok OAuth state secret'))
    .update(encodedPayload)
    .digest('base64url');
}

function hashNonce(nonce: string, secret: string): string {
  return createHmac('sha256', requireSecret(secret, 'TikTok OAuth state secret'))
    .update(`nonce:${nonce}`)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createTikTokOAuthState(
  input: CreateTikTokOAuthStateInput,
): { state: string; nonce: string; expiresAt: Date } {
  const brand = input.brand.trim();
  if (!brand || brand.length > 120) {
    throw new Error('A valid brand is required for TikTok authorization.');
  }

  const now = input.now ?? new Date();
  const nonce = input.nonce ?? randomBytes(32).toString('base64url');
  const payload: TikTokOAuthStatePayload = {
    version: OAUTH_STATE_VERSION,
    brand,
    nonceHash: hashNonce(nonce, input.secret),
    expiresAt: Math.floor(now.getTime() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const encodedPayload = encodeJson(payload);
  const signature = signState(encodedPayload, input.secret);

  return {
    state: `${encodedPayload}.${signature}`,
    nonce,
    expiresAt: new Date(payload.expiresAt * 1000),
  };
}

export function verifyTikTokOAuthState(input: VerifyTikTokOAuthStateInput): TikTokOAuthStatePayload {
  const [encodedPayload, signature, extra] = input.state.split('.');
  if (!encodedPayload || !signature || extra) {
    throw new Error('TikTok authorization state is invalid.');
  }

  const expectedSignature = signState(encodedPayload, input.secret);
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('TikTok authorization state could not be verified.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('TikTok authorization state is invalid.');
  }

  const candidate = payload as Partial<TikTokOAuthStatePayload>;
  if (
    candidate.version !== OAUTH_STATE_VERSION
    || typeof candidate.brand !== 'string'
    || !candidate.brand.trim()
    || typeof candidate.nonceHash !== 'string'
    || !candidate.nonceHash
    || typeof candidate.expiresAt !== 'number'
  ) {
    throw new Error('TikTok authorization state is invalid.');
  }

  if (!safeEqual(candidate.nonceHash, hashNonce(input.expectedNonce, input.secret))) {
    throw new Error('TikTok authorization session does not match this browser.');
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (candidate.expiresAt <= nowSeconds) {
    throw new Error('TikTok authorization has expired. Please start again.');
  }

  return candidate as TikTokOAuthStatePayload;
}

function deriveEncryptionKey(secret: string): Buffer {
  return createHash('sha256')
    .update(requireSecret(secret, 'TikTok token encryption key'))
    .digest();
}

export function encryptTikTokAccessToken(accessToken: string, secret: string): string {
  const cleanedToken = accessToken.trim();
  if (!cleanedToken) {
    throw new Error('TikTok returned an empty access token.');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(cleanedToken, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptTikTokAccessToken(encryptedToken: string, secret: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, extra] = encryptedToken.split('.');
  if (
    version !== ENCRYPTION_PREFIX
    || !encodedIv
    || !encodedAuthTag
    || !encodedCiphertext
    || extra
  ) {
    throw new Error('Stored TikTok access token has an unsupported format.');
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveEncryptionKey(secret),
      Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(encodedAuthTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Stored TikTok access token could not be decrypted.');
  }
}
