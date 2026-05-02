import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  canAccessBrand,
  canScope,
  getUserScopeFromSessionUser,
  type Permission,
  type UserScope,
} from '@/lib/access-control';

export class AuthorizationError extends Error {
  status: number;

  constructor(message = 'You do not have permission to perform this action.', status = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
  }
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}

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

export function assertBrandAccess(scope: UserScope, brand?: string | null, label = 'resource') {
  if (!canAccessBrand(scope, brand)) {
    throw new AuthorizationError(`You do not have access to this ${label}.`);
  }
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
