import {
  AuthorizationError,
  canAccessBrand,
  getBrandScopedWhere,
  getBrandScopeValues,
  getProductBrandScopedWhere,
  type UserScope,
} from './access-control.ts';

/**
 * The global brand switcher stores the active brand in the `brand` query param.
 * These tokens all mean "no specific brand" — fall back to the user's full scope.
 */
const ALL_BRANDS_TOKENS = new Set(['', 'all', 'all brands', '*']);

export const BRAND_QUERY_PARAM = 'brand';

/**
 * Normalize a raw `?brand=` value into either a concrete brand string or `null`
 * (meaning "All Brands" / no selection). Never trusts the value for access — that
 * is the job of {@link resolveSelectedBrand}.
 */
export function normalizeSelectedBrand(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (ALL_BRANDS_TOKENS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Resolve the selected brand against the user's scope.
 *
 * - Returns `null` when no brand is selected ("All Brands").
 * - Returns the brand string when one is selected and the user may access it.
 * - Throws {@link AuthorizationError} when a brand is selected but out of scope.
 *
 * Pages and API routes should let this throw and surface an access error rather
 * than silently widening the scope — the client-selected brand is never trusted.
 */
export function resolveSelectedBrand(
  scope: UserScope,
  selectedBrand?: string | null
): string | null {
  const brand = normalizeSelectedBrand(selectedBrand);
  if (!brand) return null;
  if (!canAccessBrand(scope, brand)) {
    throw new AuthorizationError(`You do not have access to the "${brand}" brand.`);
  }
  return brand;
}

/**
 * Prisma `where` fragment for models with a top-level `brand` column, combining
 * the user's access scope with the optional selected brand. Mirrors
 * {@link getBrandScopedWhere} when nothing is selected.
 */
export function getSelectedBrandScopedWhere(scope: UserScope, selectedBrand?: string | null) {
  const brand = resolveSelectedBrand(scope, selectedBrand);
  return brand ? { brand } : getBrandScopedWhere(scope);
}

/**
 * Prisma `where` fragment for models related to a product via `product.brand`.
 * Mirrors {@link getProductBrandScopedWhere} when nothing is selected.
 */
export function getSelectedProductBrandScopedWhere(
  scope: UserScope,
  selectedBrand?: string | null
) {
  const brand = resolveSelectedBrand(scope, selectedBrand);
  return brand ? { product: { brand } } : getProductBrandScopedWhere(scope);
}

/**
 * Brand value list (`string[] | null`) for callers that build their own
 * `{ brand: { in: [...] } }` clauses (e.g. variant-inventory scoping). `null`
 * means "no brand restriction" (admin/owner viewing all brands).
 */
export function getSelectedBrandScopeValues(
  scope: UserScope,
  selectedBrand?: string | null
): string[] | null {
  const brand = resolveSelectedBrand(scope, selectedBrand);
  return brand ? [brand] : getBrandScopeValues(scope);
}
