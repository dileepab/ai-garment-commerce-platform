// Visual direction fed into creative generation. Each brand sells to a
// different customer, so a single shared palette made every brand's campaign
// imagery look the same. Keyed to match PERSONAS_BY_BRAND in persona-data.ts.

export interface BrandStyle {
  colorPalette: string;
  aesthetic: string;
  mood: string;
}

export const DEFAULT_BRAND_STYLE: BrandStyle = {
  colorPalette: 'warm neutrals, soft pinks, ivory, dusty rose',
  aesthetic: 'feminine, elegant, modern',
  mood: 'aspirational yet accessible',
};

export const BRAND_STYLES: Record<string, BrandStyle> = {
  DEEZ: {
    colorPalette: 'charcoal, concrete grey, washed denim, off-white, muted olive',
    aesthetic: 'edgy streetwear, urban, relaxed silhouettes',
    mood: 'confident and effortless, city-street energy',
  },
  Happybuy: {
    colorPalette: 'bright coral, sunny yellow, fresh mint, clean white',
    aesthetic: 'youthful, cheerful, everyday-casual',
    mood: 'upbeat and friendly, great value without feeling cheap',
  },
  Cleopatra: {
    colorPalette: 'deep emerald, midnight navy, gold accents, rich burgundy, ivory',
    aesthetic: 'high-fashion editorial, luxurious, sculptural',
    mood: 'commanding and glamorous, red-carpet presence',
  },
  Modabella: {
    colorPalette: 'soft taupe, powder blue, cream, slate, muted blush',
    aesthetic: 'polished professional, tailored, understated',
    mood: 'capable and self-assured, ready for the workday',
  },
};

// Brand names reach this from user data and DB rows, so match case-insensitively
// before falling back rather than silently handing back the wrong brand's look.
export function getBrandStyle(brand: string): BrandStyle {
  const key = brand?.trim().toLowerCase();
  if (!key) return DEFAULT_BRAND_STYLE;

  const match = Object.keys(BRAND_STYLES).find(name => name.toLowerCase() === key);
  return match ? BRAND_STYLES[match] : DEFAULT_BRAND_STYLE;
}
