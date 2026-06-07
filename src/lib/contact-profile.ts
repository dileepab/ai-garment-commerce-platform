export type ContactField = 'name' | 'streetAddress' | 'city' | 'district' | 'phone';

export interface ContactDetails {
  name: string;
  address: string;
  streetAddress: string;
  city: string;
  district: string;
  phone: string;
}

type ContactDetailsInput = Partial<Record<keyof ContactDetails, string | null | undefined>>;

export interface ConversationMessage {
  role: string;
  message: string;
}

const EMPTY_CONTACT_DETAILS: ContactDetails = {
  name: '',
  address: '',
  streetAddress: '',
  city: '',
  district: '',
  phone: '',
};

const LABEL_PATTERN =
  /^(name|street address|street|address\s*\(include city\/town\)|address|delivery address|city\/town|city|town|district|phone number|phone|contact number|mobile number|mobile)\s*[:\-]?\s*(.*)$/i;

const PHONE_PATTERN =
  /(?:\+94\s?\d{2}\s?\d{7}|0\d{9}|\+?\d(?:[\d\s-]{7,}\d))/;

const PLACEHOLDER_VALUES = new Set([
  '',
  'unknown',
  'unknown customer',
  'not provided',
  'none',
  'n/a',
  'na',
]);

const ACKNOWLEDGEMENT_PATTERN =
  /^(yes|yep|yeah|ok|okay|correct|confirmed|confirm|sure|fine|thanks|thank you|yes correct|yes that is correct|that is correct|yes it is correct|it is correct|yes confirm|yes confirm order|yes confirm the order)$/i;

const NON_CONTACT_ONLY_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|how r you|how are u|ok|okay|alright|fine|noted|got it|understood|thanks|thank you|no|nope|cancel|cancel order|cancel the order|stop|later|not now|never mind|nevermind|yes|yep|yeah|correct|confirmed|confirm|yes correct|yes that is correct|that is correct|yes it is correct|it is correct|yes confirm|yes confirm order|yes confirm the order)$/i;

const ORDER_DETAIL_WORD_PATTERN =
  /\b(size|sizes|color|colors|colour|colours|grey|gray|black|white|red|blue|green|pink|yellow|brown|beige|large|medium|small|xl|xxl|2xl|3xl|4xl|order|product|price|stock|available|cod|cash|payment|delivery)\b/i;

const STREET_ADDRESS_HINT_PATTERN =
  /(?:\d|[,/]|(?:^|\b)(?:no|number|road|rd|street|st|lane|mawatha|avenue|ave|drive|dr|place|pl|gardens?|apartment|apt|flat|floor|house|building|junction|cross|path|terrace|estate|watta)(?:\b|$))/i;

const INFERENCE_EXCLUDE_PATTERN =
  /\b(support|agent|human|person|help|number|call|whatsapp|talk|speak|complaint|refund|damage|wrong|status|track|where|location|shop|store|branch|chart|price|cost|total|delivery|exchange|return|dresses|items|available|stock|online|bank|transfer|pay|cod|cash)\b|මාර්|හුවමාරු|ඩැමේජ්|කැඩිලා|වැරදි|සල්ලි|මුදල්|රිෆන්ඩ්|රිටර්න්|ආපහු|නැවත|ශාඛා|කඩේ|විවෘත|වහන්නේ|மாற்ற|எக்சேஞ்ச்|சேதம்|கிழிந்த|தவறான|பணம்|ரீபண்ட்|ரிட்டர்ன்|கடை|கிளை|முகவரி|டெலிவரி/i;

