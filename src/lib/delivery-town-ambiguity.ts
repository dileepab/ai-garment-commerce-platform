/**
 * Towns whose name alone does not identify a delivery point.
 *
 * Most Sri Lankan addresses are complete as street and town — nobody writes
 * their district, and the courier does not need it. But 51 town names in the
 * Royal Express list belong to two or three different places (Nagoda exists in
 * Galle, Kalutara and Gampaha), and the courier refuses to guess between them.
 *
 * So the district is asked for exactly when it decides something. Demanding it
 * from everyone stalls orders on a question customers think they have already
 * answered; never asking pushes the same problem to whoever runs the courier
 * batch, one step further from the person who knows the answer.
 */

import cityList from '../data/royalexpress-city-list.json' with { type: 'json' };

interface DeliveryCityRecord {
  id: number;
  name: string;
}

function normalizeTownName(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/\(.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Town names carried by more than one delivery point.
 *
 * The bracketed district Curfox appends — "Nagoda (Kalutara)" — is stripped
 * first, because it is the bare name a customer types that has to be told
 * apart.
 */
const AMBIGUOUS_TOWN_NAMES: ReadonlySet<string> = (() => {
  const idsByName = new Map<string, Set<number>>();

  for (const record of cityList as DeliveryCityRecord[]) {
    const name = normalizeTownName(record.name);
    if (!name) continue;

    const ids = idsByName.get(name) ?? new Set<number>();
    ids.add(record.id);
    idsByName.set(name, ids);
  }

  const ambiguous = new Set<string>();
  for (const [name, ids] of idsByName) {
    if (ids.size > 1) ambiguous.add(name);
  }

  return ambiguous;
})();

/** True when this town shares its name with another and needs a district. */
export function needsDistrictForDelivery(city?: string | null): boolean {
  const name = normalizeTownName(city);
  return name.length > 0 && AMBIGUOUS_TOWN_NAMES.has(name);
}

/** Exposed for tests and for anyone auditing how often this fires. */
export function listAmbiguousTownNames(): string[] {
  return [...AMBIGUOUS_TOWN_NAMES].sort();
}
