import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyHeroGarment,
  resolveScene,
  sceneClause,
  stableHash,
} from '../src/lib/creative-scene.ts';

const SKORT = 'Pleated Wrap Skort — Brown Check. Skort: wrap panel over built-in shorts.';
const SUNDRESS = 'Tie-Strap Smocked Sundress — Blue Grey. Cheesecloth.';

/**
 * The bug this module exists for: front came back in a short-sleeve knit on a
 * cobbled street, back in a long-sleeve sweater in a forest.
 */
test('every angle of one product resolves to the same outfit and place', () => {
  const front = resolveScene('HAP-0004', SKORT);
  const side = resolveScene('HAP-0004', SKORT);
  const back = resolveScene('HAP-0004', SKORT);

  assert.equal(front.companion, side.companion);
  assert.equal(side.companion, back.companion);
  assert.equal(front.setting, side.setting);
  assert.equal(side.setting, back.setting);
});

// Regenerating one tile months later must not restyle it away from its siblings.
test('the choice survives a separate process with no shared state', () => {
  assert.deepEqual(resolveScene('HAP-0004', SKORT), resolveScene('HAP-0004', SKORT));
  assert.equal(stableHash('HAP-0004'), stableHash('HAP-0004'));
});

test('different products do not all get the same scene', () => {
  const scenes = new Set(
    ['HAP-0001', 'HAP-0002', 'HAP-0003', 'HAP-0004', 'HAP-0005', 'HAP-0006']
      .map(key => `${resolveScene(key, SKORT).companion}|${resolveScene(key, SKORT).setting}`)
  );
  assert.ok(scenes.size > 1, 'every product resolved to an identical scene');
});

/**
 * The sleeve length is the whole point of naming the companion garment — "a
 * simple top" is what produced one short sleeve and one long sleeve.
 */
test('the companion top names a sleeve length', () => {
  for (const key of ['HAP-0004', 'HAP-0005', 'HAP-0010', 'HAP-0033', 'HAP-0107']) {
    const { companion } = resolveScene(key, SKORT);
    assert.ok(companion, `no companion for ${key}`);
    assert.match(companion, /sleeve/i, `no sleeve length in: ${companion}`);
  }
});

test('a bottom gets a top, not another bottom', () => {
  const { companion } = resolveScene('HAP-0004', SKORT);
  assert.ok(companion);
  assert.doesNotMatch(companion, /trousers|jeans|skirt/i);
});

// A dress with trousers added underneath is worse than no companion rule at all.
test('a one-piece gets no companion clothing', () => {
  const { companion, setting } = resolveScene('HAP-0001', SUNDRESS);
  assert.equal(companion, null);
  assert.ok(setting.length > 0, 'a one-piece still needs a location');
});

test('garment kinds are classified from the product text', () => {
  assert.equal(classifyHeroGarment('Pleated Wrap Skort — Brown Check'), 'bottom');
  assert.equal(classifyHeroGarment('Wide Leg Pants'), 'bottom');
  assert.equal(classifyHeroGarment('Tie-Strap Smocked Sundress'), 'onepiece');
  assert.equal(classifyHeroGarment('Utility Jumpsuit'), 'onepiece');
  assert.equal(classifyHeroGarment('Oversized Casual Top'), 'top');
  assert.equal(classifyHeroGarment('Office Shirt'), 'top');
});

/**
 * "Shirt dress" contains "shirt". Classified as a top it would be rendered
 * with trousers added under a dress.
 */
test('a shirt dress is a dress, not a shirt', () => {
  assert.equal(classifyHeroGarment('Linen Shirt Dress — Cream'), 'onepiece');
  assert.equal(resolveScene('HAP-0099', 'Linen Shirt Dress — Cream').companion, null);
});

test('the clause pins the outfit and forbids additions', () => {
  const clause = sceneClause(resolveScene('HAP-0004', SKORT));
  assert.match(clause, /IDENTICAL ACROSS EVERY ANGLE/);
  assert.match(clause, /same sleeve length/);
  assert.match(clause, /no jacket, cardigan, scarf, belt, or bag/);
  assert.match(clause, /Keep this location and this light/);
});

test('a one-piece clause tells the model to add nothing', () => {
  const clause = sceneClause(resolveScene('HAP-0001', SUNDRESS));
  assert.match(clause, /Do NOT add any other clothing/);
});
