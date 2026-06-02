export { auth as proxy } from '@/lib/auth';

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - api/auth (NextAuth session/signin flows)
     * - api/webhooks (Meta Messenger/Instagram webhooks)
     * - api/storefront (public storefront catalog)
     * - api/content/creatives/.../image (public image URLs for Meta publishing/replies)
     * - api/cron (background CRON jobs)
     * - size-charts (public size chart images for chat/storefront)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - login page
     */
    '/((?!api/auth|api/webhooks|api/storefront|api/content/creatives/[^/]+/image|api/cron|size-charts|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|login).*)',
  ],
};
