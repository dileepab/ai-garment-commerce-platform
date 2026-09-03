import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  isUsableImageResponse,
  personaAssetOrigin,
  personaAssetUrl,
  sniffImageMimeType,
} from '../src/lib/persona-asset.ts';
import { createPersonaIdentityReference } from '../src/lib/persona-reference.ts';
import { findPersonaForBrand } from '../src/lib/persona-data.ts';

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

/**
 * Every file in public/personas is a JPEG saved with a .png extension, so the
 * filename and the served content-type both say PNG while the data is JFIF.
 */
test('a JPEG saved as .png is reported as JPEG', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  assert.equal(sniffImageMimeType(jpeg), 'image/jpeg');
});

test('the other formats are recognised from their signatures', () => {
  assert.equal(
    sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  );
  assert.equal(
    sniffImageMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    'image/webp',
  );
  assert.equal(sniffImageMimeType(new Uint8Array([0x47, 0x49, 0x46, 0x38])), 'image/gif');
});

// The second line of defence: an HTML page that somehow passed the transport
// check still has no image signature.
test('non-image data sniffs to null', () => {
  const html = new Uint8Array([...'<!DOCTYPE html>'].map(c => c.charCodeAt(0)));
  assert.equal(sniffImageMimeType(html), null);
  assert.equal(sniffImageMimeType(new Uint8Array([])), null);
  assert.equal(sniffImageMimeType(new Uint8Array([0xff, 0xd8])), null);
});

test('a full-body persona gets a separate high-resolution identity crop', async () => {
  const source = await readFile('public/personas/happybuy_model_1.png');
  const identity = await createPersonaIdentityReference({
    base64: source.toString('base64'),
    mimeType: 'image/jpeg',
  });

  assert.ok(identity);
  assert.equal(identity.mimeType, 'image/jpeg');
  const metadata = await sharp(Buffer.from(identity.base64, 'base64')).metadata();
  assert.equal(metadata.width, 768);
  assert.equal(metadata.height, 768);
  assert.equal(metadata.format, 'jpeg');
});

test('persona lookup tolerates brand casing and surrounding spaces', () => {
  assert.equal(findPersonaForBrand(' happyBUY ', 'happybuy-1')?.label, 'Youthful & Bright');
  assert.equal(findPersonaForBrand('Happybuy', 'deez-1'), undefined);
  assert.equal(findPersonaForBrand('Unknown', 'happybuy-1'), undefined);
});
