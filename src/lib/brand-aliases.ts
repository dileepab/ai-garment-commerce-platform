const BRAND_KEY_ALIASES: Record<string, string> = {
  deez: 'deez',
  happyby: 'happyby',
  happybuy: 'happyby',
  happybuyfashion: 'happyby',
  cleopatra: 'cleopatra',
  modabella: 'modabella',
};

export function normalizeBrandKey(value?: string | null): string {
  const compact = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact ? BRAND_KEY_ALIASES[compact] || compact : '';
}

export function brandsMatch(left?: string | null, right?: string | null): boolean {
  const leftKey = normalizeBrandKey(left);
  const rightKey = normalizeBrandKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}
