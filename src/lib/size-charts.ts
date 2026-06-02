import { existsSync } from 'node:fs';
import path from 'node:path';

export type SizeChartCategory = 'tops' | 'tshirts' | 'dresses' | 'pants' | 'skirts';

interface SizeChartDefinition {
  category: SizeChartCategory;
  label: string;
  imagePath: string;
  imageFiles: string[];
}

export const DEFAULT_SIZE_CHART_CATEGORIES: SizeChartCategory[] = [
  'tops',
  'tshirts',
  'dresses',
  'pants',
];

const SIZE_CHART_DEFINITIONS: Record<SizeChartCategory, SizeChartDefinition> = {
  tops: {
    category: 'tops',
    label: 'Oversized Tops',
    imagePath: '/size-charts/oversized-tops.png',
    imageFiles: ['oversized-tops.png', 'tops.png'],
  },
  tshirts: {
    category: 'tshirts',
    label: 'T-Shirts',
    imagePath: '/size-charts/t-shirts.png',
    imageFiles: ['t-shirts.png', 'tshirts.png', 'tee-shirts.png'],
  },
  dresses: {
    category: 'dresses',
    label: 'Dresses',
    imagePath: '/size-charts/dresses.png',
    imageFiles: ['dresses.png', 'dress.png'],
  },
  pants: {
    category: 'pants',
    label: 'Pants',
    imagePath: '/size-charts/pants.png',
    imageFiles: ['pants.png'],
  },
  skirts: {
    category: 'skirts',
    label: 'Skirts',
    imagePath: '/size-charts/skirts.png',
    imageFiles: ['skirts.png'],
  },
};

function normalizeBrandSlug(brand?: string | null): string | null {
  const compact = (brand ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

  if (!compact) {
    return null;
  }

  if (compact === 'happybuy' || compact === 'happyby') {
    return 'happyby';
  }

  if (compact === 'cleopatra') {
    return 'cleopatra';
  }

  if (compact === 'modabella') {
    return 'modabella';
  }

  return compact;
}

function publicSizeChartExists(relativePath: string): boolean {
  const safeRelativePath = relativePath.replace(/^\/+/, '');
  return existsSync(path.join(process.cwd(), 'public', safeRelativePath));
}

export function getSizeChartDefinition(category: SizeChartCategory): SizeChartDefinition {
  return SIZE_CHART_DEFINITIONS[category];
}

export function getDefaultSizeChartCategories(): SizeChartCategory[] {
  return [...DEFAULT_SIZE_CHART_CATEGORIES];
}

export function getSizeChartImagePath(
  category: SizeChartCategory,
  brand?: string | null
): string | null {
  const definition = getSizeChartDefinition(category);
  const brandSlug = normalizeBrandSlug(brand);

  if (brandSlug) {
    for (const fileName of definition.imageFiles) {
      const brandPath = `/size-charts/${brandSlug}/${fileName}`;
      if (publicSizeChartExists(brandPath)) {
        return brandPath;
      }
    }
  }

  for (const fileName of definition.imageFiles) {
    const rootPath = `/size-charts/${fileName}`;
    if (publicSizeChartExists(rootPath)) {
      return rootPath;
    }
  }

  return null;
}

export function getSizeChartCategoryFromStyle(style?: string | null): SizeChartCategory | null {
  const normalizedStyle = (style ?? '').trim().toLowerCase();

  if (!normalizedStyle) {
    return null;
  }

  const searchableStyle = normalizedStyle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bt\s*shirts?\b|\btee\s*shirts?\b|\btees?\b/.test(searchableStyle)) {
    return 'tshirts';
  }

  if (
    normalizedStyle.includes('top') ||
    normalizedStyle.includes('shirt') ||
    normalizedStyle.includes('crop') ||
    normalizedStyle.includes('blouse')
  ) {
    return 'tops';
  }

  if (normalizedStyle.includes('gown') || normalizedStyle.includes('dress')) {
    return 'dresses';
  }

  if (
    normalizedStyle.includes('pant') ||
    normalizedStyle.includes('trouser') ||
    normalizedStyle.includes('jean') ||
    normalizedStyle.includes('legging')
  ) {
    return 'pants';
  }

  if (normalizedStyle.includes('skirt')) {
    return 'skirts';
  }

  return null;
}

export function getSizeChartCategoryFromText(message: string): SizeChartCategory | null {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bt\s*shirts?\b|\btee\s*shirts?\b|\btees?\b/.test(normalizedMessage)) {
    return 'tshirts';
  }

  if (
    normalizedMessage.includes('top') ||
    normalizedMessage.includes('shirt') ||
    normalizedMessage.includes('crop top') ||
    normalizedMessage.includes('blouse')
  ) {
    return 'tops';
  }

  if (normalizedMessage.includes('dress') || normalizedMessage.includes('gown')) {
    return 'dresses';
  }

  if (
    normalizedMessage.includes('pant') ||
    normalizedMessage.includes('pants') ||
    normalizedMessage.includes('trouser') ||
    normalizedMessage.includes('jean') ||
    normalizedMessage.includes('legging')
  ) {
    return 'pants';
  }

  if (normalizedMessage.includes('skirt')) {
    return 'skirts';
  }

  return null;
}
