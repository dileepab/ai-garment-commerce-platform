import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FIDELITY_CHECK_IDS,
  buildFidelityRetryCorrection,
  buildFidelityValidatorPrompt,
  describeFailedChecks,
  describeFidelityRejection,
  evaluateFidelityAssessment,
  fidelityFingerprint,
  parseFidelityAssessment,
  requiredFidelityChecks,
  type FidelityAssessment,
  type FidelityCheckId,
  type FidelityCheckStatus,
} from '../src/lib/creative-fidelity.ts';
import { detectGarmentTraits } from '../src/lib/garment-traits.ts';
import { fidelityValidatorModels } from '../src/lib/gemini-models.ts';

function assessmentWith(
  statuses: Partial<Record<FidelityCheckId, FidelityCheckStatus>> = {},
): FidelityAssessment {
  // Built by assignment rather than Object.fromEntries, whose string-keyed
  // return type will not narrow to the check ids. Same shape the parser uses.
  const checks = {} as FidelityAssessment['checks'];
  for (const id of FIDELITY_CHECK_IDS) {
    checks[id] = { status: statuses[id] ?? 'pass', evidence: [] };
  }

  return {
    schemaVersion: 'creative-fidelity-v1',
    candidateView: 'front',
    checks,
  };
}

test('valid structured visual QA JSON parses', () => {
  const source = assessmentWith({
    identity: 'fail',
    waistband_and_front_opening: 'fail',
  });
  const parsed = parseFidelityAssessment(JSON.stringify(source));
  assert.deepEqual(parsed, source);
});

test('malformed, incomplete, or unknown QA output fails closed', () => {
  assert.equal(parseFidelityAssessment('not json'), null);
  assert.equal(parseFidelityAssessment(JSON.stringify({ schemaVersion: 'creative-fidelity-v1' })), null);

  const unknownStatus = assessmentWith() as unknown as {
    checks: Record<string, { status: string; evidence: string[] }>;
  };
  unknownStatus.checks.identity.status = 'probably';
  assert.equal(parseFidelityAssessment(JSON.stringify(unknownStatus)), null);
});

test('front trousers require identity, exact product, construction, waistband, color, fit and framing', () => {
  const required = requiredFidelityChecks({
    hasPersona: true,
    viewAngle: 'front',
    traits: detectGarmentTraits('Mustard linen wide-leg trousers'),
  });
  assert.deepEqual(required, [
    'identity',
    'same_product',
    'requested_view',
    'construction',
    'color',
    'framing_and_visibility',
    'silhouette_and_length',
    'waistband_and_front_opening',
  ]);
});

test('closeups do not require face identity or full-length silhouette', () => {
  const required = requiredFidelityChecks({
    hasPersona: true,
    viewAngle: 'closeup',
    traits: detectGarmentTraits('Mustard linen wide-leg trousers'),
  });
  assert.equal(required.includes('identity'), false);
  assert.equal(required.includes('silhouette_and_length'), false);
  assert.equal(required.includes('waistband_and_front_opening'), false);
});

test('a visible identity mismatch and invented fly reject the candidate', () => {
  const required: FidelityCheckId[] = ['identity', 'waistband_and_front_opening'];
  const decision = evaluateFidelityAssessment(
    assessmentWith({ identity: 'fail', waistband_and_front_opening: 'fail' }),
    required,
  );
  assert.equal(decision.pass, false);
  assert.deepEqual(decision.failedChecks, required);
});

test('uncertain or not-applicable required evidence can never pass', () => {
  const required: FidelityCheckId[] = ['identity', 'same_product'];
  const decision = evaluateFidelityAssessment(
    assessmentWith({ identity: 'not_assessable', same_product: 'not_applicable' }),
    required,
  );
  assert.equal(decision.pass, false);
  assert.deepEqual(decision.failedChecks, required);
});

test('all required visible checks must pass', () => {
  const required: FidelityCheckId[] = [
    'identity',
    'same_product',
    'construction',
    'waistband_and_front_opening',
  ];
  const decision = evaluateFidelityAssessment(assessmentWith(), required);
  assert.equal(decision.pass, true);
  assert.deepEqual(decision.failedChecks, []);
});

