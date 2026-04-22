/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TABLES = [
  { table: 'Product', delegate: 'product', intId: true },
  { table: 'Inventory', delegate: 'inventory', intId: true },
  { table: 'Customer', delegate: 'customer', intId: true },
  { table: 'Order', delegate: 'order', intId: true },
  { table: 'OrderItem', delegate: 'orderItem', intId: true },
  { table: 'ProductionBatch', delegate: 'productionBatch', intId: true },
  { table: 'Operator', delegate: 'operator', intId: true },
  { table: 'OperatorOutput', delegate: 'operatorOutput', intId: true },
  { table: 'Fabric', delegate: 'fabric', intId: true },
  { table: 'Analytics', delegate: 'analytics', intId: true },
  { table: 'ChatMessage', delegate: 'chatMessage', intId: true },
  { table: 'ConversationState', delegate: 'conversationState', intId: true },
  { table: 'SupportEscalation', delegate: 'supportEscalation', intId: true },
  { table: 'CommentLog', delegate: 'commentLog', intId: false },
];

const DATE_FIELDS = {
  Product: ['createdAt'],
  Inventory: ['updatedAt'],
  Customer: ['createdAt'],
  Order: ['createdAt'],
  ProductionBatch: ['startDate', 'endDate', 'createdAt'],
  OperatorOutput: ['date'],
  Analytics: ['date'],
  ChatMessage: ['createdAt'],
  ConversationState: ['createdAt', 'updatedAt'],
  SupportEscalation: ['createdAt', 'updatedAt', 'resolvedAt'],
  CommentLog: ['repliedAt'],
};

const BOOLEAN_FIELDS = {
  Order: ['giftWrap'],
};

function parseArgs(argv) {
  const args = {
    force: false,
    sqlitePath: path.resolve(process.cwd(), 'prisma/dev.db'),
  };

  for (const arg of argv) {
    if (arg === '--force') {
      args.force = true;
      continue;
    }

    if (arg.startsWith('--sqlite-path=')) {
      args.sqlitePath = path.resolve(process.cwd(), arg.slice('--sqlite-path='.length));
      continue;
    }
  }

  return args;
}

function ensureSqliteCliAvailable() {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      `The sqlite3 CLI is required for this migration script. Install sqlite3 locally and rerun. ${error instanceof Error ? error.message : ''}`.trim()
    );
  }
}

function querySqlite(sqlitePath, sql) {
  const output = execFileSync('sqlite3', ['-json', sqlitePath, sql], {
    encoding: 'utf8',
  }).trim();

  if (!output) {
    return [];
  }

  return JSON.parse(output);
}

function normalizeRow(table, row) {
  const normalized = { ...row };

  for (const field of DATE_FIELDS[table] || []) {
    if (normalized[field]) {
      normalized[field] = new Date(normalized[field]);
    }
  }

  for (const field of BOOLEAN_FIELDS[table] || []) {
    if (field in normalized) {
      normalized[field] = Boolean(normalized[field]);
    }
  }

  return normalized;
}

async function getTargetCounts() {
  const counts = {};

  for (const config of TABLES) {
    counts[config.table] = await prisma[config.delegate].count();
  }

  return counts;
}

function hasTargetData(counts) {
  return Object.values(counts).some((count) => count > 0);
}

async function clearTargetDatabase(tx) {
  for (const config of [...TABLES].reverse()) {
    await tx[config.delegate].deleteMany();
  }
}

async function resetPostgresSequences(tx) {
  for (const config of TABLES) {
    if (!config.intId) {
      continue;
    }

    await tx.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('"${config.table}"', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM "${config.table}"), 0), 1),
        EXISTS(SELECT 1 FROM "${config.table}")
      );
    `);
  }
}

async function main() {
  const { sqlitePath, force } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to the destination PostgreSQL database before running this migration.');
  }

  if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string for this migration.');
  }

  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }

  ensureSqliteCliAvailable();

  const targetCounts = await getTargetCounts();

  if (hasTargetData(targetCounts) && !force) {
    throw new Error(
      `Destination PostgreSQL database already contains data (${JSON.stringify(targetCounts)}). Rerun with --force to replace it.`
    );
  }

  console.log(`Reading source SQLite database: ${sqlitePath}`);

  const sourceData = TABLES.map((config) => ({
    ...config,
    rows: querySqlite(sqlitePath, `SELECT * FROM "${config.table}" ORDER BY "id" ASC;`).map((row) =>
      normalizeRow(config.table, row)
    ),
  }));

  console.log(
    `Source row counts: ${sourceData.map((config) => `${config.table}=${config.rows.length}`).join(', ')}`
  );

  await prisma.$transaction(async (tx) => {
    if (force) {
      console.log('Clearing destination PostgreSQL database...');
      await clearTargetDatabase(tx);
    }

    for (const config of sourceData) {
      if (config.rows.length === 0) {
        continue;
      }

      console.log(`Importing ${config.rows.length} row(s) into ${config.table}...`);
      await tx[config.delegate].createMany({
        data: config.rows,
      });
    }

    await resetPostgresSequences(tx);
  });

  console.log('SQLite to PostgreSQL migration completed successfully.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
