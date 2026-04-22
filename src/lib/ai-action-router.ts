import { GoogleGenAI } from '@google/genai';
import { SizeChartCategory } from '@/lib/size-charts';
import { AiRoutedAction, RouterInput, RoutedActionType, ROUTED_ACTIONS, PRODUCT_TYPES, PRODUCT_QUESTION_TYPES, PAYMENT_METHODS, ModelError } from './ai-router/types';
import { ROUTER_JSON_SCHEMA } from './ai-router/schema';
import { buildRouterPrompt } from './ai-router/prompt';
import { buildHeuristicAction, findProductByMessage } from './ai-router/heuristics';

const MODEL_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

export type { AiRoutedAction, RoutedActionType };

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as ModelError).status;
    return typeof status === 'number' ? status : undefined;
  }

  return undefined;
}

function sanitizeJsonText(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  return trimmed;
}

function isRoutedActionType(value: string): value is RoutedActionType {
  return ROUTED_ACTIONS.includes(value as RoutedActionType);
}

function normalizeRoutedAction(value: unknown): AiRoutedAction | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Partial<AiRoutedAction>;

  if (!candidate.action || !isRoutedActionType(candidate.action)) {
    return null;
  }

  return {
    action: candidate.action,
    confidence:
      typeof candidate.confidence === 'number' && candidate.confidence >= 0
        ? Math.min(candidate.confidence, 1)
        : 0,
    orderId: typeof candidate.orderId === 'number' ? candidate.orderId : null,
    productName: typeof candidate.productName === 'string' ? candidate.productName.trim() || null : null,
    productType:
      candidate.productType && PRODUCT_TYPES.includes(candidate.productType)
        ? (candidate.productType as SizeChartCategory)
        : null,
    questionType:
      candidate.questionType && PRODUCT_QUESTION_TYPES.includes(candidate.questionType)
        ? candidate.questionType
        : null,
    quantity: typeof candidate.quantity === 'number' ? candidate.quantity : null,
    size: typeof candidate.size === 'string' ? candidate.size.trim() || null : null,
    color: typeof candidate.color === 'string' ? candidate.color.trim() || null : null,
    paymentMethod:
      candidate.paymentMethod && PAYMENT_METHODS.includes(candidate.paymentMethod)
        ? candidate.paymentMethod
        : null,
    giftWrap: typeof candidate.giftWrap === 'boolean' ? candidate.giftWrap : null,
    giftNote: typeof candidate.giftNote === 'string' ? candidate.giftNote.trim() || null : null,
    requestedDate:
      typeof candidate.requestedDate === 'string' ? candidate.requestedDate.trim() || null : null,
    deliveryLocation:
      typeof candidate.deliveryLocation === 'string'
        ? candidate.deliveryLocation.trim() || null
        : null,
    contact: {
      name:
        typeof candidate.contact?.name === 'string' ? candidate.contact.name.trim() || null : null,
      address:
        typeof candidate.contact?.address === 'string'
          ? candidate.contact.address.trim() || null
          : null,
      phone:
        typeof candidate.contact?.phone === 'string'
          ? candidate.contact.phone.trim() || null
          : null,
    },
  };
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[AI Router] Failed to fetch image: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer).toString('base64');
    return { data, mimeType };
  } catch (error) {
    console.error('[AI Router] Image fetch error:', error);
    return null;
  }
}

export async function routeCustomerMessageWithAi(
  input: RouterInput
): Promise<AiRoutedAction | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const shouldUseHeuristicFallback = process.env.CHAT_TEST_MODE === '1' || !apiKey;
  const heuristicProduct = findProductByMessage(
    input.products,
    input.currentMessage,
    input.recentMessages
  );

  if (shouldUseHeuristicFallback) {
    return buildHeuristicAction(input, heuristicProduct);
  }

  const ai = new GoogleGenAI({ apiKey });
  const promptText = buildRouterPrompt(input);

  // Build multi-modal content: image (if available) + text prompt
  type ContentPart = { text: string } | { inlineData: { data: string; mimeType: string } };
  const contentParts: ContentPart[] = [];

  if (input.imageUrl) {
    const imageData = await fetchImageAsBase64(input.imageUrl);

    if (imageData) {
      contentParts.push({
        inlineData: {
          data: imageData.data,
          mimeType: imageData.mimeType,
        },
      });
    }
  }

  contentParts.push({ text: promptText });

  for (let index = 0; index < MODEL_CHAIN.length; index += 1) {
    const model = MODEL_CHAIN[index];

    try {
      const response = await ai.models.generateContent({
        model,
        contents: contentParts,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: ROUTER_JSON_SCHEMA,
        },
      });

      const rawText = response.text;

      if (!rawText) {
        continue;
      }

      const parsed = JSON.parse(sanitizeJsonText(rawText));
      const normalized = normalizeRoutedAction(parsed);

      if (normalized) {
        return normalized;
      }
    } catch (error: unknown) {
      const status = getErrorStatus(error);

      if ((status === 429 || status === 503 || status === 404) && index < MODEL_CHAIN.length - 1) {
        continue;
      }

      console.error('[AI Router] Failed to route message:', error);
      return buildHeuristicAction(input, heuristicProduct);
    }
  }

  return buildHeuristicAction(input, heuristicProduct);
}
