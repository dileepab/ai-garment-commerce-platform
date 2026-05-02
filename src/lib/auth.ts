import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import {
  getDefaultHomePath,
  getPagePermissionForPathname,
  getUserScopeFromSessionUser,
  hasPermission,
  normalizeBrands,
  normalizeRole,
  resolveBrandAccess,
} from '@/lib/access-control';
import { findAuthorizedUser } from '@/lib/auth-users';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'Admin Login',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        return findAuthorizedUser(credentials?.email, credentials?.password);
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    authorized({ auth: session, request }) {
      if (!session?.user) return false;

      const url = new URL(request.url);
      if (url.pathname === '/unauthorized') return true;

      const permission = getPagePermissionForPathname(url.pathname);
      if (!permission) return true;

      const scope = getUserScopeFromSessionUser(session.user);
      if (hasPermission(scope.role, permission)) return true;

      const fallbackPath = url.pathname === '/'
        ? getDefaultHomePath(scope.role)
        : '/unauthorized';

      return Response.redirect(new URL(fallbackPath, url));
    },
    async jwt({ token, user }) {
      if (user) {
        const role = normalizeRole(user.role, 'owner');
        const brands = normalizeBrands(user.brands);

        token.role = role;
        token.brands = brands;
        token.brandAccess = resolveBrandAccess(role, brands);
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const role = normalizeRole(token.role, 'owner');
        const brands = normalizeBrands(token.brands);

        session.user.id = token.sub ?? session.user.email ?? '';
        session.user.role = role;
        session.user.brands = brands;
        session.user.brandAccess = token.brandAccess === 'limited' && brands.length > 0
          ? 'limited'
          : resolveBrandAccess(role, brands);
      }

      return session;
    },
  },
  trustHost: true,
});
