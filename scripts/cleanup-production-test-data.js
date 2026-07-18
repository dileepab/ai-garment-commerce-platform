/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const { del } = require('@vercel/blob');

const prisma = new PrismaClient();
const CONFIRMATION = 'DELETE_TEST_OPERATIONAL_DATA';

const DELETE_TARGETS = [
  ['return requests', 'returnRequest'],
  ['social post creatives', 'socialPostCreative'],
  ['social post publish logs', 'socialPostPublishLog'],
  ['social posts', 'socialPost'],
  ['generated creatives', 'generatedCreative'],
  ['courier webhook event logs', 'courierWebhookEventLog'],
  ['courier shipments', 'courierShipment'],
  ['courier batches', 'courierBatch'],
  ['order fulfillment events', 'orderFulfillmentEvent'],
  ['order items', 'orderItem'],
  ['support escalations', 'supportEscalation'],
  ['automation action logs', 'automationActionLog'],
  ['orders', 'order'],
  ['customers', 'customer'],
  ['variant inventory records', 'variantInventory'],
  ['product variants', 'productVariant'],
  ['inventory records', 'inventory'],
  ['product color images', 'productColorImage'],
  ['products', 'product'],
  ['chat messages', 'chatMessage'],
  ['conversation states', 'conversationState'],
  ['bot message diagnostics', 'botMessageDiagnostic'],
  ['comment logs', 'commentLog'],
  ['comment opt-outs', 'commentOptOut'],
  ['comment reply queue entries', 'commentReplyQueue'],
  ['Meta webhook event logs', 'webhookEventLog'],
  ['production batches', 'productionBatch'],
  ['operator outputs', 'operatorOutput'],
  ['operators', 'operator'],
  ['fabrics', 'fabric'],
  ['analytics records', 'analytics'],
];

const PRESERVED_TARGETS = [
  ['merchant settings', 'merchantSettings'],
  ['brand channel configurations', 'brandChannelConfig'],
  ['courier integration settings', 'courierIntegrationSetting'],
  ['courier location cache entries', 'courierLocation'],
  ['bot training rules', 'botTrainingRule'],
  ['admin audit logs', 'adminAuditLog'],
];

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readInlineOption(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function isVercelBlobUrl(value) {
  if (!value || value.startsWith('data:')) return false;

  try {
    return new URL(value).hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

async function collectBlobUrls() {
  const [products, colorImages, creatives] = await Promise.all([
    prisma.product.findMany({ select: { imageUrl: true } }),
    prisma.productColorImage.findMany({ select: { imageUrl: true } }),
    prisma.generatedCreative.findMany({
      select: { sourceImageUrl: true, generatedImageData: true },
    }),
  ]);
  const candidates = [
    ...products.map((entry) => entry.imageUrl),
    ...colorImages.map((entry) => entry.imageUrl),
    ...creatives.flatMap((entry) => [entry.sourceImageUrl, entry.generatedImageData]),
  ];

  return Array.from(new Set(candidates.filter(isVercelBlobUrl)));
}

async function getCounts(targets) {
  return Promise.all(
    targets.map(async ([label, model]) => ({
      label,
      model,
      count: await prisma[model].count(),
    }))
  );
}

function printCounts(title, counts) {
  console.log(`\n${title}`);
  console.table(counts.map(({ label, count }) => ({ data: label, count })));
  console.log(`Total: ${counts.reduce((sum, entry) => sum + entry.count, 0)}`);
}

async function applyCleanup(previewCounts, blobUrls) {
  const operations = DELETE_TARGETS.map(([, model]) => prisma[model].deleteMany());
  const results = await prisma.$transaction(operations);
  const deleted = DELETE_TARGETS.map(([label, model], index) => ({
    label,
    model,
    count: results[index].count,
  }));

  await prisma.adminAuditLog.create({
    data: {
      action: 'production_test_data_cleanup',
      entityType: 'operational_data',
      summary: `Deleted ${deleted.reduce((sum, entry) => sum + entry.count, 0)} test operational records.`,
      metadata: JSON.stringify({
        previewCounts,
        deleted,
        blobAssetCount: blobUrls.length,
        preservedModels: PRESERVED_TARGETS.map(([, model]) => model),
      }),
    },
  });

  if (blobUrls.length > 0) {
    await del(blobUrls);
  }

  return deleted;
}

async function main() {
  const apply = hasFlag('--apply');
  const confirmation = readInlineOption('--confirm');
  const [deleteCounts, preservedCounts, blobUrls] = await Promise.all([
    getCounts(DELETE_TARGETS),
    getCounts(PRESERVED_TARGETS),
    collectBlobUrls(),
  ]);

  console.log(apply ? 'LIVE CLEANUP REQUESTED' : 'DRY RUN: no database records or files will be deleted.');
  printCounts('Records selected for deletion', deleteCounts);
  console.log(`Vercel Blob assets selected for deletion: ${blobUrls.length}`);
  printCounts('Settings and configuration records that will be preserved', preservedCounts);
  console.log('\nExternal Facebook and Instagram posts are not deleted by this command.');

  if (!apply) {
    console.log(
      `\nAfter reviewing these counts, apply with:\n` +
        `npm run cleanup:test-data -- --apply --confirm=${CONFIRMATION}`
    );
    return;
  }

  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `Refusing live cleanup. Pass --confirm=${CONFIRMATION} after reviewing the dry run.`
    );
  }

  const deleted = await applyCleanup(deleteCounts, blobUrls);
  printCounts('Deleted records', deleted);
  console.log(`Deleted Vercel Blob assets: ${blobUrls.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
