function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CODE_128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export function buildCode128BarcodeSvg(value: string): string {
  const cleaned = value.replace(/[^\x20-\x7E]/g, '').trim() || '0';
  const codes = [104, ...cleaned.split('').map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => (
    index === 0 ? sum + code : sum + code * index
  ), 0) % 103;
  const allCodes = [...codes, checksum, 106];
  let x = 0;
  const bars: string[] = [];

  for (const code of allCodes) {
    const pattern = CODE_128_PATTERNS[code];
    if (!pattern) continue;

    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number.parseInt(pattern[index], 10);
      if (index % 2 === 0) {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="42" />`);
      }
      x += width;
    }
  }

  return [
    `<svg class="barcode-svg" viewBox="0 0 ${x} 42" role="img" aria-label="Waybill barcode ${escapeHtml(cleaned)}" preserveAspectRatio="none">`,
    bars.join(''),
    '</svg>',
  ].join('');
}
