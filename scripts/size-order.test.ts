import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortSizes, sizeRank } from '../src/lib/size-order.ts';

/**
 * The reason this module exists: three separate sorters disagreed, so the same
 * product could list its sizes one way in a Facebook caption and another way on
 * the storefront.
 */
test('the order is smallest to largest', () => {
  assert.deepEqual(sortSizes(['L', 'M', 'S', 'XL']), ['S', 'M', 'L', 'XL']);
  assert.deepEqual(sortSizes(['2XL', 'XS', 'L']), ['XS', 'L', '2XL']);
});

test('the full lettered range sorts end to end', () => {
  const shuffled = ['6XL', 'XS', '4XS', '3XL', 'M', '2XS', 'XL', '5XL', 'S', '3XS', 'L', '2XL', '4XL'];
  assert.deepEqual(sortSizes(shuffled), [
    '4XS', '3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL',
  ]);
});

// Staff type these interchangeably on the product row.
test('aliases rank as the size they mean', () => {
  assert.equal(sizeRank('XXL'), sizeRank('2XL'));
  assert.equal(sizeRank('XXXL'), sizeRank('3XL'));
  assert.equal(sizeRank('XXS'), sizeRank('2XS'));
  assert.equal(sizeRank('Small'), sizeRank('S'));
  assert.equal(sizeRank('medium'), sizeRank('M'));
  assert.deepEqual(sortSizes(['XXL', 'Small', 'Large']), ['Small', 'Large', 'XXL']);
});

test('spacing and full stops do not change a size', () => {
  assert.equal(sizeRank(' m '), sizeRank('M'));
  assert.equal(sizeRank('X.S.'), sizeRank('XS'));
});

test('combined sizes sit between the two they span', () => {
  assert.deepEqual(sortSizes(['M', 'S/M', 'S']), ['S', 'S/M', 'M']);
});

test('numeric sizes sort as numbers, not as text', () => {
  assert.deepEqual(sortSizes(['10', '2', '12', '8']), ['2', '8', '10', '12']);
});

test('lettered sizes lead, numeric ones follow', () => {
  assert.deepEqual(sortSizes(['10', 'M', '8', 'S']), ['S', 'M', '8', '10']);
});

/**
 * "Free Size" belongs at the end of "S, M, L" and at the end of "8, 10, 12"
 * alike — it is not a point on either scale.
 */
test('free size and its kin sort after everything measurable', () => {
  assert.deepEqual(sortSizes(['Free Size', 'M', 'S']), ['S', 'M', 'Free Size']);
  assert.deepEqual(sortSizes(['One Size', '10', '8']), ['8', '10', 'One Size']);
  assert.deepEqual(
    sortSizes(['Made-to-order', 'Custom', 'Free Size', 'M']),
    ['M', 'Free Size', 'Custom', 'Made-to-order'],
  );
});

/**
 * An unfamiliar value is never dropped and never reordered against its
 * neighbours — only moved to the end, in the order it was entered.
 */
test('unrecognised sizes keep their entry order, at the end', () => {
  assert.deepEqual(
    sortSizes(['Toddler', 'M', 'Petite', 'S']),
    ['S', 'M', 'Toddler', 'Petite'],
  );
  assert.equal(sizeRank('Toddler'), -1);
});

test('sorting does not mutate the array it was given', () => {
  const input = ['L', 'S', 'M'];
  sortSizes(input);
  assert.deepEqual(input, ['L', 'S', 'M']);
});

test('empty input is handled', () => {
  assert.deepEqual(sortSizes([]), []);
  assert.deepEqual(sortSizes(['M']), ['M']);
});
