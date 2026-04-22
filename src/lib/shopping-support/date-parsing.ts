import { ConversationMessage } from '@/lib/contact-profile';

export const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export function parseRequestedDate(message: string, referenceDate: Date): Date | null {
  const dayMonthMatch = message.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );

  if (!dayMonthMatch?.[1] || !dayMonthMatch[2]) {
    return null;
  }

  const day = Number.parseInt(dayMonthMatch[1], 10);
  const month = MONTH_MAP[dayMonthMatch[2].toLowerCase()];

  if (!Number.isInteger(day) || month === undefined) {
    return null;
  }

  const candidate = new Date(Date.UTC(referenceDate.getUTCFullYear(), month, day));

  if (candidate < referenceDate) {
    return new Date(Date.UTC(referenceDate.getUTCFullYear() + 1, month, day));
  }

  return candidate;
}

export function parseDayOnlyRequestedDate(message: string, referenceDate: Date): Date | null {
  const dayOnlyMatch = message.match(/\bbefore\b.*\b(\d{1,2})(?:st|nd|rd|th)?\b/i);

  if (!dayOnlyMatch?.[1]) {
    return null;
  }

  const day = Number.parseInt(dayOnlyMatch[1], 10);

  if (!Number.isInteger(day)) {
    return null;
  }

  const candidate = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), day)
  );

  if (candidate < referenceDate) {
    return new Date(
      Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, day)
    );
  }

  return candidate;
}

export function resolveRequestedDeliveryDate(
  currentMessage: string,
  messages: ConversationMessage[],
  referenceDate: Date
): Date | null {
  const explicitDate = parseRequestedDate(currentMessage, referenceDate);

  if (explicitDate) {
    return explicitDate;
  }

  const dayOnlyDate = parseDayOnlyRequestedDate(currentMessage, referenceDate);

  if (dayOnlyDate) {
    return dayOnlyDate;
  }

  const recentUserMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.message)
    .slice()
    .reverse();

  for (const message of recentUserMessages) {
    const priorDate = parseRequestedDate(message, referenceDate);

    if (priorDate) {
      return priorDate;
    }
  }

  return null;
}
