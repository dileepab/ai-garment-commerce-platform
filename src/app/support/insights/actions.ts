'use server';

import { revalidatePath } from 'next/cache';
import { requireActionPermission } from '@/lib/authz';
import { logAdminAudit } from '@/lib/admin-audit';

function readText(formData: FormData, key: string, maxLength: number): string {
  const value = formData.get(key);
  return String(typeof value === 'string' ? value : '')
    .trim()
    .slice(0, maxLength);
}

export async function saveBotRegressionDraftAction(formData: FormData) {
  const scope = await requireActionPermission('support:reply');
  const senderId = readText(formData, 'senderId', 160);
  const channel = readText(formData, 'channel', 40) || 'messenger';
  const brand = readText(formData, 'brand', 80) || null;
  const customerName = readText(formData, 'customerName', 160) || null;
  const issueLabels = readText(formData, 'issueLabels', 400);
  const recommendation = readText(formData, 'recommendation', 800);
  const snippet = readText(formData, 'snippet', 6000);

  if (!senderId || !snippet) return;

  await logAdminAudit({
    action: 'bot_regression_draft_saved',
    entityType: 'bot_regression_test',
    entityId: `${channel}:${senderId}`,
    brand,
    actorEmail: scope.email ?? null,
    summary: `Saved bot regression draft for ${customerName || senderId}.`,
    metadata: {
      senderId,
      channel,
      customerName,
      issueLabels: issueLabels.split(',').map((label) => label.trim()).filter(Boolean),
      recommendation,
      snippet,
    },
  });

  revalidatePath('/support/insights');
  revalidatePath('/settings/readiness');
}
