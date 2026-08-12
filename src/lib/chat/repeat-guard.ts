/**
 * Hands the conversation to a human when the bot starts repeating itself.
 *
 * A verbatim repeat is what the bot does when it did not understand and fell
 * back to whatever it said last. It is the clearest signal available that the
 * bot has nothing further to offer, and carrying on wastes the customer's time.
 *
 * From the conversation this exists for: asked "will this be alright to wear
 * out?", the bot replied with the identical twelve-line spec sheet it had just
 * sent. An agent answered in one line an hour later. Escalating on the first
 * repeat is what turns that hour into minutes.
 *
 * The answer is kept and the handover line appended, rather than replacing the
 * reply. Replacing looked tidier but throws away a correct answer — a customer
 * who asks the same thing twice deserves the same answer, and the regression
 * suite rightly failed when an empty-catalog reply was swallowed.
 *
 * Repeating is only wrong for replies meant to inform. Asking again for a
 * missing phone number, or re-showing an order summary awaiting a yes, is
 * deliberate — those kinds are exempt.
 *
 * Kept free of prisma and path aliases so the behaviour can be tested.
 */
import type { AssistantReplyKind } from '../conversation-state.ts';

/**
 * Only a repeated *fallback* counts. Repeating an answer is not by itself a
 * failure — the regression suite asks for the catalog four different ways and
 * rightly expects the catalog four times, and a customer who asks the same
 * thing twice deserves the same answer.
 *
 * A fallback is different: the bot has already said it did not understand, and
 * saying it a second time is the point at which it is demonstrably stuck.
 *
 * This deliberately does not catch a confident wrong answer — the sundress
 * conversation, where the bot believed it had answered and re-sent a spec sheet
 * to a different question. Telling that apart from a legitimate repeat needs to
 * know whether the reply addressed the question, which is a semantic judgement
 * this cannot make. That case belongs to the separate "answer the question
 * asked" work, not here.
 */
const ESCALATE_ON_REPEAT_KINDS = new Set<AssistantReplyKind>(['fallback']);

/**
 * Says the quiet part: the bot knows it missed, and a person is coming. It
 * deliberately keeps the customer in this thread rather than sending them to a
 * phone number — the thread is where the support inbox picks the case up.
 */
export const REPEAT_HANDOVER_MESSAGE =
  "I don't think I'm answering this properly. Let me get someone from our team to help — they'll reply here shortly.";

/** Whitespace and case carry no meaning here; the words are what repeat. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The previous reply may already carry a handover line from its own turn.
 * Comparing against the answer underneath keeps a later repeat detectable.
 */
function withoutHandover(text: string): string {
  return normalize(text.split(REPEAT_HANDOVER_MESSAGE)[0]);
}

export function isUnhelpfulRepeat(params: {
  reply: string | null | undefined;
  previousReply: string | null | undefined;
  assistantReplyKind: AssistantReplyKind;
}): boolean {
  const reply = params.reply?.trim();
  const previous = params.previousReply?.trim();

  if (!reply || !previous) return false;
  if (!ESCALATE_ON_REPEAT_KINDS.has(params.assistantReplyKind)) return false;
  // Already handed over this turn; do not stack.
  if (reply.includes(REPEAT_HANDOVER_MESSAGE)) return false;

  return withoutHandover(reply) === withoutHandover(previous);
}

/**
 * Keeps the answer, adds the handover.
 *
 * The caller passes the line already localized, because the reply it is being
 * appended to has itself been localized by then. A localized handover on a
 * stored reply is not recognised by `isUnhelpfulRepeat` — which does not matter
 * here, since the conversation is handed to a human on the first repeat and the
 * bot falls silent after it.
 */
export function appendRepeatHandover(
  reply: string,
  handover: string = REPEAT_HANDOVER_MESSAGE
): string {
  return `${reply.trimEnd()}\n\n${handover}`;
}
