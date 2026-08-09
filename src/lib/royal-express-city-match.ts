/**
 * Choosing a Royal Express destination city from a delivery address.
 *
 * Curfox wants a destination city id; customers write "460/2, Temple Road,
 * Bingiriya". Matching is by score: an exact city name is worth far more than a
 * district, because the city is what identifies a delivery point and the
 * district only narrows it.
 *
 * The part that matters is what happens when two places score the same. Town
 * names repeat across districts, and an address often names more than one
 * place. Picking whichever record sorted first produces a parcel sent to the
 * wrong town that nobody notices until the customer calls — so a real tie is
 * reported and left for a person.
 *
 * Kept free of prisma and path aliases so the scoring can be tested directly
 * against the real city list.
 */

export type CurfoxResponseValue =
  | string
  | number
  | boolean
  | null
  | CurfoxResponseValue[]
  | { [key: string]: CurfoxResponseValue };

export interface RoyalExpressCityMatch {
  record: Record<string, CurfoxResponseValue>;
  cityId: string;
  score: number;
}

export interface RoyalExpressCityMatchResult {
  best: RoyalExpressCityMatch | null;
  /**
   * Distinct destination ids that tied for the top score. Non-empty means the
   * address does not name one place well enough to choose between them.
   */
  ambiguousCityIds: string[];
}

export interface RoyalExpressCityTarget {
  city: string;
  district: string;
  address: string;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function getRecordString(
  record: Record<string, CurfoxResponseValue>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const cleaned = cleanOptionalText(String(value));
      if (cleaned) return cleaned;
    }
  }
  return null;
}

export function normalizeCityText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getRoyalExpressCityId(
  record: Record<string, CurfoxResponseValue>
): string | null {
  return getRecordString(record, [
    'city_id',
    'cityId',
    'destination_city_id',
    'destinationCityId',
    'id',
    'value',
  ]);
}

export function getRoyalExpressCityName(
  record: Record<string, CurfoxResponseValue>
): string | null {
  return getRecordString(record, ['city_name', 'cityName', 'name', 'city', 'label', 'text']);
}

export function getRoyalExpressDistrictName(
  record: Record<string, CurfoxResponseValue>
): string | null {
  return getRecordString(record, ['district_name', 'districtName', 'district']);
}

/**
 * Whole-word containment.
 *
 * Plain substring matching made "Nagoda" match "Pannimulla Panagoda", which is
 * a different town in a different district — the sort of near-miss that ships a
 * parcel across the island.
 */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

export function scoreRoyalExpressCityRecord(
  record: Record<string, CurfoxResponseValue>,
  target: RoyalExpressCityTarget
): number {
  const id = getRoyalExpressCityId(record);
  const cityName = normalizeCityText(getRoyalExpressCityName(record));
  if (!id || !cityName) return 0;

  const districtName = normalizeCityText(getRoyalExpressDistrictName(record));
  let score = 0;

  if (target.city && cityName === target.city) score += 100;
  else if (target.city && containsPhrase(cityName, target.city)) score += 70;
  else if (target.city && containsPhrase(target.city, cityName)) score += 50;
  else if (target.address && containsPhrase(target.address, cityName)) score += 35;

  // Curfox disambiguates repeated town names by writing the district into the
  // name itself — "Nagoda (Kalutara)" against "Nagoda (Galle)". A customer who
  // gave the district has already said which one they mean, so the record whose
  // whole name appears in their address wins over its namesakes.
  if (score > 0 && target.address && cityName.includes(' ') && containsPhrase(target.address, cityName)) {
    score += 25;
  }

  if (target.district && districtName === target.district) score += 35;
  else if (target.district && containsPhrase(districtName, target.district)) score += 20;
  else if (target.district && containsPhrase(target.address, districtName)) score += 10;

  return score;
}

export function findBestRoyalExpressCityRecord(
  records: Array<Record<string, CurfoxResponseValue>>,
  target: RoyalExpressCityTarget
): RoyalExpressCityMatchResult {
  const scored = records
    .map((record) => ({
      record,
      cityId: getRoyalExpressCityId(record),
      score: scoreRoyalExpressCityRecord(record, target),
    }))
    .filter((candidate): candidate is RoyalExpressCityMatch =>
      Boolean(candidate.cityId && candidate.score > 0)
    )
    .sort((a, b) => b.score - a.score);

  const best = scored[0] ?? null;
  if (!best) {
    return { best: null, ambiguousCityIds: [] };
  }

  const tiedCityIds = Array.from(
    new Set(
      scored
        .filter((candidate) => candidate.score === best.score)
        .map((candidate) => candidate.cityId)
    )
  );

  return {
    best,
    ambiguousCityIds: tiedCityIds.length > 1 ? tiedCityIds : [],
  };
}
