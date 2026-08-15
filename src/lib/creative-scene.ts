/**
 * Everything in a generated photograph that is not the product: the companion
 * garment and the location.
 *
 * Each view angle is its own Gemini call, and the prompt asked only for "a
 * simple, neutral matching top" in "an aspirational outdoor location". Two
 * calls answered that differently — the front of the brown skort came back in
 * a short-sleeve ribbed knit on a cobbled street, the back in a long-sleeve
 * sweater in a forest. A three-angle set looked like three different shoots.
 *
 * Deriving both from a stable key makes every angle agree without threading a
 * decision through the batch caller: the same product resolves to the same
 * outfit and the same place, in any order, on a retry, or months later when
 * one tile is regenerated on its own.
 *
 * The companion descriptions name a sleeve length on purpose. "A simple top"
 * is what produced a short sleeve and a long sleeve in the same set.
 *
 * Kept free of path aliases so it can be tested.
 */

export type HeroGarmentKind = 'top' | 'bottom' | 'onepiece';

export interface SceneChoice {
  /** The companion garment, or null when the hero garment dresses the body alone. */
  companion: string | null;
  setting: string;
}

/**
 * Tops offered when the hero garment is a bottom. Each one fixes a colour, a
 * fabric and a sleeve length, because those are exactly the three things that
 * drifted between angles.
 */
const COMPANION_TOPS = [
  'a plain cream ribbed knit top with SHORT sleeves ending mid-upper-arm, tucked in loosely',
  'a plain white cotton t-shirt with SHORT sleeves, tucked in loosely',
  'a plain black fitted top with SHORT sleeves ending mid-upper-arm',
  'a plain oatmeal ribbed knit top with SHORT sleeves, tucked in loosely',
  'a plain soft-grey cotton top with SHORT sleeves ending mid-upper-arm',
];

/** Bottoms offered when the hero garment is a top. */
const COMPANION_BOTTOMS = [
  'plain straight-leg indigo denim jeans, full length',
  'plain black tailored trousers, full length',
  'a plain ivory A-line midi skirt',
  'plain beige wide-leg trousers, full length',
];

/**
 * Locations, each naming its own light.
 *
 * Golden hour used to be hard-coded in the photography block, two lines below
 * an instruction saying light must never shift the garment's colour family. It
 * warmed a cool grey-brown check into golden brown. Half of these are neutral
 * daylight so that pull is not applied to every product ever generated.
 */
const SETTINGS = [
  'a sunlit cobbled street beside old stone buildings, warm late-afternoon light',
  'a quiet tree-lined park path, soft even daylight through the canopy',
  'a clean pale-plaster courtyard wall, bright neutral overcast daylight',
  'a wide coastal promenade with the sea out of focus behind, clear midday light',
  'a shaded garden terrace with greenery behind, soft neutral daylight',
];

/**
 * FNV-1a. Small, dependency-free, and stable across processes — a Math.random
 * or a Date would defeat the whole point.
 */
export function stableHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Which half of the outfit the product itself provides. */
export function classifyHeroGarment(text: string): HeroGarmentKind {
  const t = text.toLowerCase();

  // Checked first: a "jumpsuit" and a "shirt dress" both dress the whole body,
  // and a dress must never have trousers added under it.
  //
  // The prefix list is not decoration. `\bdress\b` does not match "sundress" —
  // the boundary needs a non-word character before the d — so Happybuy's entire
  // dress catalog classified as tops and was rendered with jeans underneath.
  // Written this way "address" still fails to match, which a bare /dress\b/
  // would not.
  const ONE_PIECE =
    /\b(?:sun|shirt|maxi|midi|mini|slip|wrap|tea|shift|smock|sheath)?dress(?:es)?\b|\b(?:gown|jumpsuit|romper|playsuit|one-?piece|overall|kaftan|caftan)\b/;
  if (ONE_PIECE.test(t)) {
    return 'onepiece';
  }
  if (/\b(skort|skirt|pants|trousers|shorts|jeans|leggings|culottes)\b/.test(t)) {
    return 'bottom';
  }
  return 'top';
}

/**
 * The companion garment and location for one product.
 *
 * `key` must identify the product, not the angle — that is what makes front,
 * side and back agree.
 */
export function resolveScene(key: string, heroText: string): SceneChoice {
  const kind = classifyHeroGarment(heroText);
  const hash = stableHash(key);

  const setting = SETTINGS[hash % SETTINGS.length];

  if (kind === 'onepiece') {
    return { companion: null, setting };
  }

  // A second, offset draw so the outfit and the location vary independently
  // rather than moving together in lockstep across the catalog.
  const pool = kind === 'bottom' ? COMPANION_TOPS : COMPANION_BOTTOMS;
  const companion = pool[Math.floor(hash / SETTINGS.length) % pool.length];

  return { companion, setting };
}

/** The prompt block, so the caller never has to phrase this itself. */
export function sceneClause(scene: SceneChoice): string {
  const outfit = scene.companion
    ? `- Companion clothing: ${scene.companion}. Render exactly this — same colour, same fabric, same sleeve length — so every angle of this product shows one outfit.\n` +
      `- Add nothing else: no jacket, cardigan, scarf, belt, or bag.\n`
    : `- The hero garment dresses the body on its own. Do NOT add any other clothing.\n`;

  return (
    `OUTFIT AND LOCATION — IDENTICAL ACROSS EVERY ANGLE OF THIS PRODUCT:\n` +
    outfit +
    `- Setting: ${scene.setting}. Keep this location and this light for every angle.\n`
  );
}
