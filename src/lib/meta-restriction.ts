/**
 * Meta messaging restrictions, and backing off from them.
 *
 * When a Page is restricted from messaging, every send fails and every failure
 * is another negative signal against the Page. The Happybuy Page spent two
 * weeks in that state: a customer messaged, the bot composed a reply, the send
 * was rejected, and nothing reached anyone — so retrying bought nothing and
 * cost standing.
 *
 * Backing off costs the customer nothing, because a restricted send reaches
 * them either way. The cooldown is deliberately short: restrictions lapse on
 * Meta's schedule, not ours, and the only way to learn it has lifted is to try
 * again, so we probe rather than sit out a guessed duration.
 */
import { describeMetaGraphError, metaGraphErrorOf } from './meta-error.ts';

/** Graph code 10 with this subcode is the messaging-integrity restriction. */
const MESSAGING_RESTRICTION_SUBCODE = 1893063;
const RESTRICTION_CODE = 10;

// Long enough to stop a busy Page hammering a live restriction, short enough
// that delivery resumes on its own soon after Meta lifts it.
export const RESTRICTION_COOLDOWN_MS = 30 * 60 * 1000;

export interface RestrictionSignal {
  restricted: boolean;
  /** Meta's own wording, kept for the operator — it names the restriction. */
  reason?: string;
}

export function detectMessagingRestriction(data: unknown): RestrictionSignal {
  const error = metaGraphErrorOf(data);
  if (!error) return { restricted: false };

  const bySubcode = error.error_subcode === MESSAGING_RESTRICTION_SUBCODE;
  // Meta reuses "Application does not have permission for this action" across
  // unrelated causes, so the message alone proves nothing. Only pair it with
  // code 10 and the restriction wording, and never treat it as a match alone.
  const byWording =
    error.code === RESTRICTION_CODE &&
    /temporarily restricted from sending messages/i.test(
      `${error.message ?? ''} ${error.error_user_msg ?? ''}`
    );

  if (!bySubcode && !byWording) return { restricted: false };

  return { restricted: true, reason: describeMetaGraphError(data) };
}

/** Whether a recorded cooldown is still in force. */
export function isRestrictionActive(
  restrictedUntil: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!restrictedUntil) return false;
  const until = restrictedUntil instanceof Date ? restrictedUntil : new Date(restrictedUntil);
  const time = until.getTime();
  if (!Number.isFinite(time)) return false;
  return time > now.getTime();
}

export function restrictionCooldownUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESTRICTION_COOLDOWN_MS);
}
