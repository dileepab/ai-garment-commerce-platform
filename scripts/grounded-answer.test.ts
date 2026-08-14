import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGroundedAnswerPrompt,
  buildProductFactSheet,
  findUngroundedClaims,
  languageInstruction,
} from '../src/lib/chat/grounded-answer.ts';

const BLUE_GREY = {
  name: 'Tie-Strap Smocked Sundress — Blue Grey',
  itemCode: 'HAP-0001',
  price: 1990,
  sizes: ['S', 'M', 'L', 'XL'],
  colors: ['Blue Grey'],
  inStock: true,
  fabric: 'Cheesecloth',
  specLines: ['Garment length: 84 cm', 'Worn length: Above knee', 'Fit: A-line fit'],
};

const FACT_SHEET = buildProductFactSheet(BLUE_GREY);

test('the fact sheet carries only what the record holds', () => {
  assert.match(FACT_SHEET, /Price: Rs 1990/);
  assert.match(FACT_SHEET, /Available sizes: S, M, L, XL/);
  assert.match(FACT_SHEET, /Fabric: Cheesecloth/);
  assert.match(FACT_SHEET, /Garment length: 84 cm/);
  assert.match(FACT_SHEET, /Currently in stock: yes/);
});

test('an out-of-stock product says so rather than staying silent', () => {
  assert.match(buildProductFactSheet({ ...BLUE_GREY, inStock: false }), /Currently in stock: no/);
});

/**
 * The instruction that separates this from the template path: answer the
 * question, and give a judgement when a judgement is what was asked for.
 */
test('the prompt forbids guessing and asks for an answer, not a spec dump', () => {
  const prompt = buildGroundedAnswerPrompt({
    factSheet: FACT_SHEET,
    question: 'Man meka ganne rivastan yanna eheta aulak nethi wei neda',
    language: 'sinhala',
    scriptStyle: 'roman',
  });

  assert.match(prompt, /ONLY the facts/);
  assert.match(prompt, /Never invent or estimate a price/);
  assert.match(prompt, /Do not list details nobody asked for/i);
  assert.match(prompt, /judgement/i);
  assert.match(prompt, /Roman Sinhala/);
  assert.match(prompt, /Garment length: 84 cm/);
});

test('earlier turns are included so "this dress" resolves', () => {
  const prompt = buildGroundedAnswerPrompt({
    factSheet: FACT_SHEET,
    question: 'මේ ගවුම මැටීරියල් මොනවාද',
    language: 'sinhala',
    scriptStyle: 'native',
    recentTurns: [
      { role: 'user', message: 'What is this item?' },
      { role: 'assistant', message: 'Tie-Strap Smocked Sundress — Blue Grey, Rs 1990.' },
    ],
  });

  assert.match(prompt, /EARLIER IN THIS CHAT/);
  assert.match(prompt, /Customer: What is this item\?/);
  assert.match(prompt, /Sinhala script/);
});

test('each language and script combination has its own instruction', () => {
  assert.match(languageInstruction('sinhala', 'roman'), /Latin letters/);
  assert.match(languageInstruction('sinhala', 'native'), /Sinhala script/);
  assert.match(languageInstruction('tamil', 'roman'), /Latin letters/);
  assert.match(languageInstruction('english', 'native'), /English/);
  // An unknown script style must not fall through to nothing.
  assert.match(languageInstruction('sinhala', 'nonsense'), /Sinhala/);
});

// ---------------------------------------------------------------------------
// The guardrail. Everything below is what stops a fluent answer being a costly
// one — these are the claims that turn into orders we cannot fill.
// ---------------------------------------------------------------------------

test('a grounded answer passes clean', () => {
  const reply = 'Cheesecloth thamai. Rs 1990, godak diga naha — danissata udin.';

  assert.deepEqual(
    findUngroundedClaims({ reply, factSheet: FACT_SHEET, sizes: BLUE_GREY.sizes }),
    []
  );
});

test('an invented price is caught', () => {
  const problems = findUngroundedClaims({
    reply: 'This one is Rs 1,790 only.',
    factSheet: FACT_SHEET,
    sizes: BLUE_GREY.sizes,
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /price not in our records/);
});

// "Rs 1,990" and "Rs1990" are the same claim written two ways.
test('formatting differences are not treated as invented prices', () => {
  for (const reply of ['Rs 1,990.', 'Rs1990', 'Rs. 1,990']) {
    assert.deepEqual(
      findUngroundedClaims({ reply, factSheet: FACT_SHEET, sizes: BLUE_GREY.sizes }),
      [],
      `${reply} should be accepted`
    );
  }
});

test('an invented measurement is caught', () => {
  const problems = findUngroundedClaims({
    reply: 'The length is about 92 cm.',
    factSheet: FACT_SHEET,
    sizes: BLUE_GREY.sizes,
  });

  assert.match(problems[0], /measurement not in our records/);
});

test('a real measurement is allowed through', () => {
  assert.deepEqual(
    findUngroundedClaims({
      reply: 'It is 84 cm long, so it sits above the knee.',
      factSheet: FACT_SHEET,
      sizes: BLUE_GREY.sizes,
    }),
    []
  );
});

/**
 * A customer pushing for a discount is the likeliest way to talk a model into
 * something the shop has to honour. Percentages and free delivery are refused
 * outright rather than checked against anything.
 */
test('discounts and free delivery are refused', () => {
  const discount = findUngroundedClaims({
    reply: 'I can give you 10% off for two pieces.',
    factSheet: FACT_SHEET,
    sizes: BLUE_GREY.sizes,
  });
  assert.match(discount[0], /percentage offer/);

  const delivery = findUngroundedClaims({
    reply: 'Yes, and free delivery for you.',
    factSheet: FACT_SHEET,
    sizes: BLUE_GREY.sizes,
  });
  assert.match(delivery[0], /free delivery/);
});

test('a size we do not stock is caught', () => {
  const problems = findUngroundedClaims({
    reply: 'Yes, we have it in XXL too.',
    factSheet: FACT_SHEET,
    sizes: BLUE_GREY.sizes,
  });

  assert.match(problems[0], /size we do not stock/);
});

test('sizes we do stock are allowed', () => {
  assert.deepEqual(
    findUngroundedClaims({
      reply: 'Available in S, M, L and XL.',
      factSheet: FACT_SHEET,
      sizes: BLUE_GREY.sizes,
    }),
    []
  );
});

test('several bad claims are all reported, not just the first', () => {
  const problems = findUngroundedClaims({
    reply: 'Rs 1,500 with 15% off, and we have XXXL.',
    factSheet: FACT_SHEET,
    sizes: BLUE_GREY.sizes,
  });

  assert.equal(problems.length, 3);
});