test('retry text is allowlisted and explicitly removes the fly and split waistband', () => {
  const correction = buildFidelityRetryCorrection([
    'identity',
    'waistband_and_front_opening',
    'waistband_and_front_opening',
  ]);
  assert.match(correction, /exact individual in Images A1\/A2/);
  assert.match(correction, /continuous unbroken band/);
  assert.match(correction, /centre join, split/);
  assert.match(correction, /J\/U-shaped fly panel/);
  assert.equal((correction.match(/Rebuild the trouser front/g) ?? []).length, 1);
});

test('validator prompt treats same-person and garment topology as visible evidence', () => {
  const prompt = buildFidelityValidatorPrompt({
    personaId: 'happybuy-1',
    hasPersona: true,
    viewAngle: 'front',
    traits: detectGarmentTraits('Mustard linen wide-leg trousers'),
    productContext: 'Pale muted mustard-yellow pull-on wide-leg trousers',
    authoritativeRules: 'Continuous front waistband. No fly or centre opening.',
  });
  assert.match(prompt, /similar-looking person is a failure/);
  assert.match(prompt, /J\/U-shaped centre-front panel/);
  assert.match(prompt, /AUTHORITATIVE PRODUCT RULES/);
  assert.match(prompt, /No fly or centre opening/);
  assert.match(prompt, /False pass is worse than false fail/);
});

test('log fingerprints are stable and do not expose the source text', () => {
  const first = fidelityFingerprint('secret product rules');
  const second = fidelityFingerprint('secret product rules');
  assert.equal(first, second);
  assert.equal(first.length, 12);
  assert.doesNotMatch(first, /secret|product|rules/);
});

test('visual QA uses current stable Gemini 3 models and never the retired 2.5 fallback', () => {
  assert.deepEqual(
    fidelityValidatorModels(),
    ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'],
  );
  assert.deepEqual(
    fidelityValidatorModels('custom-review-model'),
    ['custom-review-model', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'],
  );
  assert.equal(fidelityValidatorModels().includes('gemini-2.5-flash'), false);
});

test('an unreadable reference is not reported as a mismatched image', () => {
  const decision = evaluateFidelityAssessment(
    assessmentWith({ construction: 'not_assessable', same_product: 'fail' }),
    ['same_product', 'construction'],
  );

  assert.deepEqual(decision.mismatchedChecks, ['same_product']);
  assert.deepEqual(decision.unreadableChecks, ['construction']);
  // Both still block saving: an unverified image is not a verified one.
  assert.equal(decision.pass, false);
  assert.deepEqual(decision.failedChecks, ['same_product', 'construction']);

  const message = describeFidelityRejection(decision);
  assert.match(message, /did not match the product or model \(same_product\)/);
  assert.match(message, /could not be verified against the reference photo \(construction\)/);
  assert.match(message, /No image was saved/);
});

test('a rejection with nothing readable does not claim a mismatch', () => {
  const decision = evaluateFidelityAssessment(
    assessmentWith({ construction: 'not_assessable' }),
    ['construction'],
  );

  const message = describeFidelityRejection(decision);
  assert.equal(decision.mismatchedChecks.length, 0);
  // The old message said "did not match" for this case, which sent people
  // looking for a defect that was never established.
  assert.doesNotMatch(message, /did not match/);
  assert.match(message, /could not be verified/);
});

test('the validator keeps its own words, so a rejection can be read back', () => {
  const assessment = assessmentWith({ color: 'fail' });
  assessment.checks.color.evidence = ['candidate is lighter and more saturated than Image B'];

  const decision = evaluateFidelityAssessment(assessment, ['color']);

  assert.deepEqual(
    describeFailedChecks(decision),
    ['color=fail: candidate is lighter and more saturated than Image B'],
  );
});

test('not_applicable is not a failure', () => {
  const decision = evaluateFidelityAssessment(
    assessmentWith({ waistband_and_front_opening: 'not_applicable' }),
    ['same_product'],
  );
  assert.equal(decision.pass, true);
  assert.deepEqual(decision.failedChecks, []);
});
