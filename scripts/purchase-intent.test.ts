import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikePurchaseIntent } from '../src/lib/chat/purchase-intent.ts';

test('the message that was actually lost is recognised', () => {
  // From the inbox: a customer shown a skort replied this and was told the
  // bot did not understand and had passed them to the team.
  assert.equal(looksLikePurchaseIntent('හා සතුටුයි මට'), true);
});

test('Sinhala wanting and taking, in both scripts', () => {
  for (const message of [
    'මට ඕනේ',
    'ඒක ගන්නවා',
    'මට ඕන එකක්',
    'ඕඩර් කරන්න',
    'mata ona',
    'eka gannawa',
    'ganna ona',
    'order eka ganna',
  ]) {
    assert.equal(looksLikePurchaseIntent(message), true, message);
  }
});

test('Tamil wanting and buying, in both scripts', () => {
  for (const message of [
    'எனக்கு வேண்டும்',
    'வாங்குறேன்',
    'ஆர்டர் பண்ணுங்க',
    'enakku venum',
    'naan vanga poren',
  ]) {
    assert.equal(looksLikePurchaseIntent(message), true, message);
  }
});

test('agreement counts, because it is only read after a price', () => {
  for (const message of ['හා', 'ඔව්', 'හරි', 'හොඳයි', 'ow', 'ama', 'hari', 'sari', 'ஆம்']) {
    assert.equal(looksLikePurchaseIntent(message), true, message);
  }
});

test('a question about a product is not a decision to buy it', () => {
  for (const message of [
    'What is the price?',
    'Do you have this in red?',
    'size chart',
    'Colombo වලට ඩිලිවරි කරන්න කීයක් ගන්නවද?',
  ]) {
    assert.equal(looksLikePurchaseIntent(message), false, message);
  }
});

test('a Sinhala question is not a purchase, even using the same verb', () => {
  // ද turns the verb into a question: "ගන්නවද" is "do you charge".
  assert.equal(looksLikePurchaseIntent('Colombo වලට ඩිලිවරි කරන්න කීයක් ගන්නවද?'), false);
  assert.equal(looksLikePurchaseIntent('ඔයාලා ගන්නවද?'), false);
  assert.equal(looksLikePurchaseIntent('මට ඕනද?'), false);
  // The statement form still counts.
  assert.equal(looksLikePurchaseIntent('මම ඒක ගන්නවා'), true);
});

test('empty and wordless messages are not a sale', () => {
  assert.equal(looksLikePurchaseIntent(''), false);
  assert.equal(looksLikePurchaseIntent('   '), false);
  assert.equal(looksLikePurchaseIntent('👍'), false);
});
