import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GREETING_VARIANTS,
  INTRO_VARIANTS,
  matchGreeting,
  pickIntroVariant,
} from '../src/lib/chat/greeting-variants.ts';
import { buildAdArrivalReply } from '../src/lib/chat/ad-referral-product.ts';

test('every introduction says it is an AI, in all five language forms', () => {
  for (const variant of INTRO_VARIANTS) {
    assert.match(variant.en(' Nimal', 'Happybuy'), /AI assistant/);
    assert.match(variant.sinhalaRoman(' Nimal', 'Happybuy'), /AI assistant/);
    assert.match(variant.tamilRoman(' Nimal', 'Happybuy'), /AI assistant/);
    // Native scripts keep "AI" in Latin, which is how it is written here.
    assert.match(variant.sinhala(' Nimal', 'Happybuy'), /AI/);
    assert.match(variant.tamil(' Nimal', 'Happybuy'), /AI/);
  }
});

test('introductions are all different, so the Page is not sending one sentence', () => {
  // A single fixed automated message is what had the Page restricted for two
  // weeks; that is the whole reason these are varied.
  const built = INTRO_VARIANTS.map((variant) => variant.en('', 'Happybuy'));
  assert.equal(new Set(built).size, INTRO_VARIANTS.length);
  assert.ok(INTRO_VARIANTS.length >= 4);
});

test('a customer keeps one voice across their own messages', () => {
  const first = pickIntroVariant('nimal');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(pickIntroVariant('nimal'), first);
  }
  // Different people are spread across the wordings.
  const spread = new Set(
    ['nimal', 'kamal', 'sunil', 'yash', 'dilula', 'sugath'].map((seed) =>
      pickIntroVariant(seed).en('', 'Happybuy')
    )
  );
  assert.ok(spread.size > 1);
});

test('every introduction is recognised for translation', () => {
  // matchGreeting is what lets the localisation layer swap in Sinhala; a
  // variant it cannot match reaches the customer in English.
  for (const variant of INTRO_VARIANTS) {
    const english = variant.en(' Nimal', 'Happybuy');
    const found = matchGreeting(english);
    assert.ok(found, `Introduction not recognised: ${english}`);
    assert.equal(found.namePart, ' Nimal');
    assert.equal(found.storeName, 'Happybuy');
  }
});

test('introductions and plain greetings never match each other', () => {
  for (const variant of GREETING_VARIANTS) {
    const plain = variant.en(' Nimal', 'Happybuy');
    assert.doesNotMatch(plain, /AI assistant/);
    // A plain greeting must still resolve to a plain variant, not an intro.
    assert.ok(INTRO_VARIANTS.every((intro) => !intro.match.test(plain)));
  }
  for (const intro of INTRO_VARIANTS) {
    const introduced = intro.en(' Nimal', 'Happybuy');
    assert.ok(GREETING_VARIANTS.every((plain) => !plain.match.test(introduced)));
  }
});

test('the ad opener introduces the assistant only on first contact', () => {
  const shared = {
    customerName: 'dilula',
    brandName: 'Happybuy',
    productName: 'Pleated Wrap Skort — Brown Check',
    itemCode: 'HAP-0004',
    price: 'Rs 1690',
    sizes: 'S, M, L, XL',
  };

  const introduced = buildAdArrivalReply({ ...shared, introduce: true });
  assert.match(introduced, /you are chatting with Happybuy's AI assistant/);
  assert.match(introduced, /Pleated Wrap Skort — Brown Check — Rs 1690/);

  const returning = buildAdArrivalReply({ ...shared, introduce: false });
  assert.doesNotMatch(returning, /AI assistant/);
  assert.match(returning, /Hi dilula, welcome to Happybuy\./);
});

test('the ad reply asks for one thing and answers the payment worry', () => {
  const reply = buildAdArrivalReply({
    customerName: 'dilula',
    brandName: 'Happybuy',
    productName: 'Pleated Wrap Skort — Brown Check',
    itemCode: 'HAP-0004',
    price: 'Rs 1690',
    sizes: 'S, M, L, XL',
  });

  // The old close, "Happy to send photos or take your order", left the next
  // move to the customer and the customer usually stopped replying.
  assert.match(reply, /Reply with your size and I will reserve it for you\./);
  assert.match(reply, /Cash on delivery is available\./);
  assert.doesNotMatch(reply, /Happy to send photos/);
});

test('a product with no sizes recorded still gets a way to go on', () => {
  const reply = buildAdArrivalReply({
    customerName: null,
    brandName: 'Happybuy',
    productName: 'Gift Card',
    price: 'Rs 1000',
    sizes: '',
  });
  assert.match(reply, /Reply here and I will set the order up for you\./);
  assert.doesNotMatch(reply, /Sizes:/);
});

test('an unnamed customer is still told it is an AI', () => {
  const reply = buildAdArrivalReply({
    customerName: null,
    brandName: 'Happybuy',
    productName: 'Pleated Wrap Skort',
    price: 'Rs 1690',
    sizes: 'S, M',
    introduce: true,
  });
  assert.match(reply, /^You are chatting with Happybuy's AI assistant\./);
  assert.doesNotMatch(reply, /null|undefined/);
});
