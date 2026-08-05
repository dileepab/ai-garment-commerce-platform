import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface VerifyTikTokWebhookSignatureInput {
  rawBody: string;
  signatureHeader?: string | null;
  appSecret?: string | null;
  now?: Date;
  toleranceSeconds?: number;
}

function safeHexEqual(leftHex: string, rightHex: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(leftHex) || !/^[a-f0-9]{64}$/i.test(rightHex)) {
    return false;
  }

  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies TikTok's `TikTok-Signature` header against the exact raw request
 * body. Re-serializing parsed JSON would change the signed bytes.
 */
export function verifyTikTokWebhookSignature(
  input: VerifyTikTokWebhookSignatureInput,
): boolean {
  const secret = input.appSecret?.trim();
  const header = input.signatureHeader?.trim();
  if (!secret || !header) return false;

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const segment of header.split(',')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) return false;
    const key = segment.slice(0, separator).trim().toLowerCase();
    const value = segment.slice(separator + 1).trim();

    if (key === 't') {
      if (timestamp !== null || !/^\d{10}$/.test(value)) return false;
      timestamp = Number.parseInt(value, 10);
    } else if (key === 's') {
      if (!/^[a-f0-9]{64}$/i.test(value)) return false;
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return false;

  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(tolerance) || tolerance < 0) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${input.rawBody}`, 'utf8')
    .digest('hex');

  return signatures.some((signature) => safeHexEqual(expected, signature));
}

export { DEFAULT_TOLERANCE_SECONDS as TIKTOK_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS };
