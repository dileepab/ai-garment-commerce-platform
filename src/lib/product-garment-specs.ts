export interface ProductGarmentSpecSource {
  garmentLengthCm?: number | null;
  sleeveLengthCm?: number | null;
  sleeveType?: string | null;
  fitType?: string | null;
  neckline?: string | null;
  closureDetails?: string | null;
  hasSideSlit?: boolean | null;
  sideSlitHeightCm?: number | null;
  hemDetails?: string | null;
  sleeveHemDetails?: string | null;
  patternDetails?: string | null;
  referenceModelHeightCm?: number | null;
  wornLengthNote?: string | null;
  aiFidelityNotes?: string | null;
}

function cleanText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatCm(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Number.isInteger(value) ? `${value} cm` : `${value.toFixed(1)} cm`;
}

export function hasGarmentSpecs(product: ProductGarmentSpecSource): boolean {
  return buildGarmentSpecLines(product).length > 0;
}

export function buildGarmentSpecLines(product: ProductGarmentSpecSource): string[] {
  const lines: string[] = [];
  const garmentLength = formatCm(product.garmentLengthCm);
  const sleeveLength = formatCm(product.sleeveLengthCm);
  const referenceHeight = formatCm(product.referenceModelHeightCm);
  const sideSlitHeight = formatCm(product.sideSlitHeightCm);
  const sleeveParts = [cleanText(product.sleeveType), sleeveLength].filter(Boolean);

  if (garmentLength) lines.push(`Garment length: ${garmentLength}`);
  if (sleeveParts.length > 0) lines.push(`Sleeve: ${sleeveParts.join(', ')}`);
  if (cleanText(product.fitType)) lines.push(`Fit: ${cleanText(product.fitType)}`);
  if (cleanText(product.wornLengthNote)) lines.push(`Worn length: ${cleanText(product.wornLengthNote)}`);
  if (referenceHeight) lines.push(`Reference model height: ${referenceHeight}`);
  if (cleanText(product.neckline)) lines.push(`Neckline: ${cleanText(product.neckline)}`);
  if (cleanText(product.closureDetails)) lines.push(`Closure/details: ${cleanText(product.closureDetails)}`);

  if (product.hasSideSlit) {
    lines.push(`Side slit: yes${sideSlitHeight ? `, ${sideSlitHeight} high` : ''}`);
  } else if (product.hasSideSlit === false) {
    lines.push('Side slit: no');
  }

  if (cleanText(product.hemDetails)) lines.push(`Bottom hem: ${cleanText(product.hemDetails)}`);
  if (cleanText(product.sleeveHemDetails)) lines.push(`Sleeve hem/cuff: ${cleanText(product.sleeveHemDetails)}`);
  if (cleanText(product.patternDetails)) lines.push(`Pattern/print placement: ${cleanText(product.patternDetails)}`);
  if (cleanText(product.aiFidelityNotes)) lines.push(`Fidelity notes: ${cleanText(product.aiFidelityNotes)}`);

  return lines;
}

export function buildGarmentSpecsForCustomer(product: ProductGarmentSpecSource): string {
  const lines = buildGarmentSpecLines(product).filter(
    (line) => !line.toLowerCase().startsWith('fidelity notes:'),
  );
  return lines.length > 0 ? lines.join('\n') : '';
}

export function buildGarmentSpecsForAi(product: ProductGarmentSpecSource): string {
  const lines = buildGarmentSpecLines(product);
  if (lines.length === 0) return '';
  return [
    'Structured garment specs from product record. Follow these exactly with the source image:',
    ...lines.map((line) => `- ${line}`),
  ].join('\n');
}
