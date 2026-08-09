import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findBestRoyalExpressCityRecord,
  normalizeCityText,
  scoreRoyalExpressCityRecord,
} from '../src/lib/royal-express-city-match.ts';
import royalExpressCityList from '../src/data/royalexpress-city-list.json' with { type: 'json' };

const CITY_RECORDS = (royalExpressCityList as Array<{ id: number; name: string }>).map(
  (city) => ({ id: city.id, name: city.name, city_name: city.name })
);

function targetFor(city: string, district = '', extra = '') {
  return {
    city: normalizeCityText(city),
    district: normalizeCityText(district),
    address: normalizeCityText([extra, city, district].filter(Boolean).join(' ')),
  };
}

test('an exact city name outranks a district match', () => {
  const record = { id: '7', city_name: 'Bingiriya', district_name: 'Kurunegala' };

  assert.equal(scoreRoyalExpressCityRecord(record, targetFor('Bingiriya', 'Kurunegala')), 135);
  assert.equal(scoreRoyalExpressCityRecord(record, targetFor('Bingiriya')), 100);
  // District alone never carries a match on its own strength.
  assert.equal(scoreRoyalExpressCityRecord(record, targetFor('', 'Kurunegala')), 35);
});

test('a record with no id or no name cannot be selected', () => {
  assert.equal(scoreRoyalExpressCityRecord({ city_name: 'Bingiriya' }, targetFor('Bingiriya')), 0);
  assert.equal(scoreRoyalExpressCityRecord({ id: '7' }, targetFor('Bingiriya')), 0);
});

// The failure this guard exists to prevent: a parcel sent to the wrong town
// that nobody notices until the customer calls.
test('two towns sharing a name are reported, not guessed', () => {
  const records = [
    { id: '372', city_name: 'Soranathota' },
    { id: '2792', city_name: 'Soranathota' },
  ];

  const match = findBestRoyalExpressCityRecord(records, targetFor('Soranathota'));

  assert.deepEqual(match.ambiguousCityIds.sort(), ['2792', '372']);
});

test('a district separates two towns that share a name', () => {
  const records = [
    { id: '372', city_name: 'Soranathota', district_name: 'Badulla' },
    { id: '2792', city_name: 'Soranathota', district_name: 'Kandy' },
  ];

  const match = findBestRoyalExpressCityRecord(records, targetFor('Soranathota', 'Badulla'));

  assert.deepEqual(match.ambiguousCityIds, []);
  assert.equal(match.best?.cityId, '372');
});

test('an unambiguous city is chosen outright', () => {
  const records = [
    { id: '7', city_name: 'Bingiriya' },
    { id: '9', city_name: 'Kurunegala' },
  ];

  const match = findBestRoyalExpressCityRecord(records, targetFor('Bingiriya', 'Kurunegala'));

  assert.deepEqual(match.ambiguousCityIds, []);
  assert.equal(match.best?.cityId, '7');
});

test('no match at all is distinct from an ambiguous one', () => {
  const match = findBestRoyalExpressCityRecord(
    [{ id: '7', city_name: 'Bingiriya' }],
    targetFor('Nowhereville')
  );

  assert.equal(match.best, null);
  assert.deepEqual(match.ambiguousCityIds, []);
});

// The whole point of relaxing the district requirement: a street and a town
// still resolve to one destination.
test('an address without a district still resolves against the real city list', () => {
  const match = findBestRoyalExpressCityRecord(
    CITY_RECORDS,
    targetFor('Bingiriya', '', '460/2 Temple Road')
  );

  assert.deepEqual(match.ambiguousCityIds, [], 'Bingiriya should not be ambiguous');
  assert.ok(match.best, 'expected a destination for a street and town');
});

// Plain substring matching sent "Nagoda" to "Pannimulla Panagoda" — a
// different town in a different district, and a parcel across the island.
test('a town name does not match inside a longer one', () => {
  const match = findBestRoyalExpressCityRecord(
    CITY_RECORDS,
    targetFor('Nagoda', 'Kalutara', 'No 5 Main Street')
  );

  assert.equal(match.best?.record.name, 'Nagoda (Kalutara)');
  assert.deepEqual(match.ambiguousCityIds, []);
});

// Curfox writes the district into the name for towns that repeat, so a
// customer who gave the district has already chosen between them.
test('the district in the address picks between namesake towns', () => {
  const galle = findBestRoyalExpressCityRecord(
    CITY_RECORDS,
    targetFor('Nagoda', 'Galle', 'No 5 Main Street')
  );

  assert.equal(galle.best?.record.name, 'Nagoda (Galle)');
  assert.deepEqual(galle.ambiguousCityIds, []);
});

test('a namesake town with no district is refused rather than guessed', () => {
  const match = findBestRoyalExpressCityRecord(CITY_RECORDS, targetFor('Nagoda'));

  // Galle, Kalutara and Gampaha — three provinces, no way to choose.
  assert.equal(match.ambiguousCityIds.length, 3);
});

// Curfox disambiguates 50 of the 51 repeated base names with a "(District)"
// suffix. Soranathota is the one pair carrying identical bare names, so no
// address can separate them — worth knowing if that count ever changes.
test('only one pair of records shares an identical bare name', () => {
  const byName = new Map<string, Set<string>>();
  for (const record of CITY_RECORDS) {
    const name = normalizeCityText(record.name);
    if (!name) continue;
    const ids = byName.get(name) ?? new Set<string>();
    ids.add(String(record.id));
    byName.set(name, ids);
  }

  const repeated = [...byName.entries()].filter(([, ids]) => ids.size > 1).map(([name]) => name);

  assert.deepEqual(repeated, ['soranathota']);
});
