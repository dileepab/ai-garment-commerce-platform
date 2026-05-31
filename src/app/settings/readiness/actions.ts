'use server';

import { revalidatePath } from 'next/cache';
import { CLEAN_LAUNCH_CONFIRMATION, runCleanLaunchReset } from '@/lib/launch-readiness';
import { logAdminAudit } from '@/lib/admin-audit';
import { requireActionPermission } from '@/lib/authz';

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function cleanLaunchResetAction(formData: FormData) {
  const scope = await requireActionPermission('settings:write');
  const confirmation = readText(formData, 'confirmation');
  const includeCatalog = formData.get('includeCatalog') === 'on';

  if (confirmation !== CLEAN_LAUNCH_CONFIRMATION) {
    await logAdminAudit({
      action: 'clean_launch_reset_rejected',
      entityType: 'launch_readiness',
      entityId: includeCatalog ? 'with_catalog' : 'preserve_catalog',
      actorEmail: scope.email ?? null,
      summary: 'Clean launch reset was rejected because the confirmation phrase did not match.',
      metadata: {
        includeCatalog,
        expectedConfirmation: CLEAN_LAUNCH_CONFIRMATION,
      },
    });
    revalidatePath('/settings/readiness');
    return;
  }

  await runCleanLaunchReset({
    includeCatalog,
    actorEmail: scope.email ?? null,
  });

  revalidatePath('/settings/readiness');
  revalidatePath('/support');
  revalidatePath('/support/insights');
  revalidatePath('/orders');
  revalidatePath('/products');
  revalidatePath('/analytics');
}
