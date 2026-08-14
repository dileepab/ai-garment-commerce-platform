/**
 * Calls Gemini to answer a product question from the product's own record.
 *
 * Kept apart from `grounded-answer.ts` so the prompt and the fact check stay
 * testable without a network. This file is the part that can fail: no key, a
 * rate limit, a model that invents a price. Every one of those failures returns
 * null, and the caller sends the template answer instead. The template is
 * wordier than we want, but it cannot be wrong, so it is the right thing to
 * fall back to.
 */
import { GoogleGenAI } from '@google/genai';
import { logDebug, logError, logWarn } from '@/lib/app-log';
import {
  buildGroundedAnswerPrompt,
  buildProductFactSheet,
  findUngroundedClaims,
  type GroundedProductFacts,
} from '@/lib/chat/grounded-answer';

const TEXT_MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash'];

/** Off unless switched on, so the template path stays the default. */
export function groundedAnswersEnabled(): boolean {
  return process.env.CHAT_GROUNDED_PRODUCT_ANSWERS === '1';
}

export async function generateGroundedProductAnswer(params: {
  facts: GroundedProductFacts;
  question: string;
  language: string;
  scriptStyle: string;
  brand?: string | null;
  recentTurns?: Array<{ role: 'user' | 'assistant'; message: string }>;
}): Promise<string | null> {
  if (!groundedAnswersEnabled()) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  // CHAT_TEST_MODE must stay deterministic; the regression suite asserts text.
  if (!apiKey || process.env.CHAT_TEST_MODE === '1') return null;

  const factSheet = buildProductFactSheet(params.facts);
  const prompt = buildGroundedAnswerPrompt({
    factSheet,
    question: params.question,
    language: params.language,
    scriptStyle: params.scriptStyle,
    brand: params.brand,
    recentTurns: params.recentTurns,
  });

  const ai = new GoogleGenAI({ apiKey });

  for (let index = 0; index < TEXT_MODEL_CHAIN.length; index += 1) {
    const model = TEXT_MODEL_CHAIN[index];

    try {
      // Low temperature: this is a factual answer, not copywriting.
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: prompt }],
        config: { temperature: 0.3 },
      });
      const reply = response.text?.trim();

      if (!reply) continue;

      const problems = findUngroundedClaims({
        reply,
        factSheet,
        sizes: params.facts.sizes,
      });

      if (problems.length > 0) {
        logWarn('Grounded Answer', 'Discarded a reply that was not supported by the record.', {
          product: params.facts.name,
          problems,
          reply,
        });
        return null;
      }

      logDebug('Grounded Answer', 'Answered from the product record.', {
        model,
        product: params.facts.name,
      });
      return reply;
    } catch (error) {
      const status = (error as { status?: number })?.status;

      if (
        (status === 429 || status === 503 || status === 404) &&
        index < TEXT_MODEL_CHAIN.length - 1
      ) {
        logWarn('Grounded Answer', `Model ${model} unavailable; trying the next one.`, { status });
        continue;
      }

      logError('Grounded Answer', 'Generation failed; falling back to the built reply.', error);
      break;
    }
  }

  return null;
}
