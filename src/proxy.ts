export { auth as proxy } from '@/lib/auth';

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - api/auth (NextAuth session/signin flows)
     * - api/webhooks (Meta Messenger/Instagram webhooks)
     * - api/storefront (public storefront catalog)
     * - api/catalog/meta (public scheduled Meta catalog feeds)
     * - api/content/creatives (route-level signed/session checks for Meta and
     *   TikTok images, plus TikTok's public URL-prefix verification file)
     * - api/cron (background CRON jobs)
     * - size-charts (public size chart images for chat/storefront)
     * - api/size-charts (per-product charts rendered for WhatsApp, which
     *   fetches the URL without a session)
     * - manifest.webmanifest, sw.js, icons (the installable app. A manifest
     *   link is fetched without credentials, so behind auth it resolves to a
     *   login page and the browser offers no install at all. None of the three
     *   carries anything that is not already public.)
     * - personas (model reference photos the creative generator fetches over
     *   HTTP from its own deployment; a server-side fetch carries no session
     *   cookie, so behind auth this returned a login page that was then sent
     *   to Gemini as the model reference)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - login page
     */
    '/((?!api/auth|api/webhooks|api/storefront|api/catalog/meta|api/content/creatives|api/cron|api/size-charts|size-charts|personas|manifest\\.webmanifest|sw\\.js|icons|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|login).*)',
  ],
};
