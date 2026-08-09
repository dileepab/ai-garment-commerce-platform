import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listAmbiguousTownNames,
  needsDistrictForDelivery,
} from '../src/lib/delivery-town-ambiguity.ts';
import { getMissingContactFields } from '../src/lib/contact-profile.ts';

test('a town with one delivery point needs no district', () => {
  assert.equal(needsDistrictForDelivery('Bingiriya'), false);
  assert.equal(needsDistrictForDelivery('bingiriya'), false);
});

// Nagoda is in Galle, Kalutara and Gampaha — three provinces.
test('a town sharing its name needs a district', () => {
  assert.equal(needsDistrictForDelivery('Nagoda'), true);
  assert.equal(needsDistrictForDelivery('Miriswatta'), true);
  assert.equal(needsDistrictForDelivery('Palamunai'), true);
});

// Curfox writes "Nagoda (Kalutara)"; a customer types "Nagoda".
test('the bracketed district is stripped before comparing', () => {
  assert.equal(needsDistrictForDelivery('Nagoda (Kalutara)'), true);
});

test('an unknown or empty town does not demand a district on its own', () => {
  assert.equal(needsDistrictForDelivery('Nowhereville'), false);
  assert.equal(needsDistrictForDelivery(''), false);
  assert.equal(needsDistrictForDelivery(null), false);
});

test('the ambiguous list stays small enough to be worth asking about', () => {
  const names = listAmbiguousTownNames();

  assert.ok(names.length > 0, 'expected some ambiguous towns');
  assert.ok(names.length < 120, `ambiguous towns grew to ${names.length}; re-check the prompt cost`);
  assert.ok(names.includes('nagoda'));
});

// The bug this exists to prevent: an address customers consider finished being
// held back for a district, until two puzzled replies escalate them to a human.
test('a street and an unambiguous town is a complete address', () => {
  const missing = getMissingContactFields({
    name: 'Nimali Perera',
    streetAddress: '460/2, Temple Road',
    city: 'Bingiriya',
    district: '',
    phone: '0714123777',
  });

  assert.deepEqual(missing, []);
});

test('a namesake town is still asked for its district', () => {
  const missing = getMissingContactFields({
    name: 'Nimali Perera',
    streetAddress: 'No 5, Main Street',
    city: 'Nagoda',
    district: '',
    phone: '0714123777',
  });

  assert.deepEqual(missing, ['district']);
});

test('giving the district settles a namesake town', () => {
  const missing = getMissingContactFields({
    name: 'Nimali Perera',
    streetAddress: 'No 5, Main Street',
    city: 'Nagoda',
    district: 'Kalutara',
    phone: '0714123777',
  });

  assert.deepEqual(missing, []);
});

test('no town at all still asks for the district', () => {
  const missing = getMissingContactFields({
    name: 'Nimali Perera',
    streetAddress: '',
    city: '',
    district: '',
    phone: '0714123777',
  });

  assert.ok(missing.includes('district'));
  assert.ok(missing.includes('city'));
});
