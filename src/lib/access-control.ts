export const USER_ROLES = ['owner', 'admin', 'support', 'operations'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type BrandAccess = 'all' | 'limited';

export interface UserScope {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role: UserRole;
  brands: string[];
  brandAccess: BrandAccess;
}

export type Permission =
  | 'dashboard:view'
  | 'analytics:view'
  | 'orders:view'
  | 'orders:update'
  | 'support:view'
  | 'support:reply'
  | 'products:view'
  | 'products:write'
  | 'production:view'
  | 'production:write'
  | 'operators:view'
  | 'operators:write'
  | 'inventory:view'
  | 'inventory:reserve'
  | 'customers:view'
  | 'customers:write'
  | 'settings:view'
  | 'settings:write';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  support: 'Support',
  operations: 'Operations',
};

const ALL_PERMISSIONS: Permission[] = [
  'dashboard:view',
  'analytics:view',
  'orders:view',
  'orders:update',
  'support:view',
  'support:reply',
  'products:view',
  'products:write',
  'production:view',
  'production:write',
  'operators:view',
  'operators:write',
  'inventory:view',
  'inventory:reserve',
  'customers:view',
  'customers:write',
  'settings:view',
  'settings:write',
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  support: ['orders:view', 'support:view', 'support:reply'],
  operations: [
    'dashboard:view',
    'orders:view',
    'orders:update',
    'support:view',
    'products:view',
    'products:write',
    'production:view',
    'production:write',
    'operators:view',
    'operators:write',
    'inventory:view',
    'inventory:reserve',
  ],
};

const PAGE_PERMISSIONS: { prefix: string; permission: Permission }[] = [
  { prefix: '/analytics', permission: 'analytics:view' },
  { prefix: '/settings', permission: 'settings:view' },
  { prefix: '/operators', permission: 'operators:view' },
  { prefix: '/production', permission: 'production:view' },
  { prefix: '/products', permission: 'products:view' },
  { prefix: '/support', permission: 'support:view' },
  { prefix: '/orders', permission: 'orders:view' },
  { prefix: '/', permission: 'dashboard:view' },
];

export function normalizeRole(value: unknown, fallback: UserRole = 'support'): UserRole {
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'operator') return 'operations';
  if (normalized === 'ops') return 'operations';

  return USER_ROLES.includes(normalized as UserRole)
    ? (normalized as UserRole)
    : fallback;
}

export function normalizeBrands(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const brands = rawValues
    .map((brand) => String(brand).trim())
    .filter(Boolean)
    .filter((brand) => !['*', 'all'].includes(brand.toLowerCase()));

  return Array.from(new Set(brands));
}

export function resolveBrandAccess(role: UserRole, brands: string[]): BrandAccess {
  if (role === 'owner' || role === 'admin') return 'all';
  return brands.length > 0 ? 'limited' : 'all';
}

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return can(role, permission);
}

export function canScope(scope: UserScope, permission: Permission): boolean {
  return can(scope.role, permission);
}

export function getPagePermissionForPathname(pathname: string): Permission | null {
  const normalized = pathname === '' ? '/' : pathname;
  const match = PAGE_PERMISSIONS.find(({ prefix }) => {
    if (prefix === '/') return normalized === '/';
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });

  return match?.permission ?? null;
}

export function getDefaultHomePath(role: UserRole): string {
  if (role === 'support') return '/support';
  return '/';
}

export function getUserScopeFromSessionUser(user: {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: unknown;
  brands?: unknown;
  brandAccess?: unknown;
}): UserScope {
  const role = normalizeRole(user.role, 'owner');
  const brands = normalizeBrands(user.brands);
  const brandAccess =
    user.brandAccess === 'limited' && brands.length > 0
      ? 'limited'
      : resolveBrandAccess(role, brands);

  return {
    id: user.id ?? null,
    name: user.name ?? null,
    email: user.email ?? null,
    role,
    brands,
    brandAccess,
  };
}

export function getBrandScopeValues(scope: UserScope): string[] | null {
  return scope.brandAccess === 'limited' ? scope.brands : null;
}

export function getBrandScopedWhere(scope: UserScope) {
  const brands = getBrandScopeValues(scope);
  return brands ? { brand: { in: brands } } : {};
}

export function getProductBrandScopedWhere(scope: UserScope) {
  const brands = getBrandScopeValues(scope);
  return brands ? { product: { brand: { in: brands } } } : {};
}

export function canAccessBrand(scope: UserScope, brand?: string | null): boolean {
  if (scope.brandAccess === 'all') return true;
  if (!brand) return false;
  return scope.brands.includes(brand);
}

export function describeScope(scope: UserScope): string {
  if (scope.brandAccess === 'all') return 'All brands';
  return scope.brands.join(', ');
}
