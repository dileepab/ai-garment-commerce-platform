import { cleanStoredContactName } from '@/lib/contact-profile';
import type { SupportIssueReason } from '@/lib/customer-support';
import type { PendingConversationStep } from '@/lib/conversation-state';
import type { SizeChartCategory } from '@/lib/size-charts';

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};
const SIZE_DISPLAY_ORDER = [
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  'XXL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  'FREE SIZE',
  'ONE SIZE',
];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitCsv(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSizeDisplayIndex(size: string): number {
  const normalized = size.trim().toUpperCase().replace(/\s+/g, ' ');
  const alias = normalized === 'XXL' ? '2XL' : normalized;
  const index = SIZE_DISPLAY_ORDER.findIndex((option) => option === alias);

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function sortSizeOptions(sizes: string[]): string[] {
  return [...sizes].sort((left, right) => {
    const leftIndex = getSizeDisplayIndex(left);
    const rightIndex = getSizeDisplayIndex(right);

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function formatSizeList(value?: string | null): string {
  const sizes = splitCsv(value);
  return sizes.length > 0 ? sortSizeOptions(sizes).join(', ') : '';
}

export function firstNameOf(value?: string | null): string {
  return cleanStoredContactName(value).split(' ')[0] || '';
}

export function scoreProductMatch(
  product: { name: string; style?: string | null },
  text: string
): number {
  const normalizedText = normalizeText(text);
  const normalizedName = normalizeText(product.name);
  const normalizedStyle = normalizeText(product.style || '');

  if (!normalizedText || !normalizedName) {
    return 0;
  }

  // An exact name outranks a partial one. Without this, "Pleated Wrap Skort"
  // and "Pleated Wrap Skort — Navy Check" tie, and the winner is whichever row
  // was created first rather than the one the customer named.
  if (normalizedText === normalizedName) {
    return 110;
  }

  if (normalizedText.includes(normalizedName) || normalizedName.includes(normalizedText)) {
    return 100;
  }

  // A style is a category, not an identity — every skort in the catalog shares
  // one. It used to score 100 the moment the text contained the style word,
  // which any full product name does: "Pleated Wrap Skort — Navy Check"
  // contains "skort", so both colourways scored 100 and the earlier row won.
  // A customer quoting HAP-0005 was answered about HAP-0004 for exactly this
  // reason. The style still counts, but only as one weak token among many.
  const countTokens = (candidate: string) =>
    candidate
      .split(' ')
      .filter((token) => token.length > 2)
      .reduce((sum, token) => (normalizedText.includes(token) ? sum + 1 : sum), 0);

  return Math.max(countTokens(normalizedName), normalizedStyle ? countTokens(normalizedStyle) : 0);
}

export function normalizeSize(value?: string | null, allowedSizes?: string[]): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeText(value);
  const sizeMap: Record<string, string> = {
    'extra small': 'XS',
    xs: 'XS',
    small: 'S',
    s: 'S',
    medium: 'M',
    m: 'M',
    large: 'L',
    l: 'L',
    'extra large': 'XL',
    xl: 'XL',
    xxl: 'XXL',
    'double extra large': 'XXL',
  };

  const mapped = sizeMap[normalized] || value.trim().toUpperCase();

  if (!allowedSizes || allowedSizes.length === 0) {
    return mapped;
  }

  return allowedSizes.includes(mapped) ? mapped : undefined;
}

export function normalizeColor(
  value?: string | null,
  allowedColors?: string[]
): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!allowedColors || allowedColors.length === 0) {
    return value.trim();
  }

  const normalized = normalizeText(value);
  return allowedColors.find((color) => normalizeText(color) === normalized);
}

export function parseRequestedDateFromMessage(message: string, referenceDate: Date): Date | null {
  const explicitMatch = message.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );

  if (explicitMatch?.[1] && explicitMatch[2]) {
    const day = Number.parseInt(explicitMatch[1], 10);
    const month = MONTH_MAP[explicitMatch[2].toLowerCase()];

    if (Number.isInteger(day) && month !== undefined) {
      const candidate = new Date(Date.UTC(referenceDate.getUTCFullYear(), month, day));
      return candidate < referenceDate
        ? new Date(Date.UTC(referenceDate.getUTCFullYear() + 1, month, day))
        : candidate;
    }
  }

  const dayOnlyMatch = message.match(/\bbefore\b.*\b(\d{1,2})(?:st|nd|rd|th)?\b/i);

  if (dayOnlyMatch?.[1]) {
    const day = Number.parseInt(dayOnlyMatch[1], 10);

    if (Number.isInteger(day)) {
      const candidate = new Date(
        Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), day)
      );

      return candidate < referenceDate
        ? new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, day))
        : candidate;
    }
  }

  return null;
}

