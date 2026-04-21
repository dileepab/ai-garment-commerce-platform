const SRI_LANKA_TIME_ZONE = 'Asia/Colombo';

const SRI_LANKA_PUBLIC_HOLIDAYS = new Set([
  '2026-01-03',
  '2026-01-15',
  '2026-02-01',
  '2026-02-04',
  '2026-02-15',
  '2026-03-02',
  '2026-03-21',
  '2026-04-01',
  '2026-04-03',
  '2026-04-13',
  '2026-04-14',
  '2026-05-01',
  '2026-05-02',
  '2026-05-28',
  '2026-05-30',
  '2026-06-29',
  '2026-07-29',
  '2026-08-26',
  '2026-08-27',
  '2026-09-26',
  '2026-10-25',
  '2026-11-08',
  '2026-11-24',
  '2026-12-23',
  '2026-12-25',
]);

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);

  const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value || '0', 10);
  const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value || '0', 10);
  const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value || '0', 10);

  return { year, month, day };
}

function createUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

export function getSriLankaDateOnly(date: Date): Date {
  const { year, month, day } = getDatePartsInTimeZone(date, SRI_LANKA_TIME_ZONE);
  return createUtcDate(year, month, day);
}

export function getSriLankaToday(): Date {
  return getSriLankaDateOnly(new Date());
}

export function formatSriLankaDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatSriLankaDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function isSriLankaNonWorkingDay(date: Date): boolean {
  const day = date.getUTCDay();

  if (day === 0 || day === 6) {
    return true;
  }

  return SRI_LANKA_PUBLIC_HOLIDAYS.has(formatSriLankaDateKey(date));
}

export function addSriLankaWorkingDays(startDate: Date, workingDays: number): Date {
  let result = new Date(startDate);
  let remaining = workingDays;

  while (remaining > 0) {
    result = addUtcDays(result, 1);

    if (!isSriLankaNonWorkingDay(result)) {
      remaining -= 1;
    }
  }

  return result;
}