const SRI_LANKA_DISTRICTS = new Set([
  'ampara',
  'anuradhapura',
  'badulla',
  'batticaloa',
  'colombo',
  'galle',
  'gampaha',
  'hambantota',
  'jaffna',
  'kalutara',
  'kandy',
  'kegalle',
  'kilinochchi',
  'kurunegala',
  'mannar',
  'matale',
  'matara',
  'monaragala',
  'mullaitivu',
  'nuwara eliya',
  'polonnaruwa',
  'puttalam',
  'ratnapura',
  'trincomalee',
  'vavuniya',
]);

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(label: string): keyof ContactDetails {
  const normalized = label.trim().toLowerCase();

  if (normalized === 'name') {
    return 'name';
  }

  if (normalized === 'street address' || normalized === 'street') {
    return 'streetAddress';
  }

  if (
    normalized === 'address' ||
    normalized === 'address (include city/town)' ||
    normalized === 'delivery address'
  ) {
    return 'address';
  }

  if (normalized === 'city/town' || normalized === 'city' || normalized === 'town') {
    return 'city';
  }

  if (normalized === 'district') {
    return 'district';
  }

  return 'phone';
}

function isLabelledLine(line: string): boolean {
  return LABEL_PATTERN.test(line.trim());
}

function normalizePhone(phone: string): string {
  const compact = phone.replace(/[^\d+]/g, '');

  if (compact.startsWith('+94')) {
    return compact;
  }

  if (compact.startsWith('94') && compact.length === 11) {
    return `+${compact}`;
  }

  return compact;
}

function sanitizeFieldValue(value: string): string {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return '';
  }

  if (PLACEHOLDER_VALUES.has(normalized.toLowerCase())) {
    return '';
  }

  return normalized;
}

function cleanStoredNameValue(value: string | null | undefined): string {
  const cleaned = sanitizeFieldValue(value ?? '');

  if (!cleaned || isNonContactOnlyMessage(cleaned) || ORDER_DETAIL_WORD_PATTERN.test(cleaned)) {
    return '';
  }

  return cleaned;
}

function cleanStoredAddressPartValue(value: string | null | undefined): string {
  const cleaned = sanitizeFieldValue(value ?? '');

  if (!cleaned || isNonContactOnlyMessage(cleaned)) {
    return '';
  }

  return cleaned;
}

function normalizeComparableAddressPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressPartsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeComparableAddressPart(left);
  const normalizedRight = normalizeComparableAddressPart(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function addressPartContains(container: string, part: string): boolean {
  const normalizedContainer = normalizeComparableAddressPart(container);
  const normalizedPart = normalizeComparableAddressPart(part);

  return Boolean(
    normalizedContainer &&
      normalizedPart &&
      (normalizedContainer.split(' ').includes(normalizedPart) ||
        normalizedContainer.includes(normalizedPart))
  );
}

function isKnownSriLankaDistrict(value: string): boolean {
  return SRI_LANKA_DISTRICTS.has(normalizeComparableAddressPart(value));
}

function buildStructuredAddress(parts: {
  streetAddress?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
}): string {
  const structured = [
    cleanStoredAddressPartValue(parts.streetAddress),
    cleanStoredAddressPartValue(parts.city),
    cleanStoredAddressPartValue(parts.district),
  ].filter(Boolean);

  return structured.length > 0
    ? structured.join(', ')
    : cleanStoredContactValue(parts.address);
}

function cleanAddressString(addressStr: string): string {
  if (!addressStr) {
    return '';
  }

  const parts = addressStr.split(',');
  const cleanedParts = parts.filter((part) => {
    const trimmed = part.trim().toLowerCase();
    if (
      trimmed.startsWith('phone') ||
      trimmed.startsWith('mobile') ||
      trimmed.startsWith('name') ||
      trimmed.startsWith('contact') ||
      trimmed.startsWith('tel')
    ) {
      return false;
    }
    const digitOnly = trimmed.replace(/[\s-+()]/g, '');
    if (digitOnly.length >= 9 && /^\d+$/.test(digitOnly)) {
      return false;
    }
    return true;
  });

  return cleanedParts.join(',').trim();
}

function splitFreeformAddress(address?: string | null): Pick<ContactDetails, 'streetAddress' | 'city' | 'district'> {
  const cleaned = cleanAddressString(cleanStoredContactValue(address));
  const empty = { streetAddress: '', city: '', district: '' };

  if (!cleaned || !cleaned.includes(',')) {
    return empty;
  }

  const parts = cleaned
    .split(',')
    .map((part) => sanitizeFieldValue(part))
    .filter(Boolean);

  if (parts.length >= 3) {
    if (parts.length === 3 && STREET_ADDRESS_HINT_PATTERN.test(parts[1])) {
      return {
        streetAddress: parts.slice(0, 2).join(', '),
        city: parts[2],
        district: '',
      };
    }

    return {
      streetAddress: parts.slice(0, -2).join(', '),
      city: parts[parts.length - 2],
      district: parts[parts.length - 1],
    };
  }

  if (parts.length === 2) {
    if (STREET_ADDRESS_HINT_PATTERN.test(parts[0])) {
      const isDistrict = isKnownSriLankaDistrict(parts[1]);
      return {
        streetAddress: parts[0],
        city: isDistrict ? '' : parts[1],
        district: isDistrict ? parts[1] : '',
      };
    }

    return {
      streetAddress: STREET_ADDRESS_HINT_PATTERN.test(cleaned) ? cleaned : '',
      city: '',
      district: '',
    };
  }

  return empty;
}

function hydrateStructuredAddress(details: ContactDetailsInput): Partial<ContactDetails> {
  const parsed = splitFreeformAddress(details.address);
  const providedStreetAddress = cleanStoredAddressPartValue(details.streetAddress);
  const providedCity = cleanStoredAddressPartValue(details.city);
  const providedDistrict = cleanStoredAddressPartValue(details.district);
  const parsedStreetMatches =
    !providedStreetAddress ||
    !parsed.streetAddress ||
    addressPartsMatch(providedStreetAddress, parsed.streetAddress);
  const parsedCityMatches =
    !providedCity ||
    !parsed.city ||
    addressPartsMatch(providedCity, parsed.city);
  const parsedDistrictMatches =
    !providedDistrict ||
    Boolean(parsed.district && addressPartsMatch(providedDistrict, parsed.district));
  const streetAddress = providedStreetAddress || parsed.streetAddress;
  const city =
    providedCity ||
    (parsedStreetMatches && (!providedDistrict || parsedDistrictMatches)
      ? parsed.city
      : '');
  const district =
    providedDistrict ||
    (parsedStreetMatches && parsedCityMatches ? parsed.district : '');
  const address = buildStructuredAddress({
    streetAddress,
    city,
    district,
    address: details.address,
  });

  return {
    name: cleanStoredNameValue(details.name),
    streetAddress,
    city,
    district,
    address,
    phone: cleanStoredContactValue(details.phone),
  };
}

function normalizeCommaSeparatedLabels(message: string): string {
  const trimmed = message.trim();
  if (trimmed.includes('\n')) {
    return message;
  }

  const labelNames =
    'street address|delivery address|address\\s*\\(include city\\/town\\)|phone number|contact number|mobile number|city\\/town|address|district|mobile|street|phone|city|town|name';
  const commaLabelRegex = new RegExp(
    `,\\s*(?=(?:${labelNames})\\s*[:\\-])`,
    'gi'
  );

  const commaLabelMatches = trimmed.match(commaLabelRegex);
  if (!commaLabelMatches || commaLabelMatches.length < 1) {
    return message;
  }

  return trimmed.replace(commaLabelRegex, '\n');
}

function extractLabelledFields(message: string): Partial<ContactDetails> {
  const normalized = normalizeCommaSeparatedLabels(message);
  const lines = normalized.split(/\r?\n/);
  const extracted: Partial<ContactDetails> = {};

  for (let i = 0; i < lines.length; i += 1) {
    const currentLine = lines[i].trim();
    const match = currentLine.match(LABEL_PATTERN);

    if (!match) {
      continue;
    }

    const field = normalizeLabel(match[1]);
    let value = match[2].trim();

    if (!value) {
      const collectedLines: string[] = [];
      let pointer = i + 1;

      while (pointer < lines.length && !isLabelledLine(lines[pointer])) {
        const candidate = lines[pointer].trim();

        if (candidate) {
          collectedLines.push(candidate);
        }

        pointer += 1;
      }

      value = collectedLines.join(' ');
      i = pointer - 1;
    }

    const sanitizedValue =
      field === 'phone' ? sanitizeFieldValue(normalizePhone(value)) : sanitizeFieldValue(value);

    if (sanitizedValue) {
      extracted[field] = sanitizedValue;
    }
  }

  return hydrateStructuredAddress(extracted);
}

function extractNameFromSentence(message: string): string {
  const patterns = [
    /\bchange name to\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})(?=\s*(?:,|\.|$|\baddress\b|\bphone\b|\bcontact\b|\bmobile\b))/i,
    /\bupdate name to\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})(?=\s*(?:,|\.|$|\baddress\b|\bphone\b|\bcontact\b|\bmobile\b))/i,
    /\bmy name is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})(?=\s*(?:,|\.|$|\baddress\b|\bphone\b|\bcontact\b|\bmobile\b))/i,
    /\bthis is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})(?=\s*(?:,|\.|$|\baddress\b|\bphone\b|\bcontact\b|\bmobile\b))/i,
    /\bname is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})(?=\s*(?:,|\.|$|\baddress\b|\bphone\b|\bcontact\b|\bmobile\b))/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return sanitizeFieldValue(match[1]);
    }
  }

  return '';
}

