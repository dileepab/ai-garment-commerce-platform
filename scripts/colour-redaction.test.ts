import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactColourNames } from '../src/lib/colour-redaction.ts';

const PLACEHOLDER = 'the colour shown in the reference photograph';

test('the catalogue colour name is removed everywhere it appears', () => {
  // All three places it reached the model on HAP-0008.
  const context =
    'Name: Linen Wide-Leg Pants — Pastel Pink. Fabric: Linen. Colors: Pastel Pink. ' +
    'Selected colour variant: Pastel Pink (catalogue label only).';

  const redacted = redactColourNames(context, ['Pastel Pink']);

  assert.doesNotMatch(redacted, /pastel pink/i);
  assert.match(redacted, /Fabric: Linen/, 'unrelated detail must survive');
});

test('colour words that are not catalogue names are left alone', () => {
  // Construction detail the model needs. A blanket colour filter would eat it.
  const context = 'Red floral print stays on the left-front panel. Colors: Pastel Pink.';
  const redacted = redactColourNames(context, ['Pastel Pink']);

  assert.match(redacted, /Red floral print stays on the left-front panel/);
  assert.doesNotMatch(redacted, /pastel pink/i);
});

test('a longer name is not half-eaten by a shorter one', () => {
  const redacted = redactColourNames(
    'Colors: Cream Red Floral, Red Floral.',
    ['Red Floral', 'Cream Red Floral'],
  );

  assert.doesNotMatch(redacted, /cream red floral/i);
  assert.doesNotMatch(redacted, /red floral/i);
});

test('a list of colours collapses instead of repeating the placeholder', () => {
  const redacted = redactColourNames(
    'Colors: Olive Green, Emerald Green, Mustard Yellow.',
    ['Olive Green', 'Emerald Green', 'Mustard Yellow'],
  );

  assert.equal(redacted, `Colors: ${PLACEHOLDER}.`);
});

test('matching is case-insensitive and respects word boundaries', () => {
  assert.doesNotMatch(redactColourNames('colors: PASTEL PINK.', ['Pastel Pink']), /pastel/i);
  // "Coral" must not be clipped out of an unrelated word.
  assert.match(redactColourNames('Coralline trim detail.', ['Coral']), /Coralline trim detail/);
});

test('no names, or blank names, leaves the text untouched', () => {
  const context = 'Name: Linen Wide-Leg Pants. Colors: Pastel Pink.';
  assert.equal(redactColourNames(context, []), context);
  assert.equal(redactColourNames(context, ['', '  ', 'ab']), context);
});
