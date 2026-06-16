import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  AuthorizationError,
  assertBrandAccess,
  canScope,
  getUserScopeFromSessionUser,
  isAuthorizationError,
  type Permission,
  type UserScope,
} from '@/lib/access-control';

// Re-exported from access-control so existing `@/lib/authz` importers keep working
// while the pure (Next-free) implementations live alongside the other scope helpers.
export { AuthorizationError, isAuthorizationError, assertBrandAccess };

export async function getCurrentUserScope(): Promise<UserScope | null> {
  const session = await auth();
  if (!session?.user) return null;
  return getUserScopeFromSessionUser(session.user);
}

export async function requirePagePermission(permission: Permission): Promise<UserScope> {
  const scope = await getCurrentUserScope();

  if (!scope) {
    redirect('/login');
  }

  if (!canScope(scope, permission)) {
    redirect('/unauthorized');
  }

  return scope;
}

export async function requireActionPermission(permission: Permission): Promise<UserScope> {
  const scope = await getCurrentUserScope();

  if (!scope) {
    throw new AuthorizationError('Please sign in to continue.', 401);
  }

  if (!canScope(scope, permission)) {
    throw new AuthorizationError();
  }

  return scope;
}

export async function requireApiPermission(permission: Permission): Promise<UserScope> {
  return requireActionPermission(permission);
}

export function accessDeniedResponse(error: unknown) {
  const status = isAuthorizationError(error) ? error.status : 403;
  const message = isAuthorizationError(error)
    ? error.message
    : 'You do not have permission to perform this action.';

  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

export function accessDeniedResult(error: unknown) {
  return {
    success: false,
    error: isAuthorizationError(error)
      ? error.message
      : 'You do not have permission to perform this action.',
  };
}
