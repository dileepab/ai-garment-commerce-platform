export type SizeChartCategory = 'tops' | 'dresses' | 'pants' | 'skirts';

interface SizeChartDefinition {
  category: SizeChartCategory;
  label: string;
  imagePath: string;
}

const SIZE_CHART_DEFINITIONS: Record<SizeChartCategory, SizeChartDefinition> = {
  tops: {
    category: 'tops',
    label: 'Tops',
    imagePath: '/size-charts/tops.png',
  },
  dresses: {
    category: 'dresses',
    label: 'Dresses',
    imagePath: '/size-charts/dresses.png',
  },
  pants: {
    category: 'pants',
    label: 'Pants',
    imagePath: '/size-charts/pants.png',
  },
  skirts: {
    category: 'skirts',
    label: 'Skirts',
    imagePath: '/size-charts/skirts.png',
  },
};

export function getSizeChartDefinition(category: SizeChartCategory): SizeChartDefinition {
  return SIZE_CHART_DEFINITIONS[category];
}

export function getSizeChartCategoryFromStyle(style?: string | null): SizeChartCategory | null {
  const normalizedStyle = (style ?? '').trim().toLowerCase();

  if (!normalizedStyle) {
    return null;
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
  const normalizedMessage = message.toLowerCase();

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
