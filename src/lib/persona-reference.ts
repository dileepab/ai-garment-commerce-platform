import sharp from 'sharp';

export interface EncodedPersonaImage {
  base64: string;
  mimeType: string;
}

/**
 * Builds a tight identity reference from the campaign model's full-body photo.
 *
 * The persona assets are square full-body portraits, so the face occupies only
 * a small fraction of the pixels Gemini receives. The models are consistently
 * framed with the face near the upper centre; this crop gives Gemini a second,
 * high-resolution view of the same identity without replacing the full-body
 * reference used for height and body shape.
 */
export async function createPersonaIdentityReference(
  image: EncodedPersonaImage,
): Promise<EncodedPersonaImage | null> {
  try {
    const source = Buffer.from(image.base64, 'base64');
    const metadata = await sharp(source).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return null;

    const side = Math.max(96, Math.round(Math.min(width, height) * 0.25));
    const centreX = Math.round(width * 0.5);
    const centreY = Math.round(height * 0.155);
    const left = Math.max(0, Math.min(width - side, Math.round(centreX - side / 2)));
    const top = Math.max(0, Math.min(height - side, Math.round(centreY - side / 2)));

    const detail = await sharp(source)
      .extract({ left, top, width: side, height: side })
      .resize(768, 768, { fit: 'fill' })
      .jpeg({ quality: 96 })
      .toBuffer();

    return { base64: detail.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}
