'use server';

import { revalidatePath } from 'next/cache';
import { assertBrandAccess, isAuthorizationError, requireActionPermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  createReturnRequest,
  transitionReturnRequest,
  ReturnRequestError,
} from '@/lib/returns-service';
import { isReturnRequestStatus, isReturnRequestType } from '@/lib/returns';

export interface ReturnActionResult {
  success: boolean;
  error?: string;
  returnRequestId?: number;
}

function toResult(error: unknown): ReturnActionResult {
  if (isAuthorizationError(error)) {
    return {
      success: false,
      error: isAuthorizationError(error)
        ? error.message
        : 'You do not have permission to perform this action.',
    };
  }
  if (error instanceof ReturnRequestError) {
    return { success: false, error: error.message };
  }
  return { success: false, error: 'Operation failed. Please retry.' };
}

async function assertReturnAccess(returnRequestId: number, scope: Awaited<ReturnType<typeof requireActionPermission>>) {
  const rr = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    select: { id: true, brand: true, status: true },
  });
  if (!rr) {
    throw new ReturnRequestError(`Return request #${returnRequestId} was not found.`, 404);
  }
  assertBrandAccess(scope, rr.brand, 'return request');
  return rr;
}

export async function createReturnRequestAction(
  orderId: number,
  type: string,
  reason: string,
  adminNote?: string,
): Promise<ReturnActionResult> {
  try {
    const scope = await requireActionPermission('returns:manage');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { brand: true },
    });
    assertBrandAccess(scope, order?.brand, 'order');

    if (!isReturnRequestType(type)) {
      return { success: false, error: 'Type must be "return" or "exchange".' };
    }
    if (!reason.trim()) {
      return { success: false, error: 'Please provide a reason for this request.' };
    }

    const created = await createReturnRequest({
      orderId,
      type,
      reason,
      requestedBy: 'admin',
      adminNote: adminNote || null,
    });

    revalidatePath('/returns');
    revalidatePath('/orders');
    return { success: true, returnRequestId: created.id };
  } catch (error) {
    return toResult(error);
  }
}

export async function updateReturnStatusAction(
  returnRequestId: number,
  toStatus: string,
  adminNote?: string,
): Promise<ReturnActionResult> {
  try {
    const scope = await requireActionPermission('returns:manage');
    await assertReturnAccess(returnRequestId, scope);

    if (!isReturnRequestStatus(toStatus)) {
      return { success: false, error: `"${toStatus}" is not a valid return status.` };
    }

    await transitionReturnRequest({
      returnRequestId,
      toStatus,
      adminNote: adminNote || null,
      actor: { email: scope.email, name: scope.name },
    });

    revalidatePath('/returns');
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function markItemReceivedAction(
  returnRequestId: number,
  adminNote?: string,
): Promise<ReturnActionResult> {
  try {
    const scope = await requireActionPermission('returns:manage');
    await assertReturnAccess(returnRequestId, scope);

    await transitionReturnRequest({
      returnRequestId,
      toStatus: 'item_received',
      adminNote: adminNote || null,
      actor: { email: scope.email, name: scope.name },
    });

    revalidatePath('/returns');
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function linkReplacementOrderAction(
  returnRequestId: number,
  replacementOrderId: number,
): Promise<ReturnActionResult> {
  try {
    const scope = await requireActionPermission('returns:manage');
    const rr = await assertReturnAccess(returnRequestId, scope);

    if (rr.status !== 'item_received' && rr.status !== 'replacement_processing') {
      return {
        success: false,
        error: 'Replacement orders can only be linked when the request is in item_received or replacement_processing status.',
      };
    }

    const replacementOrder = await prisma.order.findUnique({
      where: { id: replacementOrderId },
      select: { id: true, brand: true },
    });
    if (!replacementOrder) {
      return { success: false, error: `Order #${replacementOrderId} was not found.` };
    }
    assertBrandAccess(scope, replacementOrder.brand, 'replacement order');

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { replacementOrderId },
    });

    revalidatePath('/returns');
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function completeReturnRequestAction(
  returnRequestId: number,
  adminNote?: string,
): Promise<ReturnActionResult> {
  try {
    const scope = await requireActionPermission('returns:manage');
    await assertReturnAccess(returnRequestId, scope);

    await transitionReturnRequest({
      returnRequestId,
      toStatus: 'completed',
      adminNote: adminNote || null,
      actor: { email: scope.email, name: scope.name },
    });

    revalidatePath('/returns');
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}
