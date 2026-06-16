import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getUserScopeFromSessionUser, isAuthorizationError } from '../src/lib/access-control.ts';
import {
  getSelectedBrandScopedWhere,
  getSelectedBrandScopeValues,
  getSelectedProductBrandScopedWhere,
  normalizeSelectedBrand,
  resolveSelectedBrand,
} from '../src/lib/brand-context.ts';

const limitedScope = getUserScopeFromSessionUser({
  email: 'ops@example.com',
  role: 'operations',
  brands: ['Happybuy', 'Cleopatra'],
});
const ownerScope = getUserScopeFromSessionUser({ email: 'owner@example.com' });

test('normalizeSelectedBrand treats all-brands tokens as no selection', () => {
  assert.equal(normalizeSelectedBrand(undefined), null);
  assert.equal(normalizeSelectedBrand(null), null);
  assert.equal(normalizeSelectedBrand(''), null);
  assert.equal(normalizeSelectedBrand('   '), null);
  assert.equal(normalizeSelectedBrand('all'), null);
  assert.equal(normalizeSelectedBrand('All Brands'), null);
  assert.equal(normalizeSelectedBrand('*'), null);
  assert.equal(normalizeSelectedBrand('  Happybuy '), 'Happybuy');
});

test('resolveSelectedBrand validates the selection against the scope', () => {
  assert.equal(resolveSelectedBrand(limitedScope, null), null);
  assert.equal(resolveSelectedBrand(limitedScope, 'all'), null);
  assert.equal(resolveSelectedBrand(limitedScope, 'Happybuy'), 'Happybuy');
  // owner/admin may select any brand
  assert.equal(resolveSelectedBrand(ownerScope, 'Modabella'), 'Modabella');
  // a limited user selecting an out-of-scope brand is rejected with a 403
  assert.throws(
    () => resolveSelectedBrand(limitedScope, 'Modabella'),
    (err: unknown) => isAuthorizationError(err) && err.status === 403,
  );
});

test('getSelectedBrandScopedWhere falls back to scope, narrows on selection, rejects unauthorized', () => {
  // no selection → the user's full permitted scope
  assert.deepEqual(getSelectedBrandScopedWhere(limitedScope), {
    brand: { in: ['Happybuy', 'Cleopatra'] },
  });
  assert.deepEqual(getSelectedBrandScopedWhere(ownerScope), {});
  // an all-brands token also falls back to scope
  assert.deepEqual(getSelectedBrandScopedWhere(ownerScope, 'all'), {});
  // a valid selection narrows to that single brand
  assert.deepEqual(getSelectedBrandScopedWhere(limitedScope, 'Cleopatra'), { brand: 'Cleopatra' });
  assert.deepEqual(getSelectedBrandScopedWhere(ownerScope, 'Happybuy'), { brand: 'Happybuy' });
  // an unauthorized selection is never silently widened
  assert.throws(() => getSelectedBrandScopedWhere(limitedScope, 'Modabella'), isAuthorizationError);
});

test('product-related and value-list helpers mirror the base scope helpers', () => {
  assert.deepEqual(getSelectedProductBrandScopedWhere(limitedScope), {
    product: { brand: { in: ['Happybuy', 'Cleopatra'] } },
  });
  assert.deepEqual(getSelectedProductBrandScopedWhere(limitedScope, 'Happybuy'), {
    product: { brand: 'Happybuy' },
  });
  assert.deepEqual(getSelectedProductBrandScopedWhere(ownerScope), {});
  assert.throws(
    () => getSelectedProductBrandScopedWhere(limitedScope, 'Modabella'),
    isAuthorizationError,
  );

  assert.deepEqual(getSelectedBrandScopeValues(limitedScope), ['Happybuy', 'Cleopatra']);
  assert.deepEqual(getSelectedBrandScopeValues(limitedScope, 'Cleopatra'), ['Cleopatra']);
  assert.equal(getSelectedBrandScopeValues(ownerScope), null);
  assert.deepEqual(getSelectedBrandScopeValues(ownerScope, 'Modabella'), ['Modabella']);
});
