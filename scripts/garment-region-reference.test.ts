import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createWaistbandReference } from '../src/lib/garment-region-reference.ts';

async function solid(width: number, height: number, top: string, bottom: string) {
  const image = await sharp({
    create: { width, height, channels: 3, background: top },
  })
    .composite([{
      input: await sharp({
        create: { width, height: Math.round(height / 2), channels: 3, background: bottom },
      }).png().toBuffer(),
      top: Math.round(height / 2),
      left: 0,
    }])
    .jpeg()
    .toBuffer();

  return { base64: image.toString('base64'), mimeType: 'image/jpeg' };
}

test('a tall garment photo yields the top of the frame, enlarged', async () => {
  // Top half red, bottom half blue: if the crop is taken from the top, the
  // result is red — which is where a waistband sits in a waist-down shot.
  const source = await solid(400, 1200, '#ff0000', '#0000ff');
  const cropped = await createWaistbandReference(source);

  assert.ok(cropped, 'expected a crop');
  const buffer = Buffer.from(cropped.base64, 'base64');
  const { width, height } = await sharp(buffer).metadata();
  assert.ok(width && height && width > height, 'waistband crop should be wide, not tall');

  const { dominant } = await sharp(buffer).stats();
  assert.ok(dominant.r > 200 && dominant.b < 60, 'crop did not come from the top of the frame');
});

test('a square or wide photo is refused rather than mislabelled', async () => {
  // The label promises the model a waistband. On a frame that is not a
  // waist-down shot the top is something else, and a confidently wrong
  // reference is worse than none.
  assert.equal(await createWaistbandReference(await solid(1000, 1000, '#ff0000', '#0000ff')), null);
  assert.equal(await createWaistbandReference(await solid(1600, 900, '#ff0000', '#0000ff')), null);
});

test('unreadable bytes return null instead of throwing', async () => {
  assert.equal(
    await createWaistbandReference({ base64: 'bm90LWFuLWltYWdl', mimeType: 'image/jpeg' }),
    null,
  );
});
