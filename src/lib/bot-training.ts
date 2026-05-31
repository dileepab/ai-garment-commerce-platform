import type { BotTrainingRule } from '@prisma/client';
import prisma from '@/lib/prisma';
import { detectCustomerLanguage, type CustomerLanguage } from '@/lib/chat/language';

export const BOT_TRAINING_MATCH_TYPES = ['contains', 'exact', 'keywords'] as const;
export const BOT_TRAINING_INTENTS = [
  'catalog_request',
  'product_details',
  'price_question',
  'cod_question',
  'delivery_eta',
  'store_location',
  'branch_question',
  'size_exchange',
  'refund_or_damage',
  'tracking_request',
  'support_contact',
  'greeting',
  'other',
] as const;

export type BotTrainingMatchType = (typeof BOT_TRAINING_MATCH_TYPES)[number];
export type BotTrainingIntent = (typeof BOT_TRAINING_INTENTS)[number];

export interface TrainingQuestionSignal {
  text: string;
  language: CustomerLanguage | 'unknown';
  channel: string;
  count: number;
  lastSeenAt: Date;
}

export interface MatchedBotTrainingRule {
  id: number;
  intent: string;
  brand: string | null;
  language: string | null;
  response: string;
}

const LOW_SIGNAL_RE =
  /^(hi|hello|hey|ok|okay|thanks|thank you|yes|no|fine|noted|හායි|හලෝ|ඔව්|නැහැ|ස්තුතියි|வணக்கம்|சரி|நன்றி|ஆம்|இல்லை)$/i;

export function normalizeTrainingText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeQuestionText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function isLowSignalQuestion(value: string): boolean {
  const normalized = normalizeTrainingText(value);
  return normalized.length < 5 || LOW_SIGNAL_RE.test(normalized);
}

function parseKeywords(pattern: string): string[] {
  return pattern
    .split(/[\n,]+/)
    .map((keyword) => normalizeTrainingText(keyword))
    .filter(Boolean);
}

function isSupportedMatchType(value: string): value is BotTrainingMatchType {
  return BOT_TRAINING_MATCH_TYPES.includes(value as BotTrainingMatchType);
}

export function normalizeBotTrainingMatchType(value: string): BotTrainingMatchType {
  return isSupportedMatchType(value) ? value : 'contains';
}

export function matchesBotTrainingRule(rule: Pick<BotTrainingRule, 'matchType' | 'pattern'>, message: string): boolean {
  const matchType = normalizeBotTrainingMatchType(rule.matchType);
  const normalizedMessage = normalizeTrainingText(message);
  const normalizedPattern = normalizeTrainingText(rule.pattern);

  if (!normalizedMessage || !normalizedPattern) return false;
  if (matchType === 'exact') return normalizedMessage === normalizedPattern;
  if (matchType === 'keywords') {
    const keywords = parseKeywords(rule.pattern);
    return keywords.length > 0 && keywords.every((keyword) => normalizedMessage.includes(keyword));
  }

  return normalizedMessage.includes(normalizedPattern);
}

export async function findMatchingBotTrainingRule(params: {
  brand?: string | null;
  language: CustomerLanguage;
  message: string;
}): Promise<MatchedBotTrainingRule | null> {
  const rules = await prisma.botTrainingRule.findMany({
    where: {
      enabled: true,
      AND: [
        {
          OR: [
            { brand: null },
            ...(params.brand ? [{ brand: params.brand }] : []),
          ],
        },
        {
          OR: [
            { language: null },
            { language: params.language },
          ],
        },
      ],
    },
    orderBy: [
      { priority: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: 200,
  });

  const match = rules.find((rule) => matchesBotTrainingRule(rule, params.message));
  if (!match) return null;

  return {
    id: match.id,
    intent: match.intent,
    brand: match.brand,
    language: match.language,
    response: match.response,
  };
}

export async function recordBotTrainingRuleMatch(ruleId: number) {
  await prisma.botTrainingRule.update({
    where: { id: ruleId },
    data: {
      hitCount: { increment: 1 },
      lastMatchedAt: new Date(),
    },
  });
}

export function summarizeTrainingQuestionSignals(
  messages: Array<{
    message: string;
    channel: string;
    createdAt: Date;
  }>,
  limit = 20
): TrainingQuestionSignal[] {
  const questionCounts = new Map<string, TrainingQuestionSignal>();

  for (const message of messages) {
    const text = normalizeQuestionText(message.message);
    if (isLowSignalQuestion(text)) continue;

    const language = detectCustomerLanguage(text) || 'unknown';
    const key = `${message.channel}|${language}|${normalizeTrainingText(text)}`;
    const current = questionCounts.get(key) ?? {
      text,
      language,
      channel: message.channel,
      count: 0,
      lastSeenAt: message.createdAt,
    };

    current.count += 1;
    if (message.createdAt > current.lastSeenAt) {
      current.lastSeenAt = message.createdAt;
    }
    questionCounts.set(key, current);
  }

  return Array.from(questionCounts.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, limit);
}