export function extractDeliveryLocationHint(message: string): string | null {
  const patterns = [
    /\b(?:delivery(?:\s+\w+){0,3}\s+to|deliver(?:ed|y)?\s+to|ship(?:ped|ping)?\s+to)\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bhow long does delivery take to\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bdelivery time to\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\b([A-Za-z][A-Za-z.'-]{1,50}?)(?:ta|walata)\s+(?:delivery|shipping|courier)/i,
    /\b([A-Za-z][A-Za-z\s.'-]{1,50})\s*(?:වලට|ට|වෙත)\s*(?:එවන්න|යවන්න|එවීමට|යවීමට|ඩිලිවරි|delivery|කරන්න)/i,
    /([\u0D80-\u0DFF\s]{2,}?)(?:ට|වෙත)\s*(?:එවන්න|යවන්න|එවීමට|යවීමට|ඩිලිවරි|delivery)/i,
    /([\u0B80-\u0BFF\s]{2,}?)(?:க்கு|இற்கு)\s*(?:அனுப்ப|அனுப்புவதற்கு|டெலிவரி|டெலிவரி|கூரியர்|குரியர்|delivery|courier)/i,
    /([\u0D80-\u0DFF]{2,})(?:ට|වෙත)\s*(?:කොහොමද|කොහොම|කීයද|කීයක්)?\s*[?!.]*$/i,
    /([\u0B80-\u0BFF]{2,}?)(?:க்கு|இற்கு)\s*(?:எப்படி|எவ்வளவு)?\s*[?!.]*$/i,
    /\b([A-Za-z][A-Za-z\s.'-]{1,50}?)(?:ta|walata)\s+(?:kohomada|kohomadha|kiyada|kiyakda)\s*[?!.]*$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1]
        .replace(
          /,\s*(?:and\s+)?(?:when|how long|what|can|could|will|would|is|are|do|does)\b[\s\S]*$/i,
          ''
        )
        .trim();
    }
  }

  return null;
}

export function isGreetingMessage(message: string): boolean {
  return (
    /^(hi|hello|hey|good morning|good afternoon|good evening|ayubowan|vanakkam)\b/i.test(
      message.trim()
    ) || /^(ආයුබෝවන්|வணக்கம்)/.test(message.trim())
  );
}

export function looksLikeCasualWellbeingQuestion(message: string): boolean {
  const normalized = normalizeText(message);
  return /^(how are you|how r you|how are u|kohomada|kohomadha|kohomada oyata|oyata kohomada)\b/.test(
    normalized
  );
}

export function isNeutralAcknowledgement(message: string): boolean {
  return /^(ok|okay|alright|fine|noted|got it|understood)\b[!. ]*$/i.test(message.trim());
}

export function isThanksMessage(message: string): boolean {
  const normalized = normalizeText(message);
  return (
    /^(?:(?:ok|okay|alright) )?(?:thank you|thanks|thank u|thx|godak sthuthi|bohoma sthuthi|sthuthi|romba nandri|nandri)(?: very much| so much| a lot| for (?:your )?help)?$/.test(
      normalized
    ) ||
    /^(?:බොහොම\s*)?ස්තුතියි$/.test(normalized) ||
    /^(?:ரொம்ப\s*)?நன்றி$/.test(normalized)
  );
}

export function extractExplicitOrderIdFromMessage(message: string): number | null {
  const orderCodeMatch = message.match(/#?\s*ord-?\s*(\d+)/i);

  if (orderCodeMatch?.[1]) {
    return Number.parseInt(orderCodeMatch[1], 10);
  }

  const hashMatch = message.match(/#\s*(\d+)/);

  if (hashMatch?.[1]) {
    return Number.parseInt(hashMatch[1], 10);
  }

  const orderMatch = message.match(/\border\s*#?\s*(\d+)\b/i);

  if (orderMatch?.[1]) {
    return Number.parseInt(orderMatch[1], 10);
  }

  const checkMatch = normalizeText(message).match(/^check\s+(\d+)$/);

  if (checkMatch?.[1]) {
    return Number.parseInt(checkMatch[1], 10);
  }

  return null;
}

export function looksLikeOrderDetailsRequest(message: string): boolean {
  return /\border details?\b|\border summary\b|\bsummary of\b|\bdetails? of\b|\bsend me .*details?\b/i.test(
    message
  );
}

export function looksLikeMissingOrderFollowUp(message: string): boolean {
  return /\bfind\b|\bdatabase\b|\bcheck again\b|\bstatus\b|\bdetails?\b|\bthe order\b/i.test(message);
}

export function looksLikeExplicitOrderLookup(message: string): boolean {
  return /\b(find|check|status|details?|summary|show|send)\b/i.test(message);
}

export function looksLikeOrderStatusRequest(message: string): boolean {
  return (
    /\border status\b|\bstatus of\b|\bwhat is the status\b|\bcheck(?: again)?\b|\btrack\b|\bwhere is my order\b/i.test(
      message
    ) && !looksLikeOrderDetailsRequest(message)
  );
}

export function looksLikeCancellationRequest(message: string): boolean {
  return /\bcancel\b|\bdelete\b|\bremove\b/i.test(message);
}

export function looksLikeQuantityUpdateRequest(message: string): boolean {
  return /\b(?:increase|decrease|reduce|lower|change|update|edit|set)\b.*\b(?:quantity|count)\b|\bquantity\b.*\bto\s+\d+\b|\border count\b.*\bto\s+\d+\b/i.test(
    message
  );
}

export function looksLikeOrderContactUpdateRequest(message: string): boolean {
  const normalized = normalizeText(message);

  return /\b(change|update|correct|edit)\b.*\b(customer name|contact name|delivery name|name|delivery address|address|phone|contact number|mobile number|mobile|delivery details)\b/.test(
    normalized
  );
}

export function looksLikePaymentQuestion(message: string): boolean {
  const normalized = normalizeText(message);

  return /\bonline transfer\b|\bbank transfer\b|\bpayment method\b|\bpay\b|\bcod\b|\bcash on delivery\b|\bpay on delivery\b|\bthiyanawada\b.*\bcod\b|\bcod\b.*\bthiyanawada\b/i.test(
    normalized
  );
}

export function looksLikeExchangeQuestion(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\bexchange\b|\bwrong size\b|\bsize is wrong\b|\bchange the size\b|\bswap\b/i.test(normalized) ||
    /(මාරු|හුවමාරු|ලොකු\s*size|වෙන\s*size|සයිස්.*මාරු|size.*මාරු)/i.test(message) ||
    /(மாற்ற|எக்சேஞ்ச்|exchange|வேறு\s*size|பெரிய\s*size|சைஸ்.*மாற்ற)/i.test(message)
  );
}

export function looksLikeHumanSupportRequest(message: string): boolean {
  const normalized = normalizeText(message);

  if (looksLikeCallbackRequest(message)) {
    return true;
  }

  if (
    /\b(change|update|correct|edit)\b.*\b(phone|contact|mobile)\b.*\bnumber\b/.test(normalized)
  ) {
    return false;
  }

  return /\b(agent|human|real person|team member|customer care|customer support|support team|support center|help center|talk to someone|speak to someone|support number|call your team|contact your team|human support|customer service)\b/i.test(
    message
  ) ||
    /\b(?:support|customer care|customer support|support center|help center|human support|customer service)\b.*\b(?:contact|phone|mobile|telephone)\b.*\bnumber\b/i.test(
      normalized
    ) ||
    /\b(?:can i have|can you give|give me|send me|i need|need)\b.*\b(?:contact|phone|mobile|telephone)\b.*\bnumber\b/i.test(
      normalized
    );
}

export function looksLikeExplicitHumanHandoffRequest(message: string): boolean {
  return /\b(?:human|real person|agent|representative|team member|talk to someone|speak to someone|talk to a person|speak to a person|talk to your team|speak to your team)\b/i.test(
    normalizeText(message)
  );
}

export function looksLikeDeliveryComplaint(message: string): boolean {
  return (
    /\b(late|delayed|delay|not received|didn t receive|where is my parcel|where is my package|parcel not arrived|package not arrived|courier issue|still haven t received|still haven t got)\b/i.test(
      normalizeText(message)
    ) && !looksLikeDeliveryQuestion(message) &&
    !looksLikeCourierProviderQuestion(message)
  );
}

export function looksLikePaymentProblem(message: string): boolean {
  return /\b(payment failed|payment issue|payment problem|paid already|money deducted|charged twice|bank transfer issue|cannot pay|can t pay|cant pay)\b/i.test(
    normalizeText(message)
  );
}

export function looksLikeRefundOrDamageIssue(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(refund|damaged|damage|broken|defective|wrong item|wrong product|return my money|money back)\b/i.test(
      normalized
    ) ||
    /(ඩැමේජ්|ඩැමේජ්|damage|damaged|කැඩිලා|හානි|පළුදු|වැරදි\s*(භාණ්ඩ|ඇඳුම|ඇදුම)|සල්ලි\s*ආපහු|මුදල්\s*ආපසු|රිෆන්ඩ්|refund)/i.test(
      message
    ) ||
    /(சேதம்|சேதமடைந்த|கிழிந்த|பாதிப்பு|தவறான\s*பொருள்|பணம்\s*திரும்ப|ரீஃ?பண்ட்|refund|damaged)/i.test(
      message
    )
  );
}

export function looksLikeReturnRequest(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(want to return|would like to return|need to return|requesting a return|send it back|send back|return the order|return my order|return my item|return my parcel|return request)\b/i.test(
      normalized
    ) ||
    /(return|රිටර්න්|ආපහු\s*(දෙන්න|එවන්න)|නැවත\s*එවන්න|திருப்பி\s*(அனுப்ப|கொடுக்க)|ரிட்டர்ன்)/i.test(
      message
    )
  );
}

export function looksLikeExchangeRequest(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(want to exchange|would like to exchange|need to exchange|requesting an exchange|exchange the order|exchange my order|exchange my item|exchange request|swap for|swap it for|can i exchange|can i get an exchange|exchange if|exchange when)\b/i.test(
      normalized
    ) ||
    /(මාරු\s*කර|හුවමාරු|ලොකු\s*size|වෙන\s*size|සයිස්.*මාරු|size.*මාරු)/i.test(message) ||
    /(மாற்றி|மாற்ற|எக்சேஞ்ச்|exchange|வேறு\s*size|பெரிய\s*size|சைஸ்.*மாற்ற)/i.test(message)
  );
}

export function looksLikePreOrderIssuePolicyQuestion(
  message: string,
  reason?: SupportIssueReason | null
): boolean {
  const normalized = normalizeText(message);
  const asksQuestion =
    message.includes('?') ||
    /^(can|could|do|does|is|are|what|how|if|will|would)\b/.test(normalized) ||
    /\b(?:what if|in case|if it|if the|if my|if this|if that)\b/.test(normalized) ||
    /(මොකද|කොහොම|කළ\s*යුතු|කරන්නේ|හැකිද|\?)/i.test(message);
  const isConditional =
    /\b(?:what if|in case|if it|if the|if my|if this|if that|doesn t fit|does not fit|don t fit|do not fit|doesnt fit|wont fit|won t fit|not fit|arrives? damaged|comes? damaged|come damaged|came damaged if)\b/i.test(
      normalized
    ) ||
    /(ආවොත්|ආවේ\s*නම්|නොගැලපුණොත්|නොගැලපේ\s*නම්|නොගැලපෙනවා\s*නම්|size.*නොගැලප|සයිස්.*නොගැලප)/i.test(
      message
    );
  const looksPastIssue =
    /\b(?:already|received|got|came|arrived)\b.{0,50}\b(?:damaged|broken|defective|wrong item|wrong product)\b/i.test(
      normalized
    ) ||
    /(ආපු|ලැබුණ|ලැබුන|ඇවිත්|ඇවිල්ලා).{0,40}(ඩැමේජ්|හානි|කැඩිලා|වැරදි)/i.test(message);

  if (!asksQuestion && !isConditional) {
    return false;
  }

  if (looksPastIssue && !isConditional) {
    return false;
  }

  if (reason === 'exchange_request') {
    return isConditional || (asksQuestion && !messageReferencesExistingOrder(message));
  }

  if (reason === 'return_request') {
    return isConditional || /\b(?:return policy|can i return|can we return|possible to return)\b/i.test(normalized);
  }

  if (reason === 'refund_or_damage') {
    return isConditional;
  }

  return false;
}

export function looksLikeClarificationBreakdown(message: string): boolean {
  return /\b(not clear|unclear|confusing|don t understand|do not understand|you don t understand|you do not understand)\b/i.test(
    normalizeText(message)
  );
}

export function looksLikeSupportContactProblem(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(can t|cant|cannot|couldn t|couldnt|unable to)\b.*\b(contact|call|reach|whatsapp|message|connect|get through)\b/.test(
      normalized
    ) ||
    /\b(number|phone|whatsapp|line)\b.*\b(not working|not answering|not reachable|busy|off)\b/.test(
      normalized
    ) ||
    /\b(no answer|nobody answered|no one answered|not responding)\b/.test(normalized)
  );
}

export function inferSupportIssueReason(message: string): SupportIssueReason | null {
  if (looksLikeSupportContactProblem(message)) {
    return 'human_request';
  }

  if (looksLikeHumanSupportRequest(message)) {
    return 'human_request';
  }

  if (looksLikePaymentProblem(message)) {
    return 'payment_issue';
  }

  if (looksLikeRefundOrDamageIssue(message)) {
    return 'refund_or_damage';
  }

  if (looksLikeReturnRequest(message)) {
    return 'return_request';
  }

  if (looksLikeExchangeRequest(message)) {
    return 'exchange_request';
  }

  if (looksLikeDeliveryComplaint(message)) {
    return 'delivery_issue';
  }

  if (looksLikeClarificationBreakdown(message)) {
    return 'unclear_request';
  }

  return null;
}

export function looksLikeGiftRequest(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\bgift wrap\b|\bpack(?: it| this| the order)? as a gift\b|\bsend(?: it| this)? as a gift\b|\bgift note\b|\bspecial note\b|\bhappy birthday\b/.test(
      normalized
    ) ||
    ((/\bgift\b/.test(normalized) || /\bnote\b/.test(normalized)) &&
      /\b(pack|wrap|send|add|include|write|attach|birthday)\b/.test(normalized))
  );
}

export function looksLikeGiftFollowUp(message: string): boolean {
  return /^(yes|yeah|yep|okay|ok|do it|add it|apply it|use that|use it)\b/i.test(
    message.trim()
  );
}

export function looksLikeGiftUpdateInstruction(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    looksLikeGiftRequest(message) &&
    /\b(pack|wrap|add|include|update|set|apply|put|write|attach)\b/.test(normalized)
  );
}

export function assistantOfferedGiftOptions(message: string): boolean {
  return /\bpack it as a gift\b|\binclude the note\b/i.test(message);
}

export function extractGiftNoteFromText(message: string): string | null {
  const quotedMatch = message.match(/\bnote\s+"([^"]+)"/i) || message.match(/\bnote\s+'([^']+)'/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  if (/happy birthday/i.test(message)) {
    return 'Happy Birthday';
  }

  return null;
}

