import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URL = 'https://slpost.gov.lk/postcode_new/';
const response = await fetch(SOURCE_URL);

if (!response.ok) {
  throw new Error(`Sri Lanka Post lookup request failed: ${response.status}`);
}

const html = await response.text();
const entries = new Map();

for (const match of html.matchAll(/<option value="(\d{5})">\s*([^<]+?)\s*<\/option>/g)) {
  const [, postcode, label] = match;
  if (label.trim() === postcode) continue;

  const city = label
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (city && !entries.has(city)) entries.set(city, postcode);
}

const output = Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
const target = path.join(process.cwd(), 'src/data/sri-lanka-postcodes.json');
await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${entries.size} official postcode entries to ${target}`);
