/**
 * How a brand's size chart looks.
 *
 * The charts were drawn by hand, one PNG per brand per garment type, and each
 * brand's artwork had its own palette. Rendering them from data means the
 * palette has to live somewhere — here — so a new product's chart comes out
 * looking like the brand's rather than like a spreadsheet.
 *
 * Type is deliberately one family across all brands: the renderer ships a
 * single font, and a serif that silently falls back to sans looks worse than
 * a sans that meant it.
 */

import { normalizeBrandKey } from '@/lib/brand-aliases';

export interface SizeChartTheme {
  /** Header band. */
  headerBg: string;
  headerFg: string;
  headerSubtleFg: string;
  /** The rule under the header and the colour of table headings and sizes. */
  accent: string;
  pageBg: string;
  stripeBg: string;
  bodyFg: string;
  mutedFg: string;
  borderColor: string;
  footerBg: string;
  /** Line under the brand name. */
  tagline: string;
}

const NEUTRAL: SizeChartTheme = {
  headerBg: '#2B2A26',
  headerFg: '#FFFFFF',
  headerSubtleFg: 'rgba(255,255,255,0.78)',
  accent: '#8A6A3B',
  pageBg: '#FFFFFF',
  stripeBg: '#FAF9F7',
  bodyFg: '#2B2A26',
  mutedFg: '#6B6A63',
  borderColor: '#E7E4DE',
  footerBg: '#F7F6F3',
  tagline: 'Size Guide',
};

const THEMES: Record<string, SizeChartTheme> = {
  happybuy: {
    ...NEUTRAL,
    headerBg: '#F5821F',
    accent: '#C2410C',
    stripeBg: '#FFFBF5',
    borderColor: '#F2E4D3',
    footerBg: '#FBF7F2',
    tagline: 'Size Guide — Happy Shopping, Joyful Buys',
  },
  cleopatra: {
    ...NEUTRAL,
    headerBg: '#0B4034',
    accent: '#B4471F',
    stripeBg: '#F7F9F7',
    borderColor: '#E2E8E3',
    footerBg: '#F6F8F6',
    tagline: 'Premium Tailored Sizing Collection',
  },
  modabella: {
    ...NEUTRAL,
    headerBg: '#1B2A3A',
    accent: '#E1223B',
    stripeBg: '#F8F9FA',
    borderColor: '#E4E7EA',
    footerBg: '#F7F8F9',
    tagline: 'Modernist Silhouette Guide',
  },
};

export function sizeChartTheme(brand?: string | null): SizeChartTheme {
  return THEMES[normalizeBrandKey(brand)] ?? NEUTRAL;
}

export function brandDisplayName(brand?: string | null): string {
  const trimmed = (brand ?? '').trim();
  if (!trimmed) return 'Size Guide';

  const key = normalizeBrandKey(trimmed);
  if (key === 'happybuy') return 'HAPPY BUY';
  return trimmed.toUpperCase();
}
