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

interface TikTokProductFact {
  code: string | null;
  sizes: string | null;
  price: string | null;
}

function detailValue(description: string, label: string): string | null {
  const match = description.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  const value = match?.[1]?.trim();
  return value && value.toUpperCase() !== 'N/A' ? value : null;
}

function productFacts(descriptions: string[]): TikTokProductFact[] {
  const facts = descriptions
    .map((description) => ({
      code: detailValue(description, 'Item Code'),
      sizes: detailValue(description, 'Available Sizes'),
      price: detailValue(description, 'Item Price'),
    }))
    .filter((fact) => fact.sizes || fact.price);

  return Array.from(
    new Map(facts.map((fact) => [JSON.stringify(fact), fact])).values()
  );
}

function buildPublicFactsBlock(facts: TikTokProductFact[]): string {
  if (facts.length === 1) {
    return [
      facts[0].sizes && `📏 Available sizes: ${facts[0].sizes}`,
      facts[0].price && `💰 Price: ${facts[0].price}`,
    ].filter(Boolean).join('\n');
  }

  return facts.map((fact) => {
    const details = [
      fact.sizes && `📏 Sizes: ${fact.sizes}`,
      fact.price && `💰 Price: ${fact.price}`,
    ].filter(Boolean).join(' · ');
    return fact.code ? `${fact.code} — ${details}` : details;
  }).join('\n');
}

// Lines rendered by this module are removed before current database values are
// inserted. A draft can therefore survive a later price or size correction.
function removeExistingPublicFacts(caption: string): string {
  return caption
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^(?:📏\s*)?Available sizes:\s*.+$/i.test(trimmed)) return false;
      if (/^(?:💰\s*)?Price:\s*.+$/i.test(trimmed)) return false;
      if (/^[A-Z0-9][A-Z0-9-]*\s+[—–-]\s+(?:📏\s*)?Sizes:\s*.+\s+·\s+(?:💰\s*)?Price:\s*.+$/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');
}

function insertBeforeOrderOrHashtags(caption: string, block: string): string {
  const orderIndex = caption.search(/(?:^|\n)Order on WhatsApp:/i);
  if (orderIndex >= 0) {
    const before = caption.slice(0, orderIndex).trimEnd();
    const after = caption.slice(orderIndex).trimStart();
    return `${before}\n\n${block}\n\n${after}`;
  }

  const hashtagMatch = caption.match(/(?:\s*#[^\s#]+)+\s*$/);
  if (hashtagMatch?.index) {
    const before = caption.slice(0, hashtagMatch.index).trimEnd();
    return `${before}\n\n${block}\n\n${hashtagMatch[0].trim()}`;
  }

  return `${caption}\n\n${block}`;
}

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

export function prepareTikTokCaption(caption: string, descriptions: string[] = []): string {
  const trimmed = caption.trim();
  const blockStart = internalDetailBlockStart(trimmed);
  let publicCopy = blockStart === null ? trimmed : trimmed.slice(0, blockStart).trimEnd();
  const facts = productFacts(descriptions);

  if (facts.length > 0) {
    publicCopy = insertBeforeOrderOrHashtags(
      removeExistingPublicFacts(publicCopy).trim(),
      buildPublicFactsBlock(facts),
    );
  }

  return publicCopy
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