/**
 * Sinhala and Tamil delivery-timing wording: a send-or-deliver word together
 * with a duration word. Scoped on purpose — එවන්න and அனுப்ப both mean "send",
 * so on their own they match "photo එවන්න", which is a request for a photo.
 */
function looksLikeLocalizedDeliveryTimingQuestion(message: string): boolean {
  return (
    // "කීයක්" is deliberately absent. It carries both senses — "how many" of
    // something countable and "how much" of money — so counting it as a timing
    // word made "Colombo වලට ඩිලිවරි කරන්න කීයක් ගන්නවද?" ("how much do you
    // charge to deliver to Colombo?") a question about days, and the charge
    // answer arrived with the whole delivery-window recital attached. Genuine
    // "how many days" questions say දවස් and are still matched by it.
    /(එවන්න|යවන්න|එවීමට|යවීමට|ඩිලිවරි|delivery).*(දවස්|යයිද|කොච්චර|කල්|ලැබෙයි|එයි)/i.test(
      message
    ) ||
    /(දවස්|යයිද|කොච්චර|කල්).*(එවන්න|යවන්න|එවීමට|යවීමට|ඩිලිවරි|delivery)/i.test(
      message
    ) ||
    /(அனுப்ப|டெலிவரி|delivery).*(எத்தனை|நாட்கள்|நேரம்|எப்போது|வரும்|கிடைக்கும்)/i.test(
      message
    ) ||
    /(எத்தனை|நாட்கள்|நேரம்|எப்போது).*(அனுப்ப|டெலிவரி|delivery)/i.test(message)
  );
}