function extractAddressFromSentence(message: string): string {
  const flattened = message.replace(/\r?\n/g, ' ').trim();
  const patterns = [
    /\b(?:change|update|correct|edit)\s+(?:delivery\s+)?address\s+(?:of|for)\b.*?\bto\b[:\s-]*(.+)$/i,
    /\bchange address to\b[:\s-]*(.+)$/i,
    /\bupdate address to\b[:\s-]*(.+)$/i,
    /\bchange delivery address to\b[:\s-]*(.+)$/i,
    /\bupdate delivery address to\b[:\s-]*(.+)$/i,
    /\bdelivery address is\b[:\s-]*(.+)$/i,
    /\bmy address is\b[:\s-]*(.+)$/i,
    /\baddress is\b[:\s-]*(.+)$/i,
    /\bdeliver to\b[:\s-]*(.+)$/i,
    /\bsend to\b[:\s-]*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = flattened.match(pattern);

    if (match?.[1]) {
      return cleanAddressString(sanitizeFieldValue(match[1]));
    }
  }

  return '';
}

function extractFreeformAddress(message: string): string {
  const flattened = normalizeWhitespace(message.replace(/\r?\n/g, ' '));

  if (!flattened.includes(',')) {
    return '';
  }

  const cleanedAddress = cleanAddressString(flattened);
  if (!cleanedAddress.includes(',')) {
    return '';
  }

  const parts = cleanedAddress
    .split(',')
    .map((part) => sanitizeFieldValue(part))
    .filter(Boolean);

  if (parts.length < 2) {
    return '';
  }

  const streetCandidate = parts.length === 2 ? parts[0] : parts.slice(0, -2).join(', ');

  return STREET_ADDRESS_HINT_PATTERN.test(streetCandidate)
    ? sanitizeFieldValue(cleanedAddress)
    : '';
}

