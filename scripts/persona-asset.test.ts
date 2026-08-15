import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isUsableImageResponse,
  personaAssetOrigin,
  personaAssetUrl,
} from '../src/lib/persona-asset.ts';

/**
 * The response that got through: /personas/... sits behind NextAuth, a
 * server-side fetch carries no cookie, the middleware redirects to /login and
 * returns an HTML page with status 200. That was base64-encoded and sent to
 * Gemini labelled image/png.
 */
test('an auth redirect to a login page is not an image', () => {
  assert.equal(isUsableImageResponse(200, 'text/html; charset=utf-8'), false);
});

test('a real image response is accepted', () => {
  assert.equal(isUsableImageResponse(200, 'image/png'), true);
  assert.equal(isUsableImageResponse(200, 'image/jpeg'), true);
  assert.equal(isUsableImageResponse(200, 'IMAGE/WEBP'), true);
});

test('a missing or error response is rejected', () => {
  assert.equal(isUsableImageResponse(404, 'image/png'), false);
  assert.equal(isUsableImageResponse(500, 'image/png'), false);
  assert.equal(isUsableImageResponse(302, 'image/png'), false);
});

// No content-type is not a reason to guess from the file extension: guessing is
// exactly how a login page became a PNG.
test('a response with no content-type is rejected', () => {
  assert.equal(isUsableImageResponse(200, null), false);
  assert.equal(isUsableImageResponse(200, ''), false);
});

test('the explicit base URL wins', () => {
  assert.equal(
    personaAssetOrigin({ APP_BASE_URL: 'https://app.deez.lk/', VERCEL_URL: 'x.vercel.app' }),
    'https://app.deez.lk',
  );
});

test('Vercel variables are the fallback, and get a scheme', () => {
  assert.equal(personaAssetOrigin({ VERCEL_URL: 'deez-abc123.vercel.app' }), 'https://deez-abc123.vercel.app');
  assert.equal(
    personaAssetOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'app.deez.lk', VERCEL_URL: 'x.vercel.app' }),
    'https://app.deez.lk',
  );
});

test('no base URL at all is null, not a broken string', () => {
  assert.equal(personaAssetOrigin({}), null);
  assert.equal(personaAssetOrigin({ APP_BASE_URL: '   ' }), null);
});

test('the asset URL joins cleanly whatever the slashes', () => {
  assert.equal(personaAssetUrl('https://app.deez.lk', '/personas/a.png'), 'https://app.deez.lk/personas/a.png');
  assert.equal(personaAssetUrl('https://app.deez.lk/', 'personas/a.png'), 'https://app.deez.lk/personas/a.png');
});
