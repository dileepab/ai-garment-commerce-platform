/**
 * Removes catalogue colour names from text sent to an image model.
 *
 * A colour name is a strong, specific token. "Pastel Pink" told the model to
 * make something pale, cool and desaturated, and three mentions of it — in
 * the product name, the colour list, and the selected variant — beat a single
 * photograph of a garment that is actually watermelon. Telling the model to
 * ignore those words still leaves them in the prompt; taking them out removes
 * the conflict instead of asking the model to resolve it.
 *
 * Only the catalogue's own colour names are removed, never colour words in
 * general: "red floral print on the left front panel" is construction detail
 * the model needs, and a blanket colour-word filter would destroy it.
 *
 * Kept free of path aliases so it can be tested.
 */

/** What replaces the name, so the sentence still reads as being about a colourway. */
const PLACEHOLDER = 'the colour shown in the reference photograph';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactColourNames(text: string, colourNames: string[]): string {
  const names = colourNames
    .map(name => name.trim())
    .filter(name => name.length >= 3)
    // Longest first, so "Cream Red Floral" is removed whole rather than being
    // half-eaten by a shorter "Red" that shares its opening.
    .sort((left, right) => right.length - left.length);

  let result = text;
  for (const name of names) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), PLACEHOLDER);
  }

  // The list form ("Colors: X, Y") collapses into repeats of the placeholder.
  const repeated = new RegExp(`${escapeRegExp(PLACEHOLDER)}(\\s*,\\s*${escapeRegExp(PLACEHOLDER)})+`, 'gi');
  return result.replace(repeated, PLACEHOLDER);
}