function extractPhoneFromSentence(message: string): string {
  const explicitChangeMatch = message.match(
    /\b(?:change|update|correct|edit)\s+(?:phone number|phone|contact number|mobile number|mobile)(?:\s+(?:of|for)\b.*)?\s+to\b[:\s-]*(.+)$/i
  );

  if (explicitChangeMatch?.[1]) {
    const changedPhone = explicitChangeMatch[1].match(PHONE_PATTERN);

    if (changedPhone?.[0]) {
      return sanitizeFieldValue(normalizePhone(changedPhone[0]));
    }
  }

  const match = message.match(PHONE_PATTERN);

  if (!match?.[0]) {
    return '';
  }

  return sanitizeFieldValue(normalizePhone(match[0]));
}

function localIsUnambiguousCancellationMessage(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    /^(cancel|delete this order|remove this order)\b/.test(normalized) ||
    /^(please cancel|i want to cancel|i would like to cancel|i d like to cancel|can you cancel|can i cancel|want to cancel|wish to cancel)\b/.test(
      normalized
    ) ||
    /^(don t want|dont want|i don t want|i dont want)\b/.test(normalized)
  );
}

function inferSingleMissingFieldReply(message: string, field: ContactField): Partial<ContactDetails> {
  const trimmedMessage = normalizeWhitespace(message);

  if (
    !trimmedMessage ||
    ACKNOWLEDGEMENT_PATTERN.test(trimmedMessage) ||
    isNonContactOnlyMessage(trimmedMessage) ||
    localIsUnambiguousCancellationMessage(trimmedMessage) ||
    (field !== 'name' && INFERENCE_EXCLUDE_PATTERN.test(trimmedMessage))
  ) {
    return {};
  }

  if (field === 'phone') {
    const phone = extractPhoneFromSentence(trimmedMessage);
    return phone ? { phone } : {};
  }

  if (field === 'name') {
    const looksLikeName =
      /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(trimmedMessage);

    return looksLikeName && !ORDER_DETAIL_WORD_PATTERN.test(trimmedMessage)
      ? { name: sanitizeFieldValue(trimmedMessage) }
      : {};
  }

  if (field === 'city' || field === 'district') {
    return trimmedMessage.length >= 2 &&
      !ORDER_DETAIL_WORD_PATTERN.test(trimmedMessage) &&
      !PHONE_PATTERN.test(trimmedMessage) &&
      !/^\d+$/.test(trimmedMessage.replace(/[\s-+()]/g, ''))
      ? { [field]: sanitizeFieldValue(trimmedMessage) }
      : {};
  }

  return trimmedMessage.length >= 4 &&
    !ORDER_DETAIL_WORD_PATTERN.test(trimmedMessage) &&
    STREET_ADDRESS_HINT_PATTERN.test(trimmedMessage)
    ? { streetAddress: sanitizeFieldValue(trimmedMessage) }
    : {};
}

export function cleanStoredContactValue(value: string | null | undefined): string {
  return sanitizeFieldValue(value ?? '');
}

export function cleanStoredContactName(value: string | null | undefined): string {
  return cleanStoredNameValue(value);
}

export function isNonContactOnlyMessage(message: string): boolean {
  const normalized = normalizeWhitespace(message)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return NON_CONTACT_ONLY_PATTERN.test(normalized);
}

export function extractContactDetailsFromText(
  message: string,
  singleMissingField?: ContactField
): Partial<ContactDetails> {
  const extracted = extractLabelledFields(message);

  if (!extracted.name) {
    const name = extractNameFromSentence(message);
    if (name) {
      extracted.name = name;
    }
  }

  if (!extracted.phone) {
    const phone = extractPhoneFromSentence(message);
    if (phone) {
      extracted.phone = phone;
    }
  }

  if (!extracted.address) {
    const address = extractAddressFromSentence(message) || extractFreeformAddress(message);
    if (address) {
      Object.assign(extracted, hydrateStructuredAddress({ ...extracted, address }));
    }
  }

  if (singleMissingField && !extracted[singleMissingField]) {
    return hydrateStructuredAddress({
      ...extracted,
      ...inferSingleMissingFieldReply(message, singleMissingField),
    });
  }

  return hydrateStructuredAddress(extracted);
}

