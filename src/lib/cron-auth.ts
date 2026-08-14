/**
 * Guards the cron endpoints.
 *
 * These routes send messages to customers. Left open, anyone who knows the path
 * can make the shop message people — which costs money, annoys customers, and is
 * the kind of thing Meta restricts a number for. The comment-replies route was
 * already checking the secret; cart-recovery and human-timeout were not, and
 * they were about to be put on a schedule.
 *
 * Outside production a missing secret is allowed so local runs work. In
 * production a missing secret fails closed: no secret, no sending.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return process.env.NODE_ENV !== 'production';
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}
