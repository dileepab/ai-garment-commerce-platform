/**
 * Regression tests for the product create/edit workflow.
 *
 * Tests cover the pure business-logic helpers extracted from the server actions:
 * - Variant status resolution
 * - Sizes/colors derivation from variant list
 * - Variant uniqueness validation
 * - Stock total computation
 *
 * Run with:
 *   node --test --experimental-strip-types --no-warnings scripts/products.test.ts
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

// ── helpers mirrored from actions.ts (tested in isolation) ──────────────────

interface VariantInput {
  id?: number;
  size: string;
  color: string;
  availableQty: number;
  sku?: string;
  priceOverride?: number | null;
  status?: string;
}

function resolveVariantStatus(v: VariantInput): string {
  if (v.status && v.status !== '') return v.status;
  return (v.availableQty || 0) > 0 ? 'active' : 'out-of-stock';
}

function deriveProductSizesColors(variants: VariantInput[]): { sizes: string; colors: string } {
  const sizes = [...new Set(variants.map((v) => v.size.trim()).filter(Boolean))].join(',');
  const colors = [...new Set(variants.map((v) => v.color.trim()).filter(Boolean))].join(',');
  return { sizes, colors };
}

function validateVariants(variants: VariantInput[]): string | null {
  if (variants.length === 0) return 'At least one variant is required.';
  const combos = new Set<string>();
  for (const v of variants) {
    if (!v.size.trim() || !v.color.trim()) return 'All variants must have a size and color.';
    const key = `${v.size.trim().toLowerCase()}:${v.color.trim().toLowerCase()}`;
    if (combos.has(key)) return `Duplicate variant: ${v.size} / ${v.color}.`;
    combos.add(key);
  }
  return null;
}

function totalStockFromVariants(variants: VariantInput[]): number {
  return variants.reduce((sum, v) => sum + (v.availableQty || 0), 0);
}

// ── variant status resolution ────────────────────────────────────────────────

describe('resolveVariantStatus', () => {
  test('returns active when qty > 0 and no explicit status', () => {
    assert.equal(resolveVariantStatus({ size: 'S', color: 'Black', availableQty: 5 }), 'active');
  });

  test('returns out-of-stock when qty is 0 and no explicit status', () => {
    assert.equal(resolveVariantStatus({ size: 'M', color: 'White', availableQty: 0 }), 'out-of-stock');
  });

  test('honours explicit status over qty', () => {
    assert.equal(
      resolveVariantStatus({ size: 'L', color: 'Red', availableQty: 10, status: 'out-of-stock' }),
      'out-of-stock',
    );
    assert.equal(
      resolveVariantStatus({ size: 'L', color: 'Red', availableQty: 0, status: 'active' }),
      'active',
    );
  });

  test('treats empty string status as unset', () => {
    assert.equal(resolveVariantStatus({ size: 'S', color: 'Blue', availableQty: 3, status: '' }), 'active');
  });
});

// ── sizes/colors derivation ──────────────────────────────────────────────────

describe('deriveProductSizesColors', () => {
  test('deduplicates sizes and colors preserving order', () => {
    const variants: VariantInput[] = [
      { size: 'S', color: 'Black', availableQty: 2 },
      { size: 'S', color: 'White', availableQty: 2 },
      { size: 'M', color: 'Black', availableQty: 3 },
      { size: 'M', color: 'White', availableQty: 3 },
      { size: 'L', color: 'Black', availableQty: 1 },
    ];
    const { sizes, colors } = deriveProductSizesColors(variants);
    assert.equal(sizes, 'S,M,L');
    assert.equal(colors, 'Black,White');
  });

  test('strips surrounding whitespace from size and color', () => {
    const variants: VariantInput[] = [
      { size: ' S ', color: ' Black ', availableQty: 1 },
      { size: ' M ', color: ' Black ', availableQty: 1 },
    ];
    const { sizes, colors } = deriveProductSizesColors(variants);
    assert.equal(sizes, 'S,M');
    assert.equal(colors, 'Black');
  });

  test('returns empty strings for empty variant list', () => {
    const { sizes, colors } = deriveProductSizesColors([]);
    assert.equal(sizes, '');
    assert.equal(colors, '');
  });
});

// ── variant validation ───────────────────────────────────────────────────────

describe('validateVariants', () => {
  test('returns error for empty list', () => {
    assert.equal(validateVariants([]), 'At least one variant is required.');
  });

  test('returns error when size is missing', () => {
    const result = validateVariants([{ size: '', color: 'Black', availableQty: 1 }]);
    assert.match(result ?? '', /size and color/i);
  });

  test('returns error when color is missing', () => {
    const result = validateVariants([{ size: 'S', color: '', availableQty: 1 }]);
    assert.match(result ?? '', /size and color/i);
  });

  test('returns error for duplicate size+color combo', () => {
    const variants: VariantInput[] = [
      { size: 'S', color: 'Black', availableQty: 2 },
      { size: 'S', color: 'Black', availableQty: 1 },
    ];
    const result = validateVariants(variants);
    assert.match(result ?? '', /duplicate/i);
  });

  test('duplicate detection is case-insensitive', () => {
    const variants: VariantInput[] = [
      { size: 's', color: 'black', availableQty: 2 },
      { size: 'S', color: 'Black', availableQty: 1 },
    ];
    const result = validateVariants(variants);
    assert.match(result ?? '', /duplicate/i);
  });

  test('returns null for a valid list', () => {
    const variants: VariantInput[] = [
      { size: 'S', color: 'Black', availableQty: 2 },
      { size: 'S', color: 'White', availableQty: 1 },
      { size: 'M', color: 'Black', availableQty: 3 },
    ];
    assert.equal(validateVariants(variants), null);
  });
});

// ── total stock ──────────────────────────────────────────────────────────────

describe('totalStockFromVariants', () => {
  test('sums all variant availableQty values', () => {
    const variants: VariantInput[] = [
      { size: 'S', color: 'Black', availableQty: 2 },
      { size: 'M', color: 'Black', availableQty: 3 },
      { size: 'L', color: 'Black', availableQty: 5 },
    ];
    assert.equal(totalStockFromVariants(variants), 10);
  });

  test('treats missing/zero qty as 0', () => {
    const variants: VariantInput[] = [
      { size: 'S', color: 'Black', availableQty: 0 },
      { size: 'M', color: 'Black', availableQty: 5 },
    ];
    assert.equal(totalStockFromVariants(variants), 5);
  });

  test('returns 0 for empty list', () => {
    assert.equal(totalStockFromVariants([]), 0);
  });
});

// ── product creation input shape ─────────────────────────────────────────────

describe('product creation input validation', () => {
  test('new product with three size×colour combos produces correct derived fields', () => {
    const variants: VariantInput[] = [
      { size: 'S', color: 'Black', availableQty: 2 },
      { size: 'S', color: 'White', availableQty: 2 },
      { size: 'M', color: 'Black', availableQty: 3 },
      { size: 'M', color: 'White', availableQty: 2 },
      { size: 'L', color: 'Black', availableQty: 2 },
      { size: 'L', color: 'White', availableQty: 1 },
    ];
    const { sizes, colors } = deriveProductSizesColors(variants);
    const totalStock = totalStockFromVariants(variants);

    assert.equal(sizes, 'S,M,L');
    assert.equal(colors, 'Black,White');
    assert.equal(totalStock, 12);
    assert.equal(validateVariants(variants), null);
  });

  test('edit that removes a variant keeps remaining ones valid', () => {
    // Simulate user removing the L/White combo from a 6-combo product
    const submitted: VariantInput[] = [
      { id: 1, size: 'S', color: 'Black', availableQty: 2 },
      { id: 2, size: 'S', color: 'White', availableQty: 2 },
      { id: 3, size: 'M', color: 'Black', availableQty: 3 },
    ];
    assert.equal(validateVariants(submitted), null);
    const { sizes, colors } = deriveProductSizesColors(submitted);
    assert.equal(sizes, 'S,M');
    assert.equal(colors, 'Black,White');
    assert.equal(totalStockFromVariants(submitted), 7);
  });

  test('adding a new variant alongside existing ones passes validation', () => {
    const submitted: VariantInput[] = [
      { id: 1, size: 'S', color: 'Black', availableQty: 2 },
      // New variant (no id)
      { size: 'XL', color: 'Black', availableQty: 4 },
    ];
    assert.equal(validateVariants(submitted), null);
    const { sizes } = deriveProductSizesColors(submitted);
    assert.equal(sizes, 'S,XL');
  });
});
