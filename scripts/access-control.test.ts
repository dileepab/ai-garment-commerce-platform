import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  can,
  canAccessBrand,
  describeScope,
  getBrandScopedWhere,
  getDefaultHomePath,
  getPagePermissionForPathname,
  getUserScopeFromSessionUser,
  normalizeBrands,
  normalizeRole,
  resolveBrandAccess,
} from '../src/lib/access-control.ts';

test('roles expose the expected high-level permissions', () => {
  assert.equal(can('support', 'support:reply'), true);
  assert.equal(can('support', 'orders:view'), true);
  assert.equal(can('support', 'orders:update'), false);
  assert.equal(can('support', 'dashboard:view'), false);

  assert.equal(can('operations', 'orders:update'), true);
  assert.equal(can('operations', 'production:write'), true);
  assert.equal(can('operations', 'support:view'), true);
  assert.equal(can('operations', 'support:reply'), false);
  assert.equal(can('operations', 'analytics:view'), false);

  assert.equal(can('owner', 'analytics:view'), true);
  assert.equal(can('admin', 'customers:write'), true);
});

test('session users normalize into role and brand scopes', () => {
  const supportScope = getUserScopeFromSessionUser({
    email: 'support@example.com',
    role: 'support',
    brands: ['HappyBy', 'Cleopatra', 'HappyBy'],
  });

  assert.equal(supportScope.role, 'support');
  assert.equal(supportScope.brandAccess, 'limited');
  assert.deepEqual(supportScope.brands, ['HappyBy', 'Cleopatra']);
  assert.equal(describeScope(supportScope), 'HappyBy, Cleopatra');
  assert.equal(canAccessBrand(supportScope, 'HappyBy'), true);
  assert.equal(canAccessBrand(supportScope, 'ModaBella'), false);
  assert.deepEqual(getBrandScopedWhere(supportScope), { brand: { in: ['HappyBy', 'Cleopatra'] } });

  const ownerScope = getUserScopeFromSessionUser({ email: 'admin@example.com' });
  assert.equal(ownerScope.role, 'owner');
  assert.equal(ownerScope.brandAccess, 'all');
  assert.equal(canAccessBrand(ownerScope, null), true);
  assert.deepEqual(getBrandScopedWhere(ownerScope), {});
});

test('role and brand parsing accepts aliases and all-brand markers', () => {
  assert.equal(normalizeRole('ops'), 'operations');
  assert.equal(normalizeRole('operator'), 'operations');
  assert.deepEqual(normalizeBrands('HappyBy, all, Cleopatra, *'), ['HappyBy', 'Cleopatra']);
  assert.equal(resolveBrandAccess('support', []), 'all');
  assert.equal(resolveBrandAccess('support', ['HappyBy']), 'limited');
  assert.equal(resolveBrandAccess('admin', ['HappyBy']), 'all');
});

test('route helpers map pages and login fallbacks by role', () => {
  assert.equal(getPagePermissionForPathname('/support/threads'), 'support:view');
  assert.equal(getPagePermissionForPathname('/orders'), 'orders:view');
  assert.equal(getPagePermissionForPathname('/api/orders'), null);
  assert.equal(getDefaultHomePath('support'), '/support');
  assert.equal(getDefaultHomePath('operations'), '/');
});