export function looksLikeDeliveryQuestion(message: string): boolean {
  return (
    // Every timing word here is anchored to delivery wording. A bare "when" or
    // "days" belongs to "when do you open?" and "how many days to make it?" as
    // often as to delivery, and routing those to the delivery handler answers
    // a store-hours question with a delivery estimate.
    /\bhow long\b|\bdelivery\b|\bdeliver(?:ed|y)?\b|\bship(?:ped|ping)?\b|\barrive\b|\bbefore\b|\bwhen can i get\b|\bwhen will it arrive\b/i.test(
      message
    ) ||
    looksLikeDeliveryChargeQuestion(message) ||
    looksLikeLocalizedDeliveryTimingQuestion(message)
  );
}

/**
 * Whether a message already known to be about delivery is asking about timing
 * rather than only about the charge.
 *
 * Deliberately looser than looksLikeDeliveryQuestion: it runs after delivery
 * intent is established, so a bare "when" is a fair signal here. It is not a
 * classifier on its own and must not be used as one.
 */
export function looksLikeDeliveryTimingQuestion(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(?:how long|when|days?|duration|estimate|eta|arrive|before)\b|\bdelivery (?:time|duration|estimate|eta)\b/i.test(
      normalized
    ) || looksLikeLocalizedDeliveryTimingQuestion(message)
  );
}

