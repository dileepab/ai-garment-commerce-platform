import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import { resolvePublishedPostUrl } from '@/lib/meta-publish';

function isAllowedMetaPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hostname === 'facebook.com'
      || hostname.endsWith('.facebook.com')
      || hostname === 'instagram.com'
      || hostname.endsWith('.instagram.com');
    return url.protocol === 'https:' && allowedHost;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('content:view');
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand')?.trim();
    const channel = searchParams.get('channel')?.trim();
    const postId = searchParams.get('postId')?.trim();

    if (!brand || !postId || (channel !== 'facebook' && channel !== 'instagram')) {
      return NextResponse.json({ success: false, error: 'Invalid published post link.' }, { status: 400 });
    }

    assertBrandAccess(scope, brand, 'published post');
    const destination = await resolvePublishedPostUrl(brand, channel, postId);

    if (!destination || !isAllowedMetaPostUrl(destination)) {
      return NextResponse.json({ success: false, error: 'Meta did not return a valid live post URL.' }, { status: 404 });
    }

    return NextResponse.redirect(destination, 307);
  } catch (error) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: 'Could not open the live post.' }, { status: 500 });
  }
}
