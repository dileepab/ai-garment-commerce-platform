import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  constructionFidelityLine,
  detectGarmentTraits,
  openingGuardLine,
  patternFidelityLine,
  silhouetteFidelityLine,
} from '../src/lib/garment-traits.ts';

const SKORT =
  'Pleated Wrap Skort — Brown Check. Style: skort. Yarn-dyed check woven into the fabric. ' +
  'Skort: wrap-style skirt panel over built-in shorts.';
const SUNDRESS =
  'Tie-Strap Smocked Sundress — Red Floral. Style: summer dress. Small white floral print on red.';

test('a wrap skort is read as a wrap with no sleeves and a check', () => {
  const t = detectGarmentTraits(SKORT);
  assert.equal(t.isWrap, true);
  assert.equal(t.hasSleeves, false);
  assert.equal(t.patternKind, 'check');
});

test('a tie-strap floral sundress is read as sleeveless and floral', () => {
  const t = detectGarmentTraits(SUNDRESS);
  assert.equal(t.hasSleeves, false);
  assert.equal(t.patternKind, 'floral');
});

test('a shirt keeps its sleeves', () => {
  assert.equal(detectGarmentTraits('Office Shirt — Blue, long sleeve').hasSleeves, true);
});

test('wide-leg linen pants are classified as trousers and bottoms', () => {
  const t = detectGarmentTraits('Linen Wide-Leg Pants — Olive Green');
  assert.equal(t.isBottom, true);
  assert.equal(t.isTrousers, true);
  assert.equal(t.hasSleeves, false);
});

/**
 * The whole reason this module exists: the dashed grid came back as solid
 * lines and nothing in the checklist objected.
 */
test('a check is told to preserve the line style, not just the colour', () => {
  const line = patternFidelityLine(detectGarmentTraits(SKORT));
  assert.match(line, /LINE STYLE/);
  assert.match(line, /broken dashes/);
  assert.match(line, /glen plaid/);
});

test('a stripe still gets stripe language, not check language', () => {
  const line = patternFidelityLine(detectGarmentTraits('Striped Tee — red and white bands'));
  assert.match(line, /stripe sequence/);
  assert.doesNotMatch(line, /squares/);
});

test('a plain garment is told to add no pattern', () => {
  const line = patternFidelityLine(detectGarmentTraits('Plain solid cotton top'));
  assert.match(line, /Add no check, stripe, print/);
});

/** Naming cuffs on a skort invites the model to invent them. */
test('a bottom is never asked about necklines, sleeves or cuffs', () => {
  const line = constructionFidelityLine(detectGarmentTraits(SKORT));
  assert.doesNotMatch(line, /neckline|sleeve|cuff|placket/i);
  assert.match(line, /waistband/);
});

test('a sleeved garment still gets the sleeve checklist', () => {
  const line = constructionFidelityLine(detectGarmentTraits('Office Shirt — Blue, long sleeve'));
  assert.match(line, /sleeve length and cuffs/);
  assert.match(line, /neckline/);
});

test('trouser construction forbids inventing a conventional fly and moving belt loops', () => {
  const line = constructionFidelityLine(detectGarmentTraits('Linen Wide-Leg Pants'));
  assert.match(line, /presence or absence of a fly\/zip\/button\/hook\/tab\/placket/);
  assert.match(line, /front-only versus back belt loops/);
  assert.match(line, /continuous, uninterrupted waistband/);
  assert.match(line, /never split it into left and right halves/);
  assert.match(line, /centre-front join/);
  assert.match(line, /crotch seam must stop below/);
  assert.match(line, /not permission to invent a conventional closure/);
});

test('wide-leg trousers may not be normalised into tapered or cropped pants', () => {
  const line = silhouetteFidelityLine(detectGarmentTraits('Linen Wide-Leg Pants'));
  assert.match(line, /remain wide and nearly straight/);
  assert.match(line, /tapered/);
  assert.match(line, /cropped/);
});

/**
 * The old blanket rule — "keep both dress sides closed; do not expose leg/skin
 * through a slit" — is an instruction to destroy a wrap.
 */
test('a wrap is told to keep its opening, not close it', () => {
  const line = openingGuardLine(detectGarmentTraits(SKORT));
  assert.match(line, /WRAPS/);
  assert.match(line, /Do not close it into a plain skirt/);
  assert.doesNotMatch(line, /Do not add a side slit/);
});

test('a non-wrap still gets the no-invented-slit guard', () => {
  const line = openingGuardLine(detectGarmentTraits(SUNDRESS));
  assert.match(line, /Do not add a side slit/);
  assert.doesNotMatch(line, /WRAPS/);
});