export function looksLikeDeliveryLogisticsQuestion(message: string): boolean {
  const normalizedWithoutPaymentTerms = normalizeText(message)
    .replace(/\bcash on delivery\b|\bpay on delivery\b|\bcod\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    looksLikeDeliveryChargeQuestion(message) ||
    looksLikeCourierProviderQuestion(message) ||
    Boolean(extractDeliveryLocationHint(message)) ||
    /\bhow long\b|\barrive\b|\bbefore\b|\bwhen can i get\b|\bwhen will it arrive\b|\bdelivery (?:time|duration|estimate|eta)\b|\b(?:do|can) you deliver\b|\bdeliver(?:ed|y)?\s+to\b|\bship(?:ped|ping)?\s+to\b|\bdelivery available\b/i.test(
      normalizedWithoutPaymentTerms
    ) ||
    /(එවන්න|යවන්න|එවීමට|යවීමට|ඩිලිවරි|delivery).*(දවස්|කීයක්|යයිද|කොච්චර|කල්|ලැබෙයි|එයි)/i.test(
      message
    ) ||
    /(දවස්|කීයක්|යයිද|කොච්චර|කල්).*(එවන්න|යවන්න|එවීමට|යවීමට|ඩිලිවරි|delivery)/i.test(
      message
    ) ||
    /(அனுப்ப|டெலிவரி|delivery).*(எத்தனை|நாட்கள்|நேரம்|எப்போது|வரும்|கிடைக்கும்)/i.test(
      message
    ) ||
    /(எத்தனை|நாட்கள்|நேரம்|எப்போது).*(அனுப்ப|டெலிவரி|delivery)/i.test(message)
  );
}

export function looksLikeCourierProviderQuestion(message: string): boolean {
  const normalized = normalizeText(message);
  const mentionsCourierProvider =
    /\b(?:courier|delivery partner|shipping provider|pronto|domex|koombiyo|koombio|royalexpress|royal express|prompt)\b/i.test(
      normalized
    );

  if (!mentionsCourierProvider) {
    return false;
  }

  return (
    /\b(?:which|what|available|use|send|ship|deliver|via|through|courier service|delivery partner|shipping provider)\b/i.test(
      normalized
    ) ||
    /\b(?:pronto|domex|koombiyo|koombio|royalexpress|royal express|prompt)\b/i.test(normalized)
  );
}

