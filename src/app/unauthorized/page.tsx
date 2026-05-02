import Link from 'next/link';
import { getCurrentUserScope } from '@/lib/authz';
import { describeScope, getDefaultHomePath, ROLE_LABELS } from '@/lib/access-control';

export const dynamic = 'force-dynamic';

export default async function UnauthorizedPage() {
  const scope = await getCurrentUserScope();
  const homePath = scope ? getDefaultHomePath(scope.role) : '/login';

  return (
    <main className="app-shell">
      <div className="app-container">
        <section className="app-panel px-6 py-12 text-center">
          <p className="app-kicker">Access denied</p>
          <h1 className="app-title">This area is not available for your role.</h1>
          <p className="app-subtitle mx-auto mt-3 max-w-xl">
            {scope
              ? `${ROLE_LABELS[scope.role]} access is currently scoped to ${describeScope(scope)}.`
              : 'Please sign in with an account that has access to this area.'}
          </p>
          <div className="mt-6 flex justify-center">
            <Link href={homePath} className="app-button-primary">
              Go to your workspace
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
