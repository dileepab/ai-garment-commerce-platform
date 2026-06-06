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
  /^(yes|yep|yeah|ok|okay|correct|confirmed|confirm|sure|fine|thanks|thank you)$/i;

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

function buildStructuredAddress(parts: {
  streetAddress?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
}): string {
  const structured = [
    cleanStoredContactValue(parts.streetAddress),
    cleanStoredContactValue(parts.city),
    cleanStoredContactValue(parts.district),
  ].filter(Boolean);

  return structured.length > 0
    ? structured.join(', ')
    : cleanStoredContactValue(parts.address);
}

function splitFreeformAddress(address?: string | null): Pick<ContactDetails, 'streetAddress' | 'city' | 'district'> {
  const cleaned = cleanStoredContactValue(address);
  const empty = { streetAddress: '', city: '', district: '' };

  if (!cleaned || !cleaned.includes(',')) {
    return empty;
  }

  const parts = cleaned
    .split(',')
    .map((part) => sanitizeFieldValue(part))
    .filter(Boolean);

  if (parts.length >= 3) {
    return {
      streetAddress: parts.slice(0, -2).join(', '),
      city: parts[parts.length - 2],
      district: parts[parts.length - 1],
    };
  }

  if (parts.length === 2) {
    return {
      streetAddress: parts[0],
      city: parts[1],
      district: '',
    };
  }

  return empty;
}

function hydrateStructuredAddress(details: ContactDetailsInput): Partial<ContactDetails> {
  const parsed = splitFreeformAddress(details.address);
  const streetAddress = cleanStoredContactValue(details.streetAddress) || parsed.streetAddress;
  const city = cleanStoredContactValue(details.city) || parsed.city;
  const district = cleanStoredContactValue(details.district) || parsed.district;
  const address = buildStructuredAddress({
    streetAddress,
    city,
    district,
    address: details.address,
  });

  return {
    name: cleanStoredContactValue(details.name),
    streetAddress,
    city,
    district,
    address,
    phone: cleanStoredContactValue(details.phone),
  };
}

function extractLabelledFields(message: string): Partial<ContactDetails> {
  const lines = message.split(/\r?\n/);
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
    /\bchange name to\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\b/i,
    /\bupdate name to\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\b/i,
    /\bmy name is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\b/i,
    /\bthis is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\b/i,
    /\bname is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\b/i,
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
      return sanitizeFieldValue(match[1]);
    }
  }

  return '';
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

function inferSingleMissingFieldReply(message: string, field: ContactField): Partial<ContactDetails> {
  const trimmedMessage = normalizeWhitespace(message);

  if (!trimmedMessage || ACKNOWLEDGEMENT_PATTERN.test(trimmedMessage)) {
    return {};
  }

  if (field === 'phone') {
    const phone = extractPhoneFromSentence(trimmedMessage);
    return phone ? { phone } : {};
  }

  if (field === 'name') {
    const looksLikeName =
      /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(trimmedMessage);

    return looksLikeName ? { name: sanitizeFieldValue(trimmedMessage) } : {};
  }

  if (field === 'city' || field === 'district') {
    return trimmedMessage.length >= 2 ? { [field]: sanitizeFieldValue(trimmedMessage) } : {};
  }

  return trimmedMessage.length >= 4 ? { streetAddress: sanitizeFieldValue(trimmedMessage) } : {};
}

export function cleanStoredContactValue(value: string | null | undefined): string {
  return sanitizeFieldValue(value ?? '');
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
    const address = extractAddressFromSentence(message);
    if (address) {
      Object.assign(extracted, hydrateStructuredAddress({ address }));
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
  const streetAddress =
    cleanStoredContactValue(hydratedOverrides.streetAddress) ||
    cleanStoredContactValue(hydratedBase.streetAddress);
  const city =
    cleanStoredContactValue(hydratedOverrides.city) ||
    cleanStoredContactValue(hydratedBase.city);
  const district =
    cleanStoredContactValue(hydratedOverrides.district) ||
    cleanStoredContactValue(hydratedBase.district);
  const address = buildStructuredAddress({
    streetAddress,
    city,
    district,
    address:
      cleanStoredContactValue(hydratedOverrides.address) ||
      cleanStoredContactValue(hydratedBase.address),
  });

  return {
    name: cleanStoredContactValue(hydratedOverrides.name) || cleanStoredContactValue(hydratedBase.name),
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

  if (!cleanStoredContactValue(hydrated.name)) {
    missing.push('name');
  }

  if (!cleanStoredContactValue(hydrated.streetAddress)) {
    missing.push('streetAddress');
  }

  if (!cleanStoredContactValue(hydrated.city)) {
    missing.push('city');
  }

  if (!cleanStoredContactValue(hydrated.district)) {
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
    `Name: ${cleanStoredContactValue(hydrated.name) || 'Missing'}`,
    `Street Address: ${cleanStoredContactValue(hydrated.streetAddress) || 'Missing'}`,
    `City/Town: ${cleanStoredContactValue(hydrated.city) || 'Missing'}`,
    `District: ${cleanStoredContactValue(hydrated.district) || 'Missing'}`,
    `Phone Number: ${cleanStoredContactValue(hydrated.phone) || 'Missing'}`,
  ].join('\n');
}

export function formatDeliveryAddress(details: ContactDetailsInput): string {
  return hydrateStructuredAddress(details).address || '';
}