export function looksLikeDeliveryChargeQuestion(message: string): boolean {
  const normalized = normalizeText(message);
  const mentionsEnglishDelivery = /\b(?:delivery|deliver|courier|shipping)\b/i.test(normalized);
  const mentionsSinhalaDelivery = /(ඩිලිවරි|ඩෙලිවරි|කුරියර්|කූරියර්|කුරිය)/i.test(message);
  const mentionsTamilDelivery = /(டெலிவரி|டெலிவரி|கூரியர்|குரியர்|கொரியர்)/i.test(message);
  const mentionsStrongPriceTerm =
    /\b(?:charge|charges|fee|fees|cost|price|how much|gana|gaana|gasthu|kiyada|kiyakda|kochchara|evvalavu)\b/i.test(
      normalized
    ) ||
    /(චාජ්|චාජස්|චාර්ජ්|චාර්ජස්|ගාන|ගාණ|ගාස්තු|ගාස්තුව|මුදල|මිල)/i.test(message) ||
    /(சார்ஜ்|சார்ஜஸ்|கட்டணம்|செலவு|பணம்|விலை)/i.test(message);
  const mentionsWeakPriceTerm =
    /(කීයක්|කීයද|කොච්චර|කොහොමද)/i.test(message) ||
    /(எவ்வளவு|எவ்வளவ|எப்படி)/i.test(message);
  const asksExplicitlyAboutTiming =
    /\b(?:how long|when|days?|duration|estimate|eta|arrive)\b/i.test(normalized) ||
    /(දවස්|කල්|කවදා|වේලාව|කාලය|ලැබෙයි|එයි)/i.test(message) ||
    /(நாட்கள்|நேரம்|எப்போது|காலம்|வரும்|கிடைக்கும்)/i.test(message);

  return (
    (mentionsEnglishDelivery || mentionsSinhalaDelivery || mentionsTamilDelivery) &&
    (mentionsStrongPriceTerm || (mentionsWeakPriceTerm && !asksExplicitlyAboutTiming))
  );
}

export function shouldIncludeDeliveryCharge(params: {
  currentMessage: string;
  previousCustomerMessage?: string | null;
  currentLocation?: string | null;
}): boolean {
  if (looksLikeDeliveryChargeQuestion(params.currentMessage)) {
    return true;
  }

  if (!params.currentLocation || !params.previousCustomerMessage) {
    return false;
  }

  const normalized = normalizeText(params.currentMessage);
  const asksExplicitlyAboutTiming =
    /\b(?:how long|when|days?|duration|estimate|eta|arrive)\b/i.test(normalized) ||
    /(දවස්|කල්|කවදා|වේලාව|කාලය|ලැබෙයි|එයි)/i.test(params.currentMessage) ||
    /(நாட்கள்|நேரம்|எப்போது|காலம்|வரும்|கிடைக்கும்)/i.test(params.currentMessage);

  return (
    !asksExplicitlyAboutTiming &&
    looksLikeDeliveryChargeQuestion(params.previousCustomerMessage)
  );
}

export function looksLikeTotalQuestion(message: string): boolean {
  return (
    /\btotal\b|\bwith delivery\b|\bincluding delivery\b|\bfinal amount\b|\bhow much altogether\b/i.test(
      message
    ) ||
    /\b(?:order|item|product|cart)\b.*\bdelivery charges?\b|\bdelivery charges?\b.*\b(?:order|item|product|cart)\b/i.test(
      message
    )
  );
}

export function looksLikePrivateDataExtractionRequest(message: string): boolean {
  const normalized = normalizeText(message);
  const triesToOverrideInstructions =
    /\b(?:ignore|forget|override|bypass|disregard)\b.*\b(?:instructions?|rules?|policy|policies|prompt)\b/i.test(
      normalized
    ) || /\b(?:system prompt|developer message|hidden instructions?)\b/i.test(normalized);
  const asksForSensitiveData =
    /\b(?:customer|customers|user|users|people|database|records?)\b.*\b(?:phone|mobile|email|address|password|card|payment|personal|private|contact)\b/i.test(
      normalized
    ) ||
    /\b(?:phone|mobile|email|address|password|card|payment|personal|private|contact)\b.*\b(?:customer|customers|user|users|database|records?)\b/i.test(
      normalized
    );
  const requestsBulkAccess =
    /\b(?:all|every|entire|full|list|show|reveal|export|download|dump|database|records?)\b/i.test(
      normalized
    );

  return (
    (triesToOverrideInstructions && (asksForSensitiveData || /\bdatabase\b/i.test(normalized))) ||
    (asksForSensitiveData && requestsBulkAccess)
  );
}

