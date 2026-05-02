import {
  normalizeBrands,
  normalizeRole,
  resolveBrandAccess,
  type BrandAccess,
  type UserRole,
} from '@/lib/access-control';

interface ConfiguredUserInput {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  role?: unknown;
  brands?: unknown;
  stores?: unknown;
}

export interface AuthorizedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  brands: string[];
  brandAccess: BrandAccess;
}

interface ConfiguredUser extends AuthorizedUser {
  password: string;
}

function normalizeConfiguredUser(input: ConfiguredUserInput, fallbackRole: UserRole): ConfiguredUser | null {
  if (typeof input.email !== 'string' || typeof input.password !== 'string') {
    return null;
  }

  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    return null;
  }

  const role = normalizeRole(input.role, fallbackRole);
  const brands = normalizeBrands(input.brands ?? input.stores);

  return {
    id: `user:${email}`,
    name: typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : email.split('@')[0] || 'GarmentOS User',
    email,
    password,
    role,
    brands,
    brandAccess: resolveBrandAccess(role, brands),
  };
}

function parseJsonUsers(): ConfiguredUser[] {
  const raw = process.env.GARMENTOS_USERS;
  if (!raw?.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { users?: unknown }).users)
        ? (parsed as { users: unknown[] }).users
        : [];

    return entries
      .map((entry) => normalizeConfiguredUser(entry as ConfiguredUserInput, 'support'))
      .filter((user): user is ConfiguredUser => Boolean(user));
  } catch {
    return [];
  }
}

function shortcutUser(
  role: UserRole,
  email: string | undefined,
  password: string | undefined,
  brands: string | undefined,
  name: string
): ConfiguredUser | null {
  return normalizeConfiguredUser(
    {
      email,
      password,
      name,
      role,
      brands,
    },
    role
  );
}

function getConfiguredUsers(): ConfiguredUser[] {
  const legacyAdmin = normalizeConfiguredUser(
    {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      name: 'Admin',
      role: 'owner',
    },
    'owner'
  );

  return [
    legacyAdmin,
    shortcutUser('support', process.env.SUPPORT_EMAIL, process.env.SUPPORT_PASSWORD, process.env.SUPPORT_BRANDS, 'Support'),
    shortcutUser(
      'operations',
      process.env.OPERATIONS_EMAIL,
      process.env.OPERATIONS_PASSWORD,
      process.env.OPERATIONS_BRANDS,
      'Operations'
    ),
    ...parseJsonUsers(),
  ].filter((user): user is ConfiguredUser => Boolean(user));
}

export function findAuthorizedUser(email: unknown, password: unknown): AuthorizedUser | null {
  if (typeof email !== 'string' || typeof password !== 'string') {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return null;

  const user = getConfiguredUsers().find(
    (candidate) => candidate.email === normalizedEmail && candidate.password === password
  );

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    brands: user.brands,
    brandAccess: user.brandAccess,
  };
}
