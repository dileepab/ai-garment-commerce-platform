/**
 * Stops the bot saying the same thing twice in a row without acknowledging it.
 *
 * A verbatim repeat is what the bot does when it did not understand and fell
 * back to whatever it said last. It reads as broken, and it is what pushed a
 * real customer to a human: asked "will this be alright to wear out?", the bot
 * replied with the identical twelve-line spec sheet it had just sent, and an
 * agent stepped in an hour later to say "it's fine, it sits above the knee".
 *
 * The nudge is *appended* rather than replacing the reply. Replacing looked
 * tidier but throws away a correct answer — a customer who asks the same thing
 * twice deserves the same answer, and the regression suite rightly failed when
 * an empty-catalog reply was swallowed. Adding a line keeps the information and
 * still breaks the loop.
 *
 * Repeating is only wrong for replies meant to inform. Asking again for a
 * missing phone number, or re-showing an order summary awaiting a yes, is
 * deliberate — those kinds are exempt.
 *
 * Kept free of prisma and path aliases so the behaviour can be tested.
 */
import type { AssistantReplyKind } from '../conversation-state.ts';

/**
 * Kinds where saying the same words again is the intended behaviour: the
 * customer has been asked for something and has not yet supplied it.
 */
const INTENTIONAL_REPEAT_KINDS = new Set<AssistantReplyKind>([
  'contact_confirmation',
  'quantity_prompt',
  'order_summary',
  'support_waiting',
  'support_handoff',
  'support_contact',
]);

export const REPEAT_NUDGE =
  'Was there something more specific you wanted to know? Tell me the size, the colour, or where you plan to wear it and I can help properly.';

/** Whitespace and case carry no meaning here; the words are what repeat. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The previous reply may already carry a nudge from its own turn. Comparing
 * against the answer underneath is what makes a third identical reply detectable
 * rather than sliding past because the nudge changed the text.
 */
function withoutNudge(text: string): string {
  return normalize(text.split(REPEAT_NUDGE)[0]);
}

export function isUnhelpfulRepeat(params: {
  reply: string | null | undefined;
  previousReply: string | null | undefined;
  assistantReplyKind: AssistantReplyKind;
}): boolean {
  const reply = params.reply?.trim();
  const previous = params.previousReply?.trim();

  if (!reply || !previous) return false;
  if (INTENTIONAL_REPEAT_KINDS.has(params.assistantReplyKind)) return false;
  // Already nudged this turn; do not stack them.
  if (reply.includes(REPEAT_NUDGE)) return false;

  return withoutNudge(reply) === withoutNudge(previous);
}

/**
 * Keeps the answer, adds the ask.
 *
 * The caller passes the nudge already localized, because the reply it is being
 * appended to has itself been localized by then. A localized nudge on a stored
 * reply is not recognised by `isUnhelpfulRepeat`, so a third identical answer
 * in a non-English conversation can slip through — worth knowing, not worth a
 * fragile marker to prevent.
 */
export function appendRepeatNudge(reply: string, nudge: string = REPEAT_NUDGE): string {
  return `${reply.trimEnd()}\n\n${nudge}`;
}