export function looksLikeCatalogQuestion(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(?:available|abailable|availabe|availble|avaiable) items?\b|\b(?:available|abailable|availabe|availble|avaiable) products?\b|\bwhat are the (?:available|abailable|availabe|availble|avaiable)\b|\bwhat do you have\b|\bwhat clothes\b.*\b(?:available|have|stock)\b|\bclothes\b.*\b(?:available|in stock)\b|\b(?:available|abailable|availabe|availble|avaiable) dresses?\b|\b(?:available|abailable|availabe|availble|avaiable) tops?\b|\b(?:available|abailable|availabe|availble|avaiable) t\s*shirts?\b|\b(?:available|abailable|availabe|availble|avaiable) tee\s*shirts?\b|\b(?:available|abailable|availabe|availble|avaiable) pants\b|\b(?:available|abailable|availabe|availble|avaiable) skirts?\b|\bdo (?:you|u)(?: guys)? have\b.*\b(dress|dresses|top|tops|t\s*shirt|t\s*shirts|tee\s*shirt|tee\s*shirts|pant|pants|skirt|skirts)\b|\bdon t you have\b.*\b(dress|dresses|top|tops|t\s*shirt|t\s*shirts|tee\s*shirt|tee\s*shirts|pant|pants|skirt|skirts)\b/i.test(
      normalized
    ) ||
    /\b(?:monawada|monavada|mona|monawa)\b.*\b(?:thiyana|thiyena|tiyana|tiyena|thiyenne|tiyenne|adum|edum|items?|products?)\b/i.test(
      normalized
    ) ||
    /\b(?:adum|edum|items?|products?)\b.*\b(?:monawada|monavada|mona|monawa|thiyana|thiyena|tiyana|tiyena|thiyenne|tiyenne)\b/i.test(
      normalized
    ) ||
    /\bmonawath?\b.*\bpenne\b|\bpenne\b.*\bnane\b/i.test(normalized) ||
    /(මොනවද|මොනවාද|මොනාවද|මොනද).*(තියන|තියෙන|තියෙන්නේ|ඇදුම්|ඇඳුම්|බඩු)/.test(message) ||
    /(ඇදුම්|ඇඳුම්|බඩු).*(තියන|තියෙන|තියෙන්නේ|මොන)/.test(message) ||
    /(என்ன|எவை|எந்த).*(ஆடை|ஆடைகள்|பொருட்கள்|items?|products?|இருக்கு|இருக்கிறது|உள்ளது)/i.test(
      message
    ) ||
    /(ஆடை|ஆடைகள்|பொருட்கள்).*(என்ன|எவை|எந்த|இருக்கு|இருக்கிறது|உள்ளது)/i.test(message)
  );
}

export function looksLikeStoreLocationQuestion(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\b(where|location|located|address|shop|store|outlet|branch|branches|open|opening hours|close|closing time|outside colombo)\b.*\b(shop|store|outlet|branch|branches|located|location|address|open|close|hours)\b/i.test(
      normalized
    ) ||
    /\b(shop|store|outlet|branch|branches|opening hours|outside colombo)\b/i.test(
      normalized
    ) ||
    // Common Roman Sinhala location wording. A live customer wrote
    // "Oya.. bingiriyeda...........s?" (roughly "Are you in Bingiriya?").
    // Requiring either `koheda` or the location suffix `-yeda` avoids treating
    // ordinary "oya ... da?" questions as store-location requests.
    /\b(?:oya|oyala)\s+(?:koheda|[a-z]{3,}yeda)\b/i.test(normalized) ||
    /(කඩේ|කඩය|ශාඛා|branch|shop|store|ලිපිනය|තැන|කොහෙද|කොහෙද තියෙන්නේ|විවෘත|වහන්නේ|කීයට|කොළඹින් පිට)/i.test(
      message
    ) ||
    (
      /(கடை|ஸ்டோர்|கிளை|கிளைகள்|முகவரி|location|branch|கொழும்புக்கு வெளியே)/i.test(message) &&
      /(எங்கே|எங்கு|இருக்கிறது|உள்ளதா|திறந்திருக்கும்|மணிவரை|வெளியே|கிளைகள்)/i.test(message)
    )
  );
}

export function looksLikeSizeChartQuestion(message: string): boolean {
  return /\bsize chart\b|\bmeasurement chart\b|\bmeasurements?\b/i.test(message);
}

export function looksLikeSameItemMessage(message: string): boolean {
  return /\bsame item\b|\bsame size\b|\bsame product\b|\bsame one\b|\bsame top\b/i.test(message);
}

export function messageReferencesExistingOrder(message: string): boolean {
  return /\bmy order\b|\blast order\b|\bprevious order\b|\bthat order\b|\bthis order\b|\border\s*#?\s*(?:ord-?)?\d+\b|\bord-?\s*\d+\b/i.test(
    message
  );
}

export function mentionsRelativeOrderReference(message: string): boolean {
  return /\blast order\b|\bprevious order\b|\bthat order\b|\bthis order\b|\bmy order\b/i.test(message);
}

export function mentionsLatestOrderReference(message: string): boolean {
  return /\blast order\b|\bprevious order\b/i.test(message);
}

export function mentionsOwnedOrderReference(message: string): boolean {
  return /\bmy order\b/i.test(message);
}

export function mentionsCurrentOrderReference(message: string): boolean {
  return /\bthat order\b|\bthis order\b/i.test(message);
}

