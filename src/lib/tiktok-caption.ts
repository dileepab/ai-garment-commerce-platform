/**
 * Final TikTok caption cleanup.
 *
 * Product context is supplied to the caption model so it can write accurate
 * public copy. The same data is also rendered as a labelled catalogue block
 * for Facebook and Instagram. TikTok should receive the creator-style copy,
 * not that internal-looking block.
 *
 * Keep this function deterministic and run it again at publish time. That
 * makes old drafts safe as well as newly generated captions.
 */

const INTERNAL_DETAIL_LABELS = [
  'Item Name:',
  'Item Code:',
  'Available Sizes:',
  'Available Colors:',
  'Item Price:',
] as const;

function internalDetailBlockStart(caption: string): number | null {
  const lowerCaption = caption.toLowerCase();
  let cursor = 0;
  let start = -1;

  for (const label of INTERNAL_DETAIL_LABELS) {
    const index = lowerCaption.indexOf(label.toLowerCase(), cursor);
    if (index === -1) return null;
    if (start === -1) start = index;
    cursor = index + label.length;
  }

  return start;
}

export function prepareTikTokCaption(caption: string): string {
  const trimmed = caption.trim();
  const blockStart = internalDetailBlockStart(trimmed);
  const publicCopy = blockStart === null ? trimmed : trimmed.slice(0, blockStart).trimEnd();

  return publicCopy
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
