import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSubscriptionBrands,
  subscriptionCoversBrand,
} from '../src/lib/push-targeting.ts';

test('an operator with no brand list hears about every brand', () => {
  // Owners and admins carry an empty list and full access.
  assert.equal(subscriptionCoversBrand({ brands: '[]' }, 'Happybuy'), true);
  assert.equal(subscriptionCoversBrand({ brands: null }, 'Cleopatra'), true);
  assert.equal(subscriptionCoversBrand({ brands: '' }, 'DEEZ'), true);
});

test('a brand-scoped operator is not woken for another brand', () => {
  const happybuyOnly = { brands: '["Happybuy"]' };

  assert.equal(subscriptionCoversBrand(happybuyOnly, 'Happybuy'), true);
  assert.equal(subscriptionCoversBrand(happybuyOnly, 'Cleopatra'), false);
  assert.equal(subscriptionCoversBrand(happybuyOnly, 'Modabella'), false);
});

test('brand aliases are honoured so a stored spelling still matches', () => {
  // The platform stores "Happyby" for the same brand the storefront calls
  // "happybuyfashion"; a notification must not be lost between spellings.
  assert.equal(subscriptionCoversBrand({ brands: '["Happybuy"]' }, 'Happyby'), true);
  assert.equal(subscriptionCoversBrand({ brands: '["happyby"]' }, 'Happybuy'), true);
  assert.equal(subscriptionCoversBrand({ brands: '["Happybuy"]' }, 'happybuyfashion'), true);
});

test('a conversation with no brand still reaches somebody', () => {
  assert.equal(subscriptionCoversBrand({ brands: '["Happybuy"]' }, null), true);
  assert.equal(subscriptionCoversBrand({ brands: '["Happybuy"]' }, '  '), true);
  assert.equal(subscriptionCoversBrand({ brands: '["Happybuy"]' }, undefined), true);
});

test('a multi-brand operator hears about each of theirs and no others', () => {
  const twoBrands = { brands: '["Happybuy","Cleopatra"]' };

  assert.equal(subscriptionCoversBrand(twoBrands, 'Happybuy'), true);
  assert.equal(subscriptionCoversBrand(twoBrands, 'Cleopatra'), true);
  assert.equal(subscriptionCoversBrand(twoBrands, 'Modabella'), false);
  assert.equal(subscriptionCoversBrand(twoBrands, 'DEEZ'), false);
});

test('a malformed brand list never silently narrows to nobody', () => {
  assert.deepEqual(parseSubscriptionBrands('not json'), []);
  assert.deepEqual(parseSubscriptionBrands('{"brand":"Happybuy"}'), []);
  assert.deepEqual(parseSubscriptionBrands('["Happybuy", 7, "", "Cleopatra"]'), [
    'Happybuy',
    'Cleopatra',
  ]);
  // Falling back to an empty list means "all brands", so a corrupted row still
  // reaches its operator rather than going quiet on them.
  assert.equal(subscriptionCoversBrand({ brands: 'not json' }, 'Happybuy'), true);
});
