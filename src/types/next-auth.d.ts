import type { DefaultSession } from 'next-auth';
import type { BrandAccess, UserRole } from '@/lib/access-control';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      role: UserRole;
      brands: string[];
      brandAccess: BrandAccess;
    } & DefaultSession['user'];
  }

  interface User {
    role?: UserRole;
    brands?: string[];
    brandAccess?: BrandAccess;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: UserRole;
    brands?: string[];
    brandAccess?: BrandAccess;
  }
}
