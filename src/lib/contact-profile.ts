export type ContactField = 'name' | 'address' | 'phone';

export interface ContactDetails {
  name: string;
  address: string;
  phone: string;
}

export interface ConversationMessage {
  role: string;
  message: string;
}

const EMPTY_CONTACT_DETAILS: ContactDetails = {
  name: '',
  address: '',
  phone: '',
};

const LABEL_PATTERN =
  /^(name|address|delivery address|phone number|phone|contact number|mobile number|mobile)\s*[:\-]?\s*(.*)$/i;

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

function normalizeLabel(label: string): ContactField {
  const normalized = label.trim().toLowerCase();

  if (normalized === 'name') {
    return 'name';
  }

  if (normalized === 'address' || normalized === 'delivery address') {
    return 'address';
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

  return extracted;
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

  return trimmedMessage.length >= 8 ? { address: sanitizeFieldValue(trimmedMessage) } : {};
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
      extracted.address = address;
    }
  }

  if (singleMissingField && !extracted[singleMissingField]) {
    return { ...extracted, ...inferSingleMissingFieldReply(message, singleMissingField) };
  }

  return extracted;
}

export function mergeContactDetails(
  base: Partial<ContactDetails>,
  overrides: Partial<ContactDetails>
): ContactDetails {
  return {
    name: cleanStoredContactValue(overrides.name) || cleanStoredContactValue(base.name),
    address: cleanStoredContactValue(overrides.address) || cleanStoredContactValue(base.address),
    phone: cleanStoredContactValue(overrides.phone) || cleanStoredContactValue(base.phone),
  };
}

export function collectContactDetailsFromMessages(
  messages: ConversationMessage[],
  initial?: Partial<ContactDetails>
): ContactDetails {
  let details = mergeContactDetails(EMPTY_CONTACT_DETAILS, initial ?? {});

  for (const entry of messages) {
    details = mergeContactDetails(details, extractContactDetailsFromText(entry.message));
  }

  return details;
}

export function getMissingContactFields(details: Partial<ContactDetails>): ContactField[] {
  const missing: ContactField[] = [];

  if (!cleanStoredContactValue(details.name)) {
    missing.push('name');
  }

  if (!cleanStoredContactValue(details.address)) {
    missing.push('address');
  }

  if (!cleanStoredContactValue(details.phone)) {
    missing.push('phone');
  }

  return missing;
}

export function formatContactBlock(details: Partial<ContactDetails>): string {
  return [
    `Name: ${cleanStoredContactValue(details.name) || 'Missing'}`,
    `Address: ${cleanStoredContactValue(details.address) || 'Missing'}`,
    `Phone Number: ${cleanStoredContactValue(details.phone) || 'Missing'}`,
  ].join('\n');
}
