import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GREETING_VARIANTS,
  matchGreeting,
  pickGreetingVariant,
} from '../src/lib/chat/greeting-variants.ts';

// Why this exists: one byte-identical greeting to every customer is the
// automated-messaging pattern that got the Happybuy Page restricted.
test('different customers get different greetings', () => {
  const names = ['Dileepa', 'Kasun', 'Tharushi', 'Harsha', 'Ramya', 'Nimal'];
  const greetings = new Set(
    names.map((name) => pickGreetingVariant(name).en(` ${name}`, 'Happybuy'))
  );

  assert.ok(greetings.size > 1, 'expected more than one distinct greeting across customers');
});

test('the same customer always gets the same greeting', () => {
  const first = pickGreetingVariant('Dileepa').en(' Dileepa', 'Happybuy');
  const again = pickGreetingVariant('Dileepa').en(' Dileepa', 'Happybuy');

  assert.equal(first, again);
});

// A variant whose English is not recognised would leave Sinhala and Tamil
// customers reading English, which is worse than the repetition it fixes.
test('every variant round-trips through its own matcher', () => {
  for (const variant of GREETING_VARIANTS) {
    const withName = variant.en(' Dileepa', 'Happybuy');
    const matched = matchGreeting(withName);

    assert.ok(matched, `no matcher recognised: ${withName}`);
    assert.equal(matched.namePart, ' Dileepa');
    assert.equal(matched.storeName, 'Happybuy');
  }
});

test('every variant round-trips without a name', () => {
  for (const variant of GREETING_VARIANTS) {
    const anonymous = variant.en('', 'Happybuy');
    const matched = matchGreeting(anonymous);

    assert.ok(matched, `no matcher recognised: ${anonymous}`);
    assert.equal(matched.namePart, '');
    assert.equal(matched.storeName, 'Happybuy');
  }
});

test('every variant carries all four localised forms', () => {
  for (const variant of GREETING_VARIANTS) {
    for (const form of ['sinhala', 'sinhalaRoman', 'tamil', 'tamilRoman'] as const) {
      const text = variant[form](' Dileepa', 'Happybuy');

      assert.ok(text.trim().length > 0, `${form} was empty`);
      assert.match(text, /Dileepa/, `${form} dropped the customer name`);
      assert.match(text, /Happybuy/, `${form} dropped the store name`);
    }
  }
});

test('the native scripts are actually Sinhala and Tamil', () => {
  for (const variant of GREETING_VARIANTS) {
    assert.match(variant.sinhala('', 'Happybuy'), /[඀-෿]/, 'expected Sinhala script');
    assert.match(variant.tamil('', 'Happybuy'), /[஀-௿]/, 'expected Tamil script');
  }
});

test('a non-greeting reply is not mistaken for one', () => {
  assert.equal(matchGreeting('Your order has been confirmed successfully.'), null);
  assert.equal(matchGreeting('Summer Vacation T-shirt is Rs 1490.'), null);
});

test('the original greeting still resolves, so existing conversations stay consistent', () => {
  const matched = matchGreeting('Hello Dileepa. How can I help you with Happybuy today?');

  assert.ok(matched);
  assert.match(matched.variant.sinhala(matched.namePart, matched.storeName), /ආයුබෝවන්/);
});
