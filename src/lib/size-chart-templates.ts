/**
 * What a size chart is made of, and what a new product starts from.
 *
 * Charts used to be six PNGs per brand, so every dress a brand sold showed the
 * same picture — including the sizes it was not made in, and including a length
 * that belonged to whichever dress the artwork was drawn for. A maxi and a midi
 * are not the same garment at size M, and that is the number customers ask
 * about before they buy.
 *
 * So a chart is now data, in two blocks:
 *
 *   body    — what the wearer measures on themselves to pick a size. Set by the
 *             brand's grading, the same across its catalogue, rarely touched.
 *   garment — what this specific piece measures laid flat. Different for every
 *             product, which is the whole reason this file exists.
 *
 * A template holds both for one brand and garment type. Creating a product
 * copies the template into the product as a starting point and then leaves it
 * alone: editing a template later never rewrites a chart someone has already
 * checked against a real garment.
 *
 * Kept free of path aliases and of Prisma so it can be tested directly.
 */

import { sortSizes, sizeRank } from './size-order.ts';
import type { SizeChartCategory } from './size-charts.ts';

export type MeasurementGroup = 'body' | 'garment';

export const GARMENT_TYPES: SizeChartCategory[] = [
  'tops',
  'tshirts',
  'dresses',
  'pants',
  'skirts',
  'skorts',
];

export interface SizeChartColumn {
  /** Stable identity. Renaming a label must not orphan the values under it. */
  key: string;
  label: string;
  group: MeasurementGroup;
  /**
   * A measure is a number the customer compares against a tape. Text carries
   * things like "UK 10", which belong in the table but are not measurements
   * and must not be unit-converted.
   */
  kind: 'measure' | 'text';
}

export interface SizeChartRow {
  /** As the product labels it — "2XL" and "XXL" are the same row, not two. */
  size: string;
  /** Column key → value. Stored as text so a blank cell stays blank. */
  values: Record<string, string>;
}

export interface SizeChartData {
  garmentType: SizeChartCategory;
  unit: SizeChartUnit;
  columns: SizeChartColumn[];
  rows: SizeChartRow[];
  footerNote: string | null;
}

export type SizeChartUnit = 'in' | 'cm';

export const SIZE_CHART_UNITS: SizeChartUnit[] = ['in', 'cm'];

/** The sizes a template is graded for. A product uses whichever it is made in. */
const TEMPLATE_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

const UK_REFERENCE = ['UK 6', 'UK 8', 'UK 10', 'UK 12', 'UK 14', 'UK 16'];

const DEFAULT_FOOTER_NOTE =
  'Measure over light undergarments with the tape snug but not tight. Garment measurements are taken with the piece laid flat, so allow about half an inch either way from hand finishing.';

// ── Column vocabulary ────────────────────────────────────────────────────────

const BODY_UPPER: SizeChartColumn[] = [
  { key: 'bodyBust', label: 'Bust', group: 'body', kind: 'measure' },
  { key: 'bodyWaist', label: 'Waist', group: 'body', kind: 'measure' },
  { key: 'ukSize', label: 'UK size', group: 'body', kind: 'text' },
];

const BODY_FULL: SizeChartColumn[] = [
  { key: 'bodyBust', label: 'Bust', group: 'body', kind: 'measure' },
  { key: 'bodyWaist', label: 'Waist', group: 'body', kind: 'measure' },
  { key: 'bodyHip', label: 'Hip', group: 'body', kind: 'measure' },
  { key: 'ukSize', label: 'UK size', group: 'body', kind: 'text' },
];

const BODY_LOWER: SizeChartColumn[] = [
  { key: 'bodyWaist', label: 'Waist', group: 'body', kind: 'measure' },
  { key: 'bodyHip', label: 'Hip', group: 'body', kind: 'measure' },
  { key: 'ukSize', label: 'UK size', group: 'body', kind: 'text' },
];

function garmentColumn(key: string, label: string): SizeChartColumn {
  return { key, label, group: 'garment', kind: 'measure' };
}

// ── Graded defaults, in inches ───────────────────────────────────────────────
// XS → 2XL. These are the numbers the printed charts already carried, so a
// brand that never opens the template screen keeps exactly what it had.

const BODY_BUST = ['32', '34', '36', '38', '40', '42'];
const BODY_WAIST = ['25', '27', '29', '31', '33', '35'];
const BODY_HIP = ['35', '37', '39', '41', '43', '45'];

