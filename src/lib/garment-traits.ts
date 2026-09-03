/**
 * What kind of garment is being rendered, so the fidelity instructions can talk
 * about it in its own terms.
 *
 * The prompt was written when the catalog was three floral sundresses, and it
 * still reads that way: "copy the neckline, seams, stripe sequence and order,
 * artwork placement and scale, button line, cuffs, sleeve length". A skort has
 * none of those. Its distinguishing feature — a check whose grid lines are
 * broken dashes — had no clause at all, so the model redrew them as solid lines
 * and nothing in the checklist objected.
 *
 * Worse for anything not photographed from every angle: the inferred clauses
 * ended with "keep both dress sides closed; do not expose leg/skin through a
 * slit". On a wrap skort that is an instruction to destroy the design.
 *
 * Kept free of path aliases so it can be tested.
 */

export type PatternKind = 'check' | 'stripe' | 'floral' | 'plain' | 'unknown';

export interface GarmentTraits {
  /** A wrap opening that must be preserved, not sealed shut. */
  isWrap: boolean;
  /** Whether the garment is worn below the waist. */
  isBottom: boolean;
  /** Whether trouser-specific rise, leg and hem rules apply. */
  isTrousers: boolean;
  /** Whether sleeve, cuff and neckline language applies at all. */
  hasSleeves: boolean;
  patternKind: PatternKind;
}

export function detectGarmentTraits(text: string): GarmentTraits {
  const t = text.toLowerCase();

  // "wrap dress" and "wrap panel" both mean an overlap the model must keep.
  const isWrap = /\bwrap(?:-|\s)?(?:style|front|panel|over|skirt|dress|top)?\b/.test(t);

  // Bottoms have no sleeves to get wrong, and neither does anything explicitly
  // sleeveless. Naming cuffs on a skort invites the model to invent them.
  const isBottom = /\b(skort|skirt|pants|trousers|shorts|jeans|leggings|culottes)\b/.test(t);
  const isTrousers = /\b(pants|trousers|jeans|leggings|culottes)\b/.test(t);
  const saysSleeveless = /\b(sleeveless|strapless|tie-?strap|spaghetti strap|tank)\b/.test(t);
  const hasSleeves = !isBottom && !saysSleeveless;

  const patternKind: PatternKind =
    /\b(check|checked|plaid|tartan|gingham|windowpane|houndstooth)\b/.test(t) ? 'check'
    : /\b(stripe|striped|pinstripe|banded)\b/.test(t) ? 'stripe'
    : /\b(floral|flower|botanical|print|printed|graphic|motif)\b/.test(t) ? 'floral'
    : /\b(solid|plain|unpatterned)\b/.test(t) ? 'plain'
    : 'unknown';

  return { isWrap, isBottom, isTrousers, hasSleeves, patternKind };
}

/**
 * How to reproduce the surface of the cloth.
 *
 * The check line is deliberately specific about line style. A dashed grid read
 * at generation scale looks like a solid grid, and "copy the fabric texture"
 * was never going to preserve it.
 */
export function patternFidelityLine(traits: GarmentTraits): string {
  switch (traits.patternKind) {
    case 'check':
      return (
        '- PATTERN (check): reproduce the grid exactly — the size of the squares, the spacing between lines, ' +
        'and the LINE STYLE. If the reference lines are broken dashes, they must stay broken dashes; never ' +
        'redraw them as continuous lines. Keep the weave texture visible inside each square. Do not substitute ' +
        'a generic glen plaid, tartan, or smooth printed check.'
      );
    case 'stripe':
      return (
        '- PATTERN (stripe): reproduce the stripe sequence, order, thickness and direction exactly as ' +
        'photographed. Do not resize, reorder, or recolour the bands.'
      );
    case 'floral':
      return (
        '- PATTERN (print): reproduce the motif scale, density and placement exactly. Keep the print where the ' +
        'reference puts it; do not scatter it across panels it does not cover.'
      );
    case 'plain':
      return '- PATTERN: the cloth is plain. Add no check, stripe, print, or texture the reference does not show.';
    default:
      return (
        '- PATTERN: reproduce the surface of the cloth exactly as photographed — scale, spacing, line style and ' +
        'texture. Invent nothing the reference does not show.'
      );
  }
}

/** The construction details worth naming for this garment, and only those. */
export function constructionFidelityLine(traits: GarmentTraits): string {
  if (traits.isTrousers) {
    return (
      '- TROUSER CONSTRUCTION AND WAISTBAND TOPOLOGY: copy the waistband, exact presence or absence of a ' +
      'fly/zip/button/hook/tab/placket, front-only versus back belt loops, pocket opening shape and placement, ' +
      'pleat position and depth, rise, seams, and hem exactly as photographed. If the front reference shows one ' +
      'continuous, uninterrupted waistband, preserve it as one unbroken band across the centre front: never split ' +
      'it into left and right halves and never add a centre-front join, overlap, opening, fly shield, zipper seam, ' +
      'button, hook, tab or placket. The natural crotch seam must stop below that uninterrupted waistband instead ' +
      'of extending upward like a fly. A generic trouser shape is not permission to invent a conventional closure. ' +
      'Do not add, remove or relocate belt loops, pockets, pleats, darts, panels, pressed creases or closures.'
    );
  }

  const parts = traits.hasSleeves
    ? ['neckline', 'sleeve length and cuffs', 'button line or placket', 'seams', 'hem shape']
    : ['waistband', 'fastenings or their visible absence', 'pockets', 'seams', 'hem shape and curve'];

  return `- Copy the ${parts.join(', ')}, and the fabric colour, exactly as photographed.`;
}

/** Preserve lower-garment proportions instead of normalising them into generic trousers. */
export function silhouetteFidelityLine(traits: GarmentTraits): string {
  if (traits.isTrousers) {
    return (
      '- TROUSER SILHOUETTE AND LENGTH: preserve the exact rise, waist-to-hip ease, thigh width, leg line, ' +
      'hem opening and total length shown in the reference. Wide-leg trousers must remain wide and nearly ' +
      'straight from upper thigh through the hem; never turn them into slim, tailored, tapered, ankle-length ' +
      'or cropped trousers.'
    );
  }

  if (traits.isBottom) {
    return '- BOTTOM SILHOUETTE AND LENGTH: preserve the exact waist, hip ease, outline, hem width and worn length shown in the reference.';
  }

  return '- SILHOUETTE AND LENGTH: preserve the exact fitted and relaxed areas, outline and worn length shown in the reference.';
}

/**
 * What must not be invented — or, for a wrap, what must not be removed.
 *
 * The old blanket rule closed every side opening, which is right for a shift
 * dress and wrong for the garment that exposed the bug.
 */
export function openingGuardLine(traits: GarmentTraits): string {
  return traits.isWrap
    ? '- This garment WRAPS: the front panel overlaps and leaves a visible opening edge. Keep that overlap and ' +
      'its curved hem exactly as photographed. Do not close it into a plain skirt, do not seal the side seam, ' +
      'and do not straighten the wrap hem.'
    : '- Do not add a side slit, vent, wrap opening, or any exposed skin at the side that no reference shows.';
}
