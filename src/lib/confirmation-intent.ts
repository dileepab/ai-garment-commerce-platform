const ALLOWED_CONFIRMATIONS = new Set([
  'yes',
  'yes correct',
  'yes confirmed',
  'yes confirm',
  'confirm',
  'confirmed',
  'correct',
  'that is correct',
  'this is correct',
  'looks correct',
  'all correct',
  'yes please place order',
  'please place order',
  'place order',
  'place the order',
  'please place the order',
  'just place the order',
  'go ahead',
  'go ahead and place the order',
  'proceed',
  'do it',
  'please do it',
  'yes do it',
  'okay confirm',
  'ok confirm',
  'okay place the order',
  'ok place the order',
  'yes confirm the order',
  'no need please place the order',
  'no need place the order',
  'no changes needed',
  'no change needed',
  'no changes',
  'no change',
  'nothing to change',
  'ow',
  'ow confirm',
  'hari',
  'hari confirm',
  'hariyata',
  'hariyata thiyenawa',
  'confirm karanna',
  'order eka confirm karanna',
  'āma',
  'ama',
  'sari',
  'sari confirm',
]);

const CONFIRMATION_PATTERNS = [
  /\bdetails? (?:are|is) correct\b/i,
  /\bsummary (?:is|looks) correct\b/i,
  /\bi(?: am|'m)? confirming (?:my )?order\b/i,
  /\bi would like to proceed(?: with the order)?\b/i,
  /\bplease go ahead\b/i,
  /\bgo ahead and confirm\b/i,
  /\byes[, ]+details? (?:are|is) correct\b/i,
  /\byes\b.*\bconfirm(?: the)? order\b/i,
  /\byes\b.*\bno need to change\b/i,
  /\bno changes? needed\b/i,
  /\bnothing to change\b/i,
  /\b(ow|hari|hariyata)\b.*\b(confirm|karanna|danna|place)\b/i,
  /\b(confirm|place)\b.*\b(karanna|danna)\b/i,
  /^(ඔව්|හරි|හරියට|තහවුරු කරන්න|ඇණවුම තහවුරු කරන්න)[\s.!✅]*$/i,
  // The list above matches whole phrases, so "correct" confirmed an order and
  // "Correct details" did not. A customer who had already said "Yes confirm❤️"
  // said this, was asked a third time, and stopped replying believing she had
  // ordered. Emoji are common on the end of a yes and must not break it.
  /^(?:that|this|these|all)?\s*(?:looks?|is|are)?\s*correct(?:\s+details?)?\s*[\s.!✅❤️👍🙏]*$/i,
  /^(?:details?|address)\s+(?:is|are)?\s*correct\s*[\s.!✅]*$/i,
  /\byes\b[\s,.]*\bconfirm(?:ed|ing)?\b/i,
  /^(ஆம்|சரி|உறுதி செய்|ஆர்டர் செய்|ஆர்டர் பண்ணுங்கள்)[\s.!✅]*$/i,
];

const NO_CHANGE_CONFIRMATION_PATTERNS = [
  /\byes\b.*\bno need to change\b/i,
  /\bno changes? needed\b/i,
  /\bnothing to change\b/i,
];

const BLOCKED_CONFIRMATION_PATTERNS = [
  /\b(?:do not|don t|dont|not|never)\s+(?:confirm|place|submit|process)\b/i,
  /\b(?:wait|hold|stop|cancel)\b/i,
  /\b(?:change|edit|update)\b/i,
];

const ORDER_ACTION_CONFIRMATION_PATTERNS = [
  /^(?:yes|yeah|yep|sure|okay|ok)(?:\s+please)?\s+(?:go ahead(?:\s+and)?\s+)?(?:confirm|place|submit|process)(?:\s+and\s+(?:confirm|place|submit|process))?\s+(?:it|(?:(?:my|the)\s+)?order)(?:\s+now)?(?:\s+please)?$/i,
  /^(?:please\s+)?(?:go ahead(?:\s+and)?\s+)?(?:confirm|place|submit|process)(?:\s+and\s+(?:confirm|place|submit|process))?\s+(?:it|(?:(?:my|the)\s+)?order)(?:\s+now)?(?:\s+please)?$/i,
];

function normalizeConfirmationText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isClearConfirmation(message: string): boolean {
  const normalizedMessage = normalizeConfirmationText(message);

  if (
    ALLOWED_CONFIRMATIONS.has(normalizedMessage) ||
    NO_CHANGE_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
  ) {
    return true;
  }

  if (BLOCKED_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) {
    return false;
  }

  return (
    CONFIRMATION_PATTERNS.some((pattern) => pattern.test(message)) ||
    ORDER_ACTION_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
  );
}