interface TemplateBlueprint {
  label: string;
  bodyColumns: SizeChartColumn[];
  garmentColumns: SizeChartColumn[];
  /** Column key → one value per size in TEMPLATE_SIZES order. */
  values: Record<string, string[]>;
}

const BLUEPRINTS: Record<SizeChartCategory, TemplateBlueprint> = {
  tops: {
    label: 'Oversized Tops',
    bodyColumns: BODY_UPPER,
    garmentColumns: [
      garmentColumn('garmentChest', 'Chest'),
      garmentColumn('garmentLength', 'Back length'),
      garmentColumn('garmentShoulder', 'Shoulder'),
      garmentColumn('garmentSleeve', 'Sleeve length'),
    ],
    values: {
      bodyBust: BODY_BUST,
      bodyWaist: BODY_WAIST,
      ukSize: UK_REFERENCE,
      // An oversized cut carries about six inches of ease over the body bust.
      garmentChest: ['38', '40', '42', '44', '46', '48'],
      garmentLength: ['26.5', '27', '27.5', '28', '28.5', '29'],
      garmentShoulder: ['16.5', '17', '17.5', '18', '18.5', '19'],
      garmentSleeve: ['7.5', '7.5', '8', '8', '8.5', '8.5'],
    },
  },
  tshirts: {
    label: 'T-Shirts',
    bodyColumns: BODY_UPPER,
    garmentColumns: [
      garmentColumn('garmentChest', 'Chest'),
      garmentColumn('garmentLength', 'Body length'),
      garmentColumn('garmentShoulder', 'Shoulder'),
      garmentColumn('garmentSleeve', 'Sleeve length'),
    ],
    values: {
      bodyBust: BODY_BUST,
      bodyWaist: BODY_WAIST,
      ukSize: UK_REFERENCE,
      garmentChest: ['36', '38', '40', '42', '44', '46'],
      garmentLength: ['24', '24.5', '25', '25.5', '26', '26.5'],
      garmentShoulder: ['14.5', '15', '15.5', '16', '16.5', '17'],
      garmentSleeve: ['7', '7.25', '7.5', '7.75', '8', '8.25'],
    },
  },
  dresses: {
    label: 'Dresses',
    bodyColumns: BODY_FULL,
    garmentColumns: [
      garmentColumn('garmentChest', 'Chest'),
      garmentColumn('garmentWaist', 'Waist'),
      garmentColumn('garmentHip', 'Hip'),
      garmentColumn('garmentLength', 'Total length'),
    ],
    values: {
      bodyBust: BODY_BUST,
      bodyWaist: BODY_WAIST,
      bodyHip: BODY_HIP,
      ukSize: UK_REFERENCE,
      garmentChest: ['34', '36', '38', '40', '42', '44'],
      garmentWaist: ['27', '29', '31', '33', '35', '37'],
      garmentHip: ['37', '39', '41', '43', '45', '47'],
      // A midi length. The number most worth correcting per product — a maxi
      // and a mini share every other row on this chart.
      garmentLength: ['45', '45.5', '46', '46.5', '47', '47.5'],
    },
  },
  pants: {
    label: 'Pants',
    bodyColumns: BODY_LOWER,
    garmentColumns: [
      garmentColumn('garmentWaist', 'Waist'),
      garmentColumn('garmentHip', 'Hip'),
      garmentColumn('garmentInseam', 'Inseam'),
      garmentColumn('garmentLegOpening', 'Leg opening'),
    ],
    values: {
      bodyWaist: BODY_WAIST,
      bodyHip: BODY_HIP,
      ukSize: UK_REFERENCE,
      garmentWaist: ['26', '28', '30', '32', '34', '36'],
      garmentHip: ['36', '38', '40', '42', '44', '46'],
      garmentInseam: ['28.5', '29', '29', '29.5', '29.5', '30'],
      garmentLegOpening: ['16', '16.5', '17', '17.5', '18', '18.5'],
    },
  },
  skirts: {
    label: 'Skirts',
    bodyColumns: BODY_LOWER,
    garmentColumns: [
      garmentColumn('garmentWaist', 'Waist'),
      garmentColumn('garmentHip', 'Hip'),
      garmentColumn('garmentLength', 'Length'),
      garmentColumn('garmentSweep', 'Hem sweep'),
    ],
    values: {
      bodyWaist: BODY_WAIST,
      bodyHip: BODY_HIP,
      ukSize: UK_REFERENCE,
      garmentWaist: ['26', '28', '30', '32', '34', '36'],
      garmentHip: ['36', '38', '40', '42', '44', '46'],
      garmentLength: ['27', '27.5', '28', '28.5', '29', '29.5'],
      garmentSweep: ['44', '45', '46', '47', '48', '49'],
    },
  },
  // A skort is a skirt with shorts built in, so it carries an inseam the skirt
  // chart has no row for — the reason it cannot simply borrow that template.
  skorts: {
    label: 'Skorts',
    bodyColumns: BODY_LOWER,
    garmentColumns: [
      garmentColumn('garmentWaist', 'Waist'),
      garmentColumn('garmentHip', 'Hip'),
      garmentColumn('garmentLength', 'Skirt length'),
      garmentColumn('garmentInseam', 'Inner short inseam'),
    ],
    values: {
      bodyWaist: BODY_WAIST,
      bodyHip: BODY_HIP,
      ukSize: UK_REFERENCE,
      garmentWaist: ['26', '28', '30', '32', '34', '36'],
      garmentHip: ['36', '38', '40', '42', '44', '46'],
      garmentLength: ['15', '15.5', '16', '16.5', '17', '17.5'],
      garmentInseam: ['3', '3', '3.5', '3.5', '4', '4'],
    },
  },
};

