import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  tiktokCreativeImagePath,
  verifyCreativeImageToken,
} from '../src/lib/creative-image-token.ts';

test('builds a signed, direct WebP route for TikTok image pulls', () => {
  const previousCreativeSecret = process.env.CREATIVE_IMAGE_SECRET;
  const previousAuthSecret = process.env.AUTH_SECRET;
  process.env.CREATIVE_IMAGE_SECRET = 'tiktok-image-signing-secret-at-least-24-characters';
  delete process.env.AUTH_SECRET;

  try {
    const path = tiktokCreativeImagePath(42, 60);
    assert.ok(path);
    const parsed = new URL(path, 'https://app.deez.lk');
    assert.equal(parsed.pathname, '/api/content/creatives/42/tiktok-image.webp');
    assert.equal(verifyCreativeImageToken(
      42,
      parsed.searchParams.get('exp'),
      parsed.searchParams.get('token'),
    ), true);
  } finally {
    if (previousCreativeSecret === undefined) delete process.env.CREATIVE_IMAGE_SECRET;
    else process.env.CREATIVE_IMAGE_SECRET = previousCreativeSecret;
    if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousAuthSecret;
  }
});

test('refuses to build a public TikTok image URL without a signing secret', () => {
  const previousCreativeSecret = process.env.CREATIVE_IMAGE_SECRET;
  const previousAuthSecret = process.env.AUTH_SECRET;
  delete process.env.CREATIVE_IMAGE_SECRET;
  delete process.env.AUTH_SECRET;

  try {
    assert.equal(tiktokCreativeImagePath(42), null);
  } finally {
    if (previousCreativeSecret === undefined) delete process.env.CREATIVE_IMAGE_SECRET;
    else process.env.CREATIVE_IMAGE_SECRET = previousCreativeSecret;
    if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousAuthSecret;
  }
});
