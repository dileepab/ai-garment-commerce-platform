/**
 * Every Gemini model id the platform calls.
 *
 * These were spread across seven files in six chains that had drifted out of
 * step: the same model sat first in one chain and last in another, and one
 * path still reached for gemini-2.0-flash. When Google retires an id there was
 * no single place to look, and a dead entry costs a failed call on every
 * request before the chain falls through to something that works.
 *
 * Chains are ordered deliberately — cheapest capable model first, and the
 * order carries cost decisions made per call site, so it is preserved here
 * exactly rather than unified.
 *
 * Kept free of path aliases so it can be tested.
 */

/**
 * The ids themselves, named once.
 *
 * Retiring a model means deleting it here and fixing the chains the compiler
 * then points at, rather than grepping for a version string.
 */
export const GEMINI_MODEL_IDS = {
  flash35: 'gemini-3.5-flash',
  flash31Lite: 'gemini-3.1-flash-lite',
  flash25: 'gemini-2.5-flash',
  flash25Lite: 'gemini-2.5-flash-lite',
  flash20: 'gemini-2.0-flash',
  fidelity36: 'gemini-3.6-flash',
  fidelity37: 'gemini-3.7-flash',
  imageEdit25: 'gemini-2.5-flash-image',
  imagePro3: 'gemini-3-pro-image',
  imageFlash31: 'gemini-3.1-flash-image',
} as const;

export type GeminiModelId = (typeof GEMINI_MODEL_IDS)[keyof typeof GEMINI_MODEL_IDS];

const M = GEMINI_MODEL_IDS;

/**
 * A chain with a configured id tried first, duplicates removed.
 *
 * Several call sites allow an environment override so a model can be changed
 * without a deploy; without the dedupe an override that names a model already
 * in the chain would be called twice on a failure.
 */
export function chainWithOverride(configured: string | undefined, chain: readonly string[]): string[] {
  return [configured?.trim(), ...chain].filter(
    (model, index, models): model is string => Boolean(model) && models.indexOf(model) === index
  );
}

/** Support chat replies. */
export const CHAT_MODEL_CHAIN: GeminiModelId[] = [
  M.flash31Lite,
  M.flash25Lite,
  M.flash25,
  M.flash35,
];

/** Social captions. */
export const CAPTION_MODEL_CHAIN: GeminiModelId[] = [
  M.flash35,
  M.flash31Lite,
  M.flash25,
];

/** Deciding which action a customer message asks for. */
export const ACTION_ROUTER_MODEL_CHAIN: GeminiModelId[] = [
  M.flash35,
  M.flash31Lite,
  M.flash25,
];

/** Detecting and translating the customer's language. */
export const LANGUAGE_MODEL_CHAIN: GeminiModelId[] = [
  M.flash31Lite,
  M.flash25Lite,
  M.flash25,
  M.flash35,
];

/** Answering from catalogue text rather than a template. */
export const GROUNDED_ANSWER_MODEL_CHAIN: GeminiModelId[] = [
  M.flash25,
  M.flash20,
];

/** The parallel reviewers run on a risky inbound message. */
export const REPLY_REVIEW_MODEL: GeminiModelId = M.flash31Lite;

/**
 * Image models.
 *
 * The two overridable ones stay overridable: they let a cost or quality
 * trade-off be changed in the environment without a deploy.
 */
export function imageEditModel(): string {
  return process.env.GEMINI_IMAGE_MODEL || M.imageEdit25;
}

export function highAccuracyImageModel(): string {
  return process.env.GEMINI_HIGH_ACCURACY_IMAGE_MODEL || M.imagePro3;
}

/** Text-to-image only — used when no source image is provided. */
export const TEXT_TO_IMAGE_MODEL: GeminiModelId = M.imageFlash31;

/**
 * The models that judge a generated creative against its references.
 *
 * A configured id is tried first so a validator can be changed without a
 * deploy. High Accuracy fails closed, so the chain ends on the id the rest of
 * the platform already calls in production rather than on a newer one alone.
 */
export const FIDELITY_VALIDATOR_CHAIN: GeminiModelId[] = [
  M.fidelity36,
  M.fidelity37,
  M.flash35,
];

export function fidelityValidatorModels(configuredModel?: string): string[] {
  return chainWithOverride(configuredModel, FIDELITY_VALIDATOR_CHAIN);
}
