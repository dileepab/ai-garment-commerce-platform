'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  BOT_TRAINING_INTENTS,
  BOT_TRAINING_MATCH_TYPES,
  normalizeBotTrainingMatchType,
} from '@/lib/bot-training';
import { logAdminAudit } from '@/lib/admin-audit';
import { getBrandScopeValues } from '@/lib/access-control';
import {
  AuthorizationError,
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import prisma from '@/lib/prisma';

const SUPPORTED_LANGUAGES = ['english', 'sinhala', 'tamil'] as const;

function cleanText(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanLongText(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function normalizeOptionalBrand(value: FormDataEntryValue | null): string | null {
  const brand = cleanText(value, 80);
  return brand || null;
}

function normalizeOptionalLanguage(value: FormDataEntryValue | null): string | null {
  const language = cleanText(value, 20).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(language as (typeof SUPPORTED_LANGUAGES)[number])
    ? language
    : null;
}

function normalizeIntent(value: FormDataEntryValue | null): string {
  const intent = cleanText(value, 80).toLowerCase();
  return BOT_TRAINING_INTENTS.includes(intent as (typeof BOT_TRAINING_INTENTS)[number])
    ? intent
    : 'other';
}

function normalizePriority(value: FormDataEntryValue | null): number {
  const parsed = Number.parseInt(String(value || '50'), 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, parsed));
}

function normalizeRedirectPath(value: FormDataEntryValue | null): string {
  const path = String(value || '/support/training');
  return path.startsWith('/support/training') ? path : '/support/training';
}

async function ensureWritableBrand(brand: string | null) {
  const scope = await requireActionPermission('support:reply');
  const brandScope = getBrandScopeValues(scope);

  if (!brand && brandScope) {
    throw new AuthorizationError('Limited brand users must choose a brand for training rules.');
  }

  if (brand) {
    assertBrandAccess(scope, brand, 'training rule');
  }

  return scope;
}

export async function saveBotTrainingRuleAction(formData: FormData) {
  try {
    const brand = normalizeOptionalBrand(formData.get('brand'));
    const scope = await ensureWritableBrand(brand);
    const ruleId = Number.parseInt(String(formData.get('ruleId') || ''), 10);
    const intent = normalizeIntent(formData.get('intent'));
    const language = normalizeOptionalLanguage(formData.get('language'));
    const matchType = normalizeBotTrainingMatchType(cleanText(formData.get('matchType'), 30));
    const pattern = cleanLongText(formData.get('pattern'), 600);
    const response = cleanLongText(formData.get('response'), 2000);
    const priority = normalizePriority(formData.get('priority'));
    const notes = cleanLongText(formData.get('notes'), 600) || null;
    const enabled = formData.get('enabled') === 'on';
    const redirectTo = normalizeRedirectPath(formData.get('redirectTo'));

    if (!BOT_TRAINING_MATCH_TYPES.includes(matchType) || !pattern || !response) {
      return;
    }

    if (Number.isInteger(ruleId)) {
      const existing = await prisma.botTrainingRule.findUnique({ where: { id: ruleId } });
      if (!existing) return;
      await ensureWritableBrand(existing.brand);

      await prisma.botTrainingRule.update({
        where: { id: ruleId },
        data: {
          brand,
          intent,
          language,
          matchType,
          pattern,
          response,
          priority,
          enabled,
          notes,
        },
      });

      await logAdminAudit({
        action: 'bot_training_rule_updated',
        entityType: 'bot_training_rule',
        entityId: ruleId,
        brand,
        actorEmail: scope.email ?? null,
        summary: `Updated bot training rule #${ruleId} for ${intent}.`,
        metadata: { intent, language, matchType, pattern },
      });
    } else {
      const created = await prisma.botTrainingRule.create({
        data: {
          brand,
          intent,
          language,
          matchType,
          pattern,
          response,
          priority,
          enabled,
          notes,
          createdBy: scope.email ?? null,
        },
      });

      await logAdminAudit({
        action: 'bot_training_rule_created',
        entityType: 'bot_training_rule',
        entityId: created.id,
        brand,
        actorEmail: scope.email ?? null,
        summary: `Created bot training rule #${created.id} for ${intent}.`,
        metadata: { intent, language, matchType, pattern },
      });
    }

    revalidatePath('/support/training');
    redirect(redirectTo);
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }
}

export async function toggleBotTrainingRuleAction(formData: FormData) {
  try {
    const scope = await requireActionPermission('support:reply');
    const ruleId = Number.parseInt(String(formData.get('ruleId') || ''), 10);
    if (!Number.isInteger(ruleId)) return;

    const rule = await prisma.botTrainingRule.findUnique({ where: { id: ruleId } });
    if (!rule) return;
    await ensureWritableBrand(rule.brand);

    const nextEnabled = !rule.enabled;
    await prisma.botTrainingRule.update({
      where: { id: ruleId },
      data: { enabled: nextEnabled },
    });

    await logAdminAudit({
      action: 'bot_training_rule_toggled',
      entityType: 'bot_training_rule',
      entityId: ruleId,
      brand: rule.brand,
      actorEmail: scope.email ?? null,
      summary: `${nextEnabled ? 'Enabled' : 'Disabled'} bot training rule #${ruleId}.`,
      metadata: { previousEnabled: rule.enabled, nextEnabled },
    });

    revalidatePath('/support/training');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }
}

export async function deleteBotTrainingRuleAction(formData: FormData) {
  try {
    const scope = await requireActionPermission('support:reply');
    const ruleId = Number.parseInt(String(formData.get('ruleId') || ''), 10);
    if (!Number.isInteger(ruleId)) return;

    const rule = await prisma.botTrainingRule.findUnique({ where: { id: ruleId } });
    if (!rule) return;
    await ensureWritableBrand(rule.brand);

    await prisma.botTrainingRule.delete({ where: { id: ruleId } });

    await logAdminAudit({
      action: 'bot_training_rule_deleted',
      entityType: 'bot_training_rule',
      entityId: ruleId,
      brand: rule.brand,
      actorEmail: scope.email ?? null,
      summary: `Deleted bot training rule #${ruleId}.`,
      metadata: { intent: rule.intent, language: rule.language, pattern: rule.pattern },
    });

    revalidatePath('/support/training');
  } catch (error) {
    if (isAuthorizationError(error)) return;
    throw error;
  }
}
