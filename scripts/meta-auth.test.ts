import assert from 'node:assert/strict';
import test from 'node:test';
import { isInstagramLoginAccessToken } from '../src/lib/meta-auth.ts';

test('detects native Instagram Login access tokens', () => {
  assert.equal(isInstagramLoginAccessToken('IGQV-example-token'), true);
  assert.equal(isInstagramLoginAccessToken('  IGA-example-token  '), true);
});

test('does not classify Facebook Page access tokens as Instagram Login tokens', () => {
  assert.equal(isInstagramLoginAccessToken('EAA-example-page-token'), false);
  assert.equal(isInstagramLoginAccessToken(''), false);
});
