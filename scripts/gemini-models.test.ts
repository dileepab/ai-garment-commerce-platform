import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTION_ROUTER_MODEL_CHAIN,
  CAPTION_MODEL_CHAIN,
  CHAT_MODEL_CHAIN,
  FIDELITY_VALIDATOR_CHAIN,
  GEMINI_MODEL_IDS,
  GROUNDED_ANSWER_MODEL_CHAIN,
  LANGUAGE_MODEL_CHAIN,
  chainWithOverride,
  fidelityValidatorModels,
} from '../src/lib/gemini-models.ts';

const ALL_CHAINS = {
  CHAT_MODEL_CHAIN,
  CAPTION_MODEL_CHAIN,
  ACTION_ROUTER_MODEL_CHAIN,
  LANGUAGE_MODEL_CHAIN,
  GROUNDED_ANSWER_MODEL_CHAIN,
  FIDELITY_VALIDATOR_CHAIN,
};

test('every chain is non-empty and free of repeats', () => {
  for (const [name, chain] of Object.entries(ALL_CHAINS)) {
    assert.ok(chain.length > 0, `${name} is empty`);
    // A repeat means the same failing model is called twice before the chain
    // moves on, doubling the latency of every fallback.
    assert.equal(new Set(chain).size, chain.length, `${name} repeats a model`);
  }
});

test('chains only name ids declared in one place', () => {
  const declared = new Set<string>(Object.values(GEMINI_MODEL_IDS));
  for (const [name, chain] of Object.entries(ALL_CHAINS)) {
    for (const model of chain) {
      assert.ok(declared.has(model), `${name} names ${model}, which is not declared`);
    }
  }
});

test('an override is tried first and never duplicated', () => {
  assert.deepEqual(
    chainWithOverride('custom-model', ['a', 'b']),
    ['custom-model', 'a', 'b'],
  );
  // Naming a model already in the chain must not call it twice on a failure.
  assert.deepEqual(chainWithOverride('a', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(chainWithOverride(undefined, ['a', 'b']), ['a', 'b']);
  assert.deepEqual(chainWithOverride('   ', ['a', 'b']), ['a', 'b']);
});

test('the fidelity chain ends on a model the platform already calls', () => {
  // High Accuracy fails closed, so the last resort must be an id proven in
  // production rather than a newer one that may not be provisioned.
  const last = FIDELITY_VALIDATOR_CHAIN[FIDELITY_VALIDATOR_CHAIN.length - 1];
  assert.equal(last, GEMINI_MODEL_IDS.flash35);
  assert.ok(CAPTION_MODEL_CHAIN.includes(last), 'last resort is not used elsewhere');

  assert.deepEqual(
    fidelityValidatorModels(),
    ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'],
  );
});

test('no text chain still reaches for a 2.x model', () => {
  // 2.5-flash is no longer provisioned for new API keys, so an entry here
  // buys a failed call before the chain falls through to something that works.
  const textChains = {
    CHAT_MODEL_CHAIN,
    CAPTION_MODEL_CHAIN,
    ACTION_ROUTER_MODEL_CHAIN,
    LANGUAGE_MODEL_CHAIN,
    GROUNDED_ANSWER_MODEL_CHAIN,
    FIDELITY_VALIDATOR_CHAIN,
  };

  for (const [name, chain] of Object.entries(textChains)) {
    for (const model of chain) {
      assert.ok(model.startsWith('gemini-3'), `${name} still names ${model}`);
    }
  }
});

test('every chain keeps a fallback, so one bad model is not an outage', () => {
  for (const [name, chain] of Object.entries(ALL_CHAINS)) {
    assert.ok(chain.length >= 2, `${name} has no fallback`);
  }
});

test('chain order is preserved per call site, because it encodes cost', () => {
  // Chat and language start on the cheapest lite model; captions start on the
  // stronger one because caption quality is what the customer reads.
  assert.equal(CHAT_MODEL_CHAIN[0], GEMINI_MODEL_IDS.flash31Lite);
  assert.equal(LANGUAGE_MODEL_CHAIN[0], GEMINI_MODEL_IDS.flash31Lite);
  assert.equal(CAPTION_MODEL_CHAIN[0], GEMINI_MODEL_IDS.flash35);
});
