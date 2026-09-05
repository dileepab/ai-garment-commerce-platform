import sharp from 'sharp';

export interface EncodedImage {
  base64: string;
  mimeType: string;
}

/**
 * Enlarges the waistband of a front trouser reference into its own image.
 *
 * The same problem the persona identity crop solves, applied to the region
 * that actually fails. In a full-length trouser photograph the waistband is a
 * sliver of the pixels, and the model's prior — every trouser it has ever seen
 * has a fly — beats a reference where the flat, flyless band is barely legible.
 * Verification logs showed exactly that: three attempts rejected for "a visible
 * fly stitch line and an overlapping waistband closure tab at center front",
 * against a reference that has neither, after being told three times in text
 * not to add one. Words did not work; pixels might.
 *
 * The top of a garment-only photograph is the waistband. Returns null rather
 * than guessing when the crop would be meaningless.
 */
export async function createWaistbandReference(
  image: EncodedImage,
): Promise<EncodedImage | null> {
  try {
    const source = Buffer.from(image.base64, 'base64');
    const { width, height } = await sharp(source).metadata();
    if (!width || !height) return null;

    // A waist-down garment shot is tall; the band sits in the top quarter.
    // A near-square or wide image is framed differently and the crop would be
    // showing the model something other than what the label claims.
    if (height < width * 1.2) return null;

    const cropHeight = Math.max(120, Math.round(height * 0.26));
    const detail = await sharp(source)
      .extract({ left: 0, top: 0, width, height: Math.min(cropHeight, height) })
      .resize(1024, null, { fit: 'inside', withoutEnlargement: false })
      .jpeg({ quality: 96 })
      .toBuffer();

    return { base64: detail.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}
