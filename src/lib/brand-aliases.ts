const BRAND_KEY_ALIASES: Record<string, string> = {
  deez: 'deez',
  happyby: 'happybuy',
  happybuy: 'happybuy',
  happybuyfashion: 'happybuy',
  cleopatra: 'cleopatra',
  modabella: 'modabella',
};

export function normalizeBrandKey(value?: string | null): string {
  const compact = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact ? BRAND_KEY_ALIASES[compact] || compact : '';
}

export function getBrandLookupAliases(value?: string | null): string[] {
  const cleaned = (value ?? '').trim();
  const key = normalizeBrandKey(cleaned);

  if (key === 'happybuy') {
    return Array.from(new Set(['Happybuy', cleaned, 'Happyby', 'Happy Buy', 'happybuy', 'happyby'].filter(Boolean)));
  }

  return cleaned ? [cleaned] : [];
}

export function brandsMatch(left?: string | null, right?: string | null): boolean {
  const leftKey = normalizeBrandKey(left);
  const rightKey = normalizeBrandKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}
