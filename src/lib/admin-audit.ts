import prisma from '@/lib/prisma';
import { logWarn } from '@/lib/app-log';

interface AdminAuditInput {
  action: string;
  summary: string;
  entityType?: string | null;
  entityId?: string | number | null;
  brand?: string | null;
  actorEmail?: string | null;
  metadata?: unknown;
}

function serializeMetadata(metadata: unknown): string | null {
  if (metadata === undefined || metadata === null) return null;

  try {
    return JSON.stringify(metadata);
  } catch {
    return JSON.stringify({ value: String(metadata) });
  }
}

export async function logAdminAudit(input: AdminAuditInput): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        action: input.action,
        summary: input.summary.slice(0, 500),
        entityType: input.entityType ?? null,
        entityId:
          input.entityId === undefined || input.entityId === null
            ? null
            : String(input.entityId),
        brand: input.brand ?? null,
        actorEmail: input.actorEmail ?? null,
        metadata: serializeMetadata(input.metadata),
      },
    });
  } catch (error) {
    logWarn('Admin Audit', 'Failed to write admin audit log.', {
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      error,
    });
  }
}
