/**
 * Whether a sender id belongs to a person or to the tooling.
 *
 * The Chat Simulator, the regression suite and the seed data all write real
 * conversations through the real code paths, so they appear in the support
 * inbox alongside customers. They must not set a phone buzzing, and there is
 * no profile to look up for them.
 *
 * Kept free of path aliases so scripts can import it.
 */

const SYNTHETIC_PREFIXES = /^(?:sim|zz|repeat|test)-/i;

export function isSyntheticSenderId(senderId: string | null | undefined): boolean {
  return SYNTHETIC_PREFIXES.test((senderId || '').trim());
}