export function extractStandaloneQuantityFromMessage(message: string): number | null {
  const normalized = normalizeText(message);
  const match = normalized.match(
    /^(?:make it|set it|update it|change it|reduce it to|lower it to|decrease it to|do)?\s*(\d+)\s*(?:items?|pieces?|pcs?)?$/
  );

  if (!match?.[1]) {
    return null;
  }

  const quantity = Number.parseInt(match[1], 10);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

export function extractMaximumQuantityFromAssistantMessage(message: string): number | null {
  const match = message.match(/\bup to\s+(\d+)\s+item/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export function isLowerQuantityPrompt(message: string): boolean {
  return /please send a lower quantity|please tell me the quantity you want/i.test(message);
}

export function extractRequestedProductTypes(message: string): SizeChartCategory[] {
  const normalized = normalizeText(message);
  const result: SizeChartCategory[] = [];
  const mentionsTshirts = /\bt\s*shirts?\b|\btee\s*shirts?\b|\btees?\b/.test(normalized);

  if (mentionsTshirts) {
    result.push('tshirts');
  }

  if (
    /\btop\b|\btops\b|\bblouse\b|\bblouses\b|\bcrop top\b/.test(normalized) ||
    (!mentionsTshirts && /\bshirt\b|\bshirts\b/.test(normalized))
  ) {
    result.push('tops');
  }

  if (/\bdress\b|\bdresses\b|\bgown\b|\bgowns\b/.test(normalized)) {
    result.push('dresses');
  }

  if (/\bpant\b|\bpants\b|\btrouser\b|\btrousers\b|\bjean\b|\bjeans\b|\blegging\b|\bleggings\b/.test(normalized)) {
    result.push('pants');
  }

  if (/\bskirt\b|\bskirts\b/.test(normalized)) {
    result.push('skirts');
  }

  return [...new Set(result)];
}

export function shouldForceFallbackConfirmation(
  action: string,
  currentMessage: string,
  isClearConfirmationFn: (message: string) => boolean
): boolean {
  return action === 'confirm_pending' && !isClearConfirmationFn(currentMessage);
}

export function shouldTreatAsSupportPaused(
  supportMode: PendingConversationStep | string
): boolean {
  return supportMode === 'handoff_requested' || supportMode === 'human_active';
}

/**
 * Returns true only when cancellation is the *primary intent* of the message —
 * i.e. it starts with a cancel verb or a well-known cancel phrase.
 * Unlike `looksLikeCancellationRequest`, this deliberately does NOT match
 * messages that merely contain the word "cancel" (e.g. a customer named
 * "Draft Cancel Customer").
 */
export function isUnambiguousCancellationMessage(message: string): boolean {
  const normalized = normalizeText(message).trim();
  return (
    /^(cancel|delete this order|remove this order)\b/.test(normalized) ||
    /^(please cancel|i want to cancel|i would like to cancel|i d like to cancel|can you cancel|can i cancel|want to cancel|wish to cancel)\b/.test(
      normalized
    ) ||
    /^(don t want|dont want|i don t want|i dont want)\b/.test(normalized)
  );
}

/**
 * Returns true when the customer is clearly requesting to speak with a human
 * agent — as opposed to simply asking for a contact phone number.
 * Used to override an AI `support_contact_request` classification so that
 * such messages always trigger a proper support escalation.
 */
export function looksLikeHumanEscalationRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    looksLikeCallbackRequest(message) ||
    /\b(real person|live agent|human agent|actual person|talk to someone|speak to someone|talk to a human|speak to a human)\b/.test(
      lower
    ) ||
    /\b(talk|speak|chat)\b.{0,20}\b(someone|person|human|agent|representative)\b/.test(lower) ||
    /\b(i need|i want|need to|want to|can i)\b.{0,25}\b(human|agent|real person)\b/.test(lower)
  );
}

/**
 * A request for the merchant to call the customer is a human handoff, not a
 * request for the store's phone number. Keeping it separate prevents replies
 * such as "please call support" when the customer explicitly asked us to call.
 */
/**
 * "Call me" is a request only when nothing name-like follows it. "You can call
 * me Sam" is how a customer answers the name prompt, and treating that as a
 * callback request escalates the conversation to a human instead of taking the
 * name — so the phrase counts only at the end of the message or before a word
 * that continues the request.
 */
const CALLBACK_CALL_ME =
  /\bcall\s+me\b(?=$|\s+(?:back|please|pls|now|soon|asap|urgently|quickly|directly|today|tomorrow|on|at|about|regarding|when|once|first|instead)\b|\s+\d)/;

/** "Do not call me, just message here" is the opposite request. */
const CALLBACK_REFUSED = /\b(?:do not|dont|don t|no need to|never)\s+(?:call|phone|contact)\s+me\b/;

export function looksLikeCallbackRequest(message: string): boolean {
  const normalized = normalizeText(message);

  if (CALLBACK_REFUSED.test(normalized)) {
    return false;
  }

  return (
    CALLBACK_CALL_ME.test(normalized) ||
    /\b(?:give|make)\s+me\s+a\s+call\b/.test(normalized) ||
    /\b(?:contact|phone|ring)\s+me\b/.test(normalized) ||
    /\bmata\b.{0,24}\bcall(?:\s+ekak)?\b.{0,20}\b(?:denna|ganna|karanna)\b/.test(
      normalized
    ) ||
    /\bcall(?:\s+ekak)?\b.{0,20}\b(?:denna|ganna|karanna)\b.{0,20}\bmata\b/.test(
      normalized
    ) ||
    /(මට).{0,24}(කෝල්|අමතන්න)|(කෝල්|අමතන්න).{0,24}(මට)/i.test(message) ||
    /\b(?:enna|enakku)\b.{0,24}\bcall\b.{0,20}\b(?:pannu|pannunga|seiyunga)\b/.test(
      normalized
    ) ||
    /(என்னை|எனக்கு).{0,24}(அழைக்க|அழையுங்கள்|கால்)/i.test(message)
  );
}