// ── Size matching ────────────────────────────────────────────────────────────

/**
 * Two labels for one size. The product form offers "2XL" while every printed
 * chart says "XXL", and a chart that silently blanks the largest row because of
 * spelling is worse than no chart.
 */
export function sizesMatch(left: string, right: string): boolean {
  const leftKey = left.trim().toUpperCase().replace(/\s+/g, '');
  const rightKey = right.trim().toUpperCase().replace(/\s+/g, '');
  if (leftKey === rightKey) return true;

  const leftRank = sizeRank(left);
  const rightRank = sizeRank(right);
  return leftRank >= 0 && leftRank === rightRank;
}

function findRow(rows: SizeChartRow[], size: string): SizeChartRow | undefined {
  return rows.find((row) => sizesMatch(row.size, size));
}

// ── Building charts ──────────────────────────────────────────────────────────

export function templateLabel(garmentType: SizeChartCategory): string {
  return BLUEPRINTS[garmentType].label;
}

export function defaultChartColumns(garmentType: SizeChartCategory): SizeChartColumn[] {
  const blueprint = BLUEPRINTS[garmentType];
  return [...blueprint.bodyColumns, ...blueprint.garmentColumns];
}

/**
 * The chart a brand starts with before anyone has edited anything: the numbers
 * the printed charts carried, graded XS to 2XL.
 */
export function defaultTemplateChart(garmentType: SizeChartCategory): SizeChartData {
  const blueprint = BLUEPRINTS[garmentType];
  const columns = defaultChartColumns(garmentType);

  return {
    garmentType,
    unit: 'in',
    columns,
    rows: TEMPLATE_SIZES.map((size, index) => ({
      size,
      values: Object.fromEntries(
        columns.map((column) => [column.key, blueprint.values[column.key]?.[index] ?? '']),
      ),
    })),
    footerNote: DEFAULT_FOOTER_NOTE,
  };
}

/**
 * A product's chart, seeded from its brand's template but holding only the
 * sizes the product is actually made in. A size the template was never graded
 * for comes through blank rather than guessed — an invented measurement is a
 * returned parcel.
 */
export function buildChartForSizes(
  template: SizeChartData,
  productSizes: string[],
): SizeChartData {
  const sizes = sortSizes(dedupeSizes(productSizes));

  return {
    ...template,
    rows: sizes.map((size) => {
      const source = findRow(template.rows, size);
      return {
        size,
        values: Object.fromEntries(
          template.columns.map((column) => [column.key, source?.values[column.key] ?? '']),
        ),
      };
    }),
  };
}

/**
 * The product's sizes changed while the form was open — a colour was added in
 * L, or XS was dropped. Rows already measured by hand survive; a newly added
 * size arrives seeded from the template; a dropped size goes.
 */
export function syncChartWithSizes(
  chart: SizeChartData,
  productSizes: string[],
  template: SizeChartData,
): SizeChartData {
  const sizes = sortSizes(dedupeSizes(productSizes));

  return {
    ...chart,
    rows: sizes.map((size) => {
      const existing = findRow(chart.rows, size);
      if (existing) return { size, values: { ...existing.values } };

      const seed = findRow(template.rows, size);
      return {
        size,
        values: Object.fromEntries(
          chart.columns.map((column) => [column.key, seed?.values[column.key] ?? '']),
        ),
      };
    }),
  };
}

