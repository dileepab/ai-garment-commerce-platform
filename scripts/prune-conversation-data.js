/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SRI_LANKA_DATE_OFFSET = '+05:30';

const TARGETS = [
  {
    label: 'chat messages',
    model: 'chatMessage',
    timeField: 'createdAt',
    senderField: 'senderId',
    channelField: 'channel',
  },
  {
    label: 'conversation states',
    model: 'conversationState',
    timeField: 'updatedAt',
    senderField: 'senderId',
    channelField: 'channel',
  },
  {
    label: 'support escalations',
    model: 'supportEscalation',
    timeField: 'updatedAt',
    senderField: 'senderId',
    channelField: 'channel',
    brandField: 'brand',
  },
  {
    label: 'bot diagnostics',
    model: 'botMessageDiagnostic',
    timeField: 'createdAt',
    senderField: 'senderId',
    channelField: 'channel',
    brandField: 'brand',
  },
  {
    label: 'webhook event logs',
    model: 'webhookEventLog',
    timeField: 'receivedAt',
    senderField: 'senderId',
    channelField: 'channel',
    brandField: 'brand',
  },
  {
    label: 'automation action logs',
    model: 'automationActionLog',
    timeField: 'createdAt',
    senderField: 'senderId',
    channelField: 'channel',
    brandField: 'brand',
  },
];

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readValues(name) {
  const values = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;

    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}.`);
    }

    values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
  }

  return Array.from(new Set(values));
}

function readOption(name) {
  const values = readValues(name);
  if (values.length > 1) {
    throw new Error(`Use ${name} only once.`);
  }

  return values[0];
}

function parseDateOption(name) {
  const value = readOption(name);
  if (!value) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00${SRI_LANKA_DATE_OFFSET}`
    : value;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${name} date: ${value}`);
  }

  return date;
}

function printHelp() {
  console.log(`
Prune old conversation data safely.

Dry-run by default:
  npm run cleanup:conversation -- --channel instagram --before 2026-05-31

Delete after reviewing dry-run counts:
  npm run cleanup:conversation -- --channel instagram --before 2026-05-31 --apply

Scope options:
  --channel <channel>      messenger, instagram, whatsapp. Comma-separated or repeatable.
  --sender <senderId>      Meta sender ID. Comma-separated or repeatable.
  --brand <brand>          Brand filter for tables that store brand. Comma-separated or repeatable.
  --after <date>           Keep records before this date, delete records on/after it.
  --before <date>          Delete records before this date.
  --apply                  Actually delete. Without this flag the script only previews counts.

Notes:
  Date-only values are interpreted as Sri Lanka midnight (${SRI_LANKA_DATE_OFFSET}).
  Customers, orders, products, inventory, comments, and courier logs are never deleted.
  Brand-only cleanup skips tables that do not store brand unless --sender is also supplied.
`);
}

function buildDateWhere(timeField, after, before) {
  if (!after && !before) return {};

  return {
    [timeField]: {
      ...(after ? { gte: after } : {}),
      ...(before ? { lt: before } : {}),
    },
  };
}

function buildWhere(target, scope) {
  if (shouldSkipTarget(target, scope)) return null;

  return {
    ...(target.channelField && scope.channels.length > 0 ? { [target.channelField]: { in: scope.channels } } : {}),
    ...(target.senderField && scope.senderIds.length > 0 ? { [target.senderField]: { in: scope.senderIds } } : {}),
    ...(target.brandField && scope.brands.length > 0 ? { [target.brandField]: { in: scope.brands } } : {}),
    ...buildDateWhere(target.timeField, scope.after, scope.before),
  };
}

function shouldSkipTarget(target, scope) {
  return scope.brands.length > 0 && !target.brandField && scope.senderIds.length === 0;
}

function describeScope(scope) {
  return {
    channels: scope.channels.length > 0 ? scope.channels : ['any'],
    senderIds: scope.senderIds.length > 0 ? scope.senderIds : ['any'],
    brands: scope.brands.length > 0 ? scope.brands : ['any'],
    after: scope.after ? scope.after.toISOString() : null,
    before: scope.before ? scope.before.toISOString() : null,
  };
}

function assertSafeScope(scope, apply) {
  if (!scope.after && !scope.before && scope.senderIds.length === 0) {
    throw new Error('Refusing to prune without --before, --after, or --sender.');
  }

  if (apply && scope.senderIds.length === 0 && scope.channels.length === 0) {
    throw new Error('For broad deletes, include --channel so the scope is explicit.');
  }
}

async function getCounts(scope) {
  const counts = [];

  for (const target of TARGETS) {
    const where = buildWhere(target, scope);
    if (!where) {
      counts.push({
        target,
        where: null,
        count: 0,
        skippedReason: 'brand is not stored on this table; add --sender to include it',
      });
      continue;
    }

    const count = await prisma[target.model].count({ where });
    counts.push({ target, where, count, skippedReason: null });
  }

  return counts;
}

async function deleteCounts(counts, scope) {
  const runnableCounts = counts.filter((entry) => entry.where);
  const operations = runnableCounts.map(({ target, where }) => prisma[target.model].deleteMany({ where }));
  const results = await prisma.$transaction(operations);
  const deleted = runnableCounts.map((entry, index) => ({
    label: entry.target.label,
    count: results[index].count,
  }));
  const total = deleted.reduce((sum, entry) => sum + entry.count, 0);

  await prisma.adminAuditLog.create({
    data: {
      action: 'conversation_data_pruned',
      entityType: 'conversation_data',
      summary: `Pruned ${total} conversation records.`,
      metadata: JSON.stringify({
        scope: describeScope(scope),
        deleted,
      }),
    },
  });

  return deleted;
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    return;
  }

  const scope = {
    channels: readValues('--channel').map((value) => value.toLowerCase()),
    senderIds: readValues('--sender'),
    brands: readValues('--brand'),
    after: parseDateOption('--after'),
    before: parseDateOption('--before'),
  };
  const apply = hasFlag('--apply');

  assertSafeScope(scope, apply);

  console.log(apply ? 'Pruning conversation data...' : 'Dry run: no data will be deleted.');
  console.log('Scope:', JSON.stringify(describeScope(scope), null, 2));

  const counts = await getCounts(scope);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);

  console.table(
    counts.map((entry) => ({
      table: entry.target.label,
      records: entry.count,
      note: entry.skippedReason || '',
    }))
  );
  console.log(`Total matched records: ${total}`);

  if (!apply) {
    console.log('Review the counts, then add --apply to delete this exact scope.');
    return;
  }

  const deleted = await deleteCounts(counts, scope);
  console.table(deleted.map((entry) => ({ table: entry.label, deleted: entry.count })));
  console.log('Cleanup complete. An admin audit log entry was saved.');
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
