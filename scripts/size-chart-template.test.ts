import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildChartForSizes,
  chartHasValues,
  columnsInGroup,
  defaultTemplateChart,
  groupHasValues,
  normalizeChartInput,
  parseStoredChart,
  serializeColumns,
  serializeRows,
  sizesMatch,
  syncChartWithSizes,
} from '../src/lib/size-chart-templates.ts';

/**
 * The reason this module exists: one PNG per brand per garment type meant every
 * dress showed the same chart, including the sizes it was not made in and a
 * length belonging to whichever dress the artwork was drawn for.
 */

test('the default dress template carries the numbers the printed chart had', () => {
  const chart = defaultTemplateChart('dresses');
  const medium = chart.rows.find((row) => row.size === 'M');

  assert.ok(medium);
  assert.equal(medium.values.bodyBust, '36');
  assert.equal(medium.values.bodyWaist, '29');
  assert.equal(medium.values.bodyHip, '39');
  assert.equal(medium.values.ukSize, 'UK 10');
});

test('every default template grades XS through 2XL with no blank cells', () => {
  for (const type of ['tops', 'tshirts', 'dresses', 'pants', 'skirts', 'skorts'] as const) {
    const chart = defaultTemplateChart(type);
    assert.deepEqual(
      chart.rows.map((row) => row.size),
      ['XS', 'S', 'M', 'L', 'XL', '2XL'],
      `${type} is not graded end to end`,
    );
    for (const row of chart.rows) {
      for (const column of chart.columns) {
        assert.notEqual(row.values[column.key], '', `${type} ${row.size} ${column.key} is blank`);
      }
    }
  }
});

test('a skort carries an inseam and a skirt does not', () => {
  const skortKeys = defaultTemplateChart('skorts').columns.map((column) => column.key);
  const skirtKeys = defaultTemplateChart('skirts').columns.map((column) => column.key);

  assert.ok(skortKeys.includes('garmentInseam'));
  assert.ok(!skirtKeys.includes('garmentInseam'));
});

test('a product chart holds only the sizes the product is made in, in order', () => {
  const chart = buildChartForSizes(defaultTemplateChart('dresses'), ['L', 'S', 'M']);

  assert.deepEqual(chart.rows.map((row) => row.size), ['S', 'M', 'L']);
});

test('XXL and 2XL are one row, not two', () => {
  assert.ok(sizesMatch('XXL', '2XL'));
  assert.ok(sizesMatch(' xxl ', '2XL'));
  assert.ok(!sizesMatch('XL', '2XL'));

  // The form offers 2XL, every printed chart says XXL. Seeded from the
  // template, the largest size must not come through blank.
  const chart = buildChartForSizes(defaultTemplateChart('tops'), ['XXL']);
  assert.equal(chart.rows[0].values.bodyBust, '42');
});

test('a size the template was never graded for comes through blank, not guessed', () => {
  const chart = buildChartForSizes(defaultTemplateChart('tops'), ['M', 'Free Size']);
  const free = chart.rows.find((row) => row.size === 'Free Size');

  assert.ok(free);
  assert.equal(free.values.garmentChest, '');
});

test('adding a size keeps the rows already measured by hand', () => {
  const template = defaultTemplateChart('dresses');
  const edited = buildChartForSizes(template, ['S', 'M']);
  edited.rows[0].values.garmentLength = '52';

  const synced = syncChartWithSizes(edited, ['S', 'M', 'L'], template);

  assert.deepEqual(synced.rows.map((row) => row.size), ['S', 'M', 'L']);
  assert.equal(synced.rows[0].values.garmentLength, '52', 'the hand-measured value was overwritten');
  assert.equal(synced.rows[2].values.garmentLength, '46.5', 'the new size was not seeded');
});

test('dropping a size drops its row', () => {
  const template = defaultTemplateChart('pants');
  const chart = buildChartForSizes(template, ['S', 'M', 'L']);

  const synced = syncChartWithSizes(chart, ['S', 'L'], template);

  assert.deepEqual(synced.rows.map((row) => row.size), ['S', 'L']);
});

test('a chart survives a round trip through storage', () => {
  const chart = buildChartForSizes(defaultTemplateChart('skirts'), ['M', 'L']);
  chart.rows[0].values.garmentLength = '31.5';

  const restored = parseStoredChart({
    garmentType: chart.garmentType,
    unit: chart.unit,
    columnsJson: serializeColumns(chart.columns),
    rowsJson: serializeRows(chart.rows),
    footerNote: chart.footerNote,
  });

  assert.deepEqual(restored, chart);
});

test('a malformed stored chart is refused rather than half-read', () => {
  assert.equal(
    parseStoredChart({ garmentType: 'hats', unit: 'in', columnsJson: '[]', rowsJson: '[]', footerNote: null }),
    null,
  );
  assert.equal(
    parseStoredChart({ garmentType: 'dresses', unit: 'in', columnsJson: 'not json', rowsJson: '[]', footerNote: null }),
    null,
  );
});

test('a submitted chart cannot invent or rename a column', () => {
  const normalized = normalizeChartInput({
    garmentType: 'dresses',
    unit: 'in',
    columns: [{ key: 'price', label: 'Price', group: 'body', kind: 'text' }],
    rows: [{ size: 'M', values: { garmentLength: '46', price: '0' } }],
    footerNote: 'Measured flat.',
  });

  assert.ok(normalized);
  assert.ok(!normalized.columns.some((column) => column.key === 'price'));
  assert.equal(normalized.rows[0].values.garmentLength, '46');
  assert.equal(normalized.rows[0].values.price, undefined);
});

test('a submitted chart for an unknown garment type is refused', () => {
  assert.equal(normalizeChartInput({ garmentType: 'shoes', rows: [] }), null);
  assert.equal(normalizeChartInput(null), null);
});

test('a duplicated size row is taken once', () => {
  const normalized = normalizeChartInput({
    garmentType: 'tops',
    unit: 'in',
    rows: [
      { size: 'M', values: { garmentChest: '42' } },
      { size: 'M', values: { garmentChest: '99' } },
    ],
  });

  assert.ok(normalized);
  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.rows[0].values.garmentChest, '42');
});

test('an all-blank block is reported as empty so it can be left off the chart', () => {
  const chart = buildChartForSizes(defaultTemplateChart('tops'), ['M']);
  assert.ok(groupHasValues(chart, 'garment'));

  for (const column of columnsInGroup(chart, 'garment')) {
    chart.rows[0].values[column.key] = '';
  }

  assert.ok(!groupHasValues(chart, 'garment'));
  assert.ok(groupHasValues(chart, 'body'));
  assert.ok(chartHasValues(chart));
});
