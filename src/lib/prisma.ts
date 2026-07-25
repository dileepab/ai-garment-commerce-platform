import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

function getRuntimeDatabaseUrl(): string | undefined {
  const databaseUrl = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;

  try {
    const url = new URL(databaseUrl);
    if (url.protocol === 'postgres:' || url.protocol === 'postgresql:') {
      if (!url.searchParams.has('connection_limit')) {
        url.searchParams.set('connection_limit', '5');
      }

      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', '30');
      }
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

const runtimeDatabaseUrl = getRuntimeDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient(runtimeDatabaseUrl
    ? {
        datasources: {
          db: {
            url: runtimeDatabaseUrl,
          },
        },
      }
    : undefined);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
