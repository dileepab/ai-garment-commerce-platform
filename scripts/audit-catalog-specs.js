/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Finds garment specs that describe the wrong garment.
 *
 * The bot renders `patternDetails` to customers verbatim, so a wrong value is
 * read as fact. HAP-0001 (Blue Grey, a plain dress) was telling shoppers it had
 * "a small white floral print on a red background" — the Red Floral variant's
 * description, copied across when the colourways were created and never edited.
 *
 * Two checks, both aimed at that class of mistake:
 *   1. a spec mentioning a colour the product does not come in
 *   2. the same spec text shared by products of different colours
 *
 * Reports only. Fixing is a judgement call about which product the text
 * actually belongs to, and that is not something a script should guess.
 *
 *   node --env-file=.env scripts/audit-catalog-specs.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const COLOUR_WORDS = [
  'red', 'blue', 'green', 'black', 'white', 'grey', 'gray', 'pink', 'yellow',
  'orange', 'purple', 'violet', 'brown', 'beige', 'cream', 'navy', 'maroon',
  'teal', 'olive', 'mustard', 'lilac', 'peach', 'gold', 'silver',
];

// Specs are written per garment, so these are the fields a shopper is quoted.
const SPEC_FIELDS = ['patternDetails', 'hemDetails', 'sleeveHemDetails', 'closureDetails'];

function coloursIn(text) {
  const lower = (text || '').toLowerCase();
  return COLOUR_WORDS.filter((colour) => new RegExp(`\\b${colour}\\b`).test(lower));
}

function normalize(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true, sku: true, brand: true, name: true, colors: true,
      patternDetails: true, hemDetails: true, sleeveHemDetails: true, closureDetails: true,
    },
    orderBy: { id: 'asc' },
  });

  const mismatches = [];
  const bySpecText = new Map();

  for (const product of products) {
    // The colours this product legitimately mentions: its colour list plus its
    // own name, since names usually carry the colourway.
    const own = new Set(coloursIn(`${product.colors} ${product.name}`));

    for (const field of SPEC_FIELDS) {
      const value = product[field];
      if (!value) continue;

      const stray = coloursIn(value).filter((colour) => !own.has(colour));
      if (stray.length > 0) {
        mismatches.push({ product, field, stray, value });
      }

      if (field === 'patternDetails') {
        const key = normalize(value);
        if (!bySpecText.has(key)) bySpecText.set(key, []);
        bySpecText.get(key).push(product);
      }
    }
  }

  const label = (p) => `#${p.id} ${p.sku || ''} ${p.brand} — ${p.name}`.replace(/\s+/g, ' ');

  console.log(`Scanned ${products.length} products.\n`);

  console.log(`=== Specs mentioning a colour the product does not come in (${mismatches.length}) ===`);
  if (mismatches.length === 0) console.log('None.');
  for (const m of mismatches) {
    console.log(`\n${label(m.product)}`);
    console.log(`  colours on record : ${m.product.colors}`);
    console.log(`  field             : ${m.field}`);
    console.log(`  unexpected colour : ${m.stray.join(', ')}`);
    console.log(`  text              : ${m.value.slice(0, 180)}`);
  }

  const shared = [...bySpecText.entries()].filter(([, list]) => {
    if (list.length < 2) return false;
    // Same text across one colourway is fine; across different colours it is not.
    return new Set(list.map((p) => normalize(p.colors))).size > 1;
  });

  console.log(`\n=== Identical pattern text across different colours (${shared.length}) ===`);
  if (shared.length === 0) console.log('None.');
  for (const [text, list] of shared) {
    console.log(`\n  shared text: ${text.slice(0, 140)}`);
    for (const p of list) console.log(`    ${label(p)}  [colours: ${p.colors}]`);
  }

  const total = mismatches.length + shared.length;
  console.log(`\n${total === 0 ? 'No suspect specs found.' : `${total} thing(s) to review.`}`);
}

main()
  .catch((error) => {
    console.error('Audit failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