export function mergeContactDetails(
  base: ContactDetailsInput,
  overrides: ContactDetailsInput
): ContactDetails {
  const hydratedBase = hydrateStructuredAddress(base);
  const hydratedOverrides = hydrateStructuredAddress(overrides);
  const overrideStreetAddress = cleanStoredAddressPartValue(hydratedOverrides.streetAddress);
  const overrideCity = cleanStoredAddressPartValue(hydratedOverrides.city);
  const overrideDistrict = cleanStoredAddressPartValue(hydratedOverrides.district);
  const baseCity = cleanStoredAddressPartValue(hydratedBase.city);
  const baseDistrict = cleanStoredAddressPartValue(hydratedBase.district);
  const streetAddress =
    overrideStreetAddress ||
    cleanStoredAddressPartValue(hydratedBase.streetAddress);
  let city = overrideCity || baseCity;
  let district = overrideDistrict || baseDistrict;

  if (
    overrideStreetAddress &&
    !overrideCity &&
    baseCity &&
    STREET_ADDRESS_HINT_PATTERN.test(baseCity) &&
    addressPartContains(overrideStreetAddress, baseCity)
  ) {
    city = '';
  }

  if (
    overrideCity &&
    !overrideDistrict &&
    district &&
    addressPartsMatch(overrideCity, district) &&
    !isKnownSriLankaDistrict(district)
  ) {
    district = '';
  }

  const address = buildStructuredAddress({
    streetAddress,
    city,
    district,
    address:
      cleanStoredContactValue(hydratedOverrides.address) ||
      cleanStoredContactValue(hydratedBase.address),
  });

  return {
    name: cleanStoredNameValue(hydratedOverrides.name) || cleanStoredNameValue(hydratedBase.name),
    address,
    streetAddress,
    city,
    district,
    phone: cleanStoredContactValue(hydratedOverrides.phone) || cleanStoredContactValue(hydratedBase.phone),
  };
}

export function collectContactDetailsFromMessages(
  messages: ConversationMessage[],
  initial?: ContactDetailsInput
): ContactDetails {
  let details = mergeContactDetails(EMPTY_CONTACT_DETAILS, initial ?? {});

  for (const entry of messages) {
    details = mergeContactDetails(details, extractContactDetailsFromText(entry.message));
  }

  return details;
}

export function getMissingContactFields(details: ContactDetailsInput): ContactField[] {
  const missing: ContactField[] = [];
  const hydrated = hydrateStructuredAddress(details);

  if (!cleanStoredNameValue(hydrated.name)) {
    missing.push('name');
  }

  if (!cleanStoredAddressPartValue(hydrated.streetAddress)) {
    missing.push('streetAddress');
  }

  if (!cleanStoredAddressPartValue(hydrated.city)) {
    missing.push('city');
  }

  if (!cleanStoredAddressPartValue(hydrated.district)) {
    missing.push('district');
  }

  if (!cleanStoredContactValue(hydrated.phone)) {
    missing.push('phone');
  }

  return missing;
}

export function formatContactBlock(details: ContactDetailsInput): string {
  const hydrated = hydrateStructuredAddress(details);

  return [
    `Name: ${cleanStoredNameValue(hydrated.name) || 'Missing'}`,
    `Street Address: ${cleanStoredAddressPartValue(hydrated.streetAddress) || 'Missing'}`,
    `City/Town: ${cleanStoredAddressPartValue(hydrated.city) || 'Missing'}`,
    `District: ${cleanStoredAddressPartValue(hydrated.district) || 'Missing'}`,
    `Phone Number: ${cleanStoredContactValue(hydrated.phone) || 'Missing'}`,
  ].join('\n');
}

export function formatDeliveryAddress(details: ContactDetailsInput): string {
  return hydrateStructuredAddress(details).address || '';
}