function dedupeSizes(sizes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const size of sizes) {
    const trimmed = size.trim();
    if (!trimmed) continue;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** A chart with no measured value in it is not worth showing or storing. */
export function chartHasValues(chart: SizeChartData): boolean {
  return chart.rows.some((row) =>
    chart.columns.some((column) => (row.values[column.key] ?? '').trim() !== ''),
  );
}

export function columnsInGroup(chart: SizeChartData, group: MeasurementGroup): SizeChartColumn[] {
  return chart.columns.filter((column) => column.group === group);
}

/** A group with every cell blank is dropped from the rendered chart entirely. */
export function groupHasValues(chart: SizeChartData, group: MeasurementGroup): boolean {
  const columns = columnsInGroup(chart, group);
  return chart.rows.some((row) =>
    columns.some((column) => (row.values[column.key] ?? '').trim() !== ''),
  );
}

export function unitLabel(unit: SizeChartUnit): string {
  return unit === 'cm' ? 'cm' : 'in';
}

// ── Serialising ──────────────────────────────────────────────────────────────

export function serializeColumns(columns: SizeChartColumn[]): string {
  return JSON.stringify(columns);
}

export function serializeRows(rows: SizeChartRow[]): string {
  return JSON.stringify(rows);
}

function isGarmentType(value: unknown): value is SizeChartCategory {
  return typeof value === 'string' && GARMENT_TYPES.includes(value as SizeChartCategory);
}

function parseColumns(raw: string): SizeChartColumn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const columns: SizeChartColumn[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    columns.push({
      key,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : key,
      group: candidate.group === 'garment' ? 'garment' : 'body',
      kind: candidate.kind === 'text' ? 'text' : 'measure',
    });
  }
  return columns;
}

function parseRows(raw: string, columns: SizeChartColumn[]): SizeChartRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rows: SizeChartRow[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const size = typeof candidate.size === 'string' ? candidate.size.trim() : '';
    if (!size) continue;
    const rawValues = (candidate.values ?? {}) as Record<string, unknown>;
    rows.push({
      size,
      values: Object.fromEntries(
        columns.map((column) => {
          const value = rawValues[column.key];
          return [column.key, typeof value === 'string' ? value.trim() : value == null ? '' : String(value)];
        }),
      ),
    });
  }
  return rows;
}

export interface StoredChartRecord {
  garmentType: string;
  unit: string;
  columnsJson: string;
  rowsJson: string;
  footerNote: string | null;
}

/**
 * A stored chart back into memory. Anything unrecognised falls back to the
 * type's defaults rather than throwing — a malformed row must not take the
 * product page down with it.
 */
export function parseStoredChart(record: StoredChartRecord): SizeChartData | null {
  if (!isGarmentType(record.garmentType)) return null;

  const columns = parseColumns(record.columnsJson);
  if (columns.length === 0) return null;

  return {
    garmentType: record.garmentType,
    unit: record.unit === 'cm' ? 'cm' : 'in',
    columns,
    rows: parseRows(record.rowsJson, columns),
    footerNote: record.footerNote?.trim() || null,
  };
}

/**
 * A chart arriving from the browser. Columns are taken from the type's own
 * vocabulary rather than from the payload, so a form post cannot invent a
 * column or rename one out from under stored values; only the cells are read.
 */
export function normalizeChartInput(input: unknown): SizeChartData | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;
  if (!isGarmentType(candidate.garmentType)) return null;

  const columns = defaultChartColumns(candidate.garmentType);
  const rawRows = Array.isArray(candidate.rows) ? candidate.rows : [];

  const rows: SizeChartRow[] = [];
  const seen = new Set<string>();
  for (const entry of rawRows) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const size = typeof row.size === 'string' ? row.size.trim() : '';
    if (!size || seen.has(size.toUpperCase())) continue;
    seen.add(size.toUpperCase());
    const values = (row.values ?? {}) as Record<string, unknown>;
    rows.push({
      size,
      values: Object.fromEntries(
        columns.map((column) => {
          const value = values[column.key];
          return [column.key, typeof value === 'string' ? value.trim().slice(0, 24) : ''];
        }),
      ),
    });
  }

  const footerNote = typeof candidate.footerNote === 'string' ? candidate.footerNote.trim() : '';

  return {
    garmentType: candidate.garmentType,
    unit: candidate.unit === 'cm' ? 'cm' : 'in',
    columns,
    rows,
    footerNote: footerNote ? footerNote.slice(0, 400) : null,
  };
}
