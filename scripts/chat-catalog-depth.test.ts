import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildAvailableVariantReply,
  buildCatalogRecommendationReply,
  buildProductComparisonReply,
  buildShortlistRecommendationReply,
  rankCatalogRecommendations,
  resolveRequestedVariant,
  type CatalogGuidanceProduct,
} from '../src/lib/chat/catalog-guidance.ts';
import * as variantAvailability from '../src/lib/variant-availability.ts';
import * as productItemCodeModule from '../src/lib/product-item-code.ts';
import * as greetingVariants from '../src/lib/chat/greeting-variants.ts';
import * as confirmationIntent from '../src/lib/confirmation-intent.ts';
import type { ConversationStateData } from '../src/lib/conversation-state.ts';
import type {
  AiRoutedAction,
  RouterInput,
  RouterProductContext,
} from '../src/lib/ai-router/types.ts';

type CompilableModule = {
  filename: string;
  paths: string[];
  require: (request: string) => unknown;
  _compile: (source: string, filename: string) => void;
  exports: Record<string, unknown>;
};

type ModuleConstructor = {
  new (filename: string): CompilableModule;
  _nodeModulePaths: (directory: string) => string[];
};

const requireFromTest = createRequire(import.meta.url);
const Module = requireFromTest('node:module') as ModuleConstructor;
const ts = requireFromTest('typescript') as typeof import('typescript');
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(testDirectory, '..');

function transpile(filePath: string): string {
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
}

function loadModule<T>(
  filePath: string,
  replacements: Record<string, unknown>
): T {
  const moduleInstance = new Module(filePath);
  moduleInstance.filename = filePath;
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalRequire = moduleInstance.require.bind(moduleInstance);

  moduleInstance.require = (request) =>
    Object.prototype.hasOwnProperty.call(replacements, request)
      ? replacements[request]
      : originalRequire(request);
  moduleInstance._compile(transpile(filePath), filePath);

  return moduleInstance.exports as T;
}

const replyBuilders = loadModule<{
  buildProductQuestionReply: (
    product: CatalogGuidanceProduct & {
      closureDetails?: string | null;
      hasSideSlit?: boolean | null;
      sideSlitHeightCm?: number | null;
    },
    questionType: 'colors' | 'sizes' | 'price' | 'availability' | 'fit' | null,
    customerMessage?: string
  ) => string;
}>(path.join(projectRoot, 'src/lib/chat/reply-builders.ts'), {
  '@/lib/chat/catalog-guidance': {
    buildAvailableVariantReply,
    resolveRequestedVariant,
  },
  '@/lib/contact-profile': { getMissingContactFields: () => [] },
  '@/lib/delivery-calendar': {
    calculateSriLankaDeliveryWindow: () => ({
      earliestDate: new Date('2026-07-28T00:00:00.000Z'),
      latestDate: new Date('2026-07-30T00:00:00.000Z'),
    }),
    formatSriLankaDisplayDate: (date: Date) => date.toISOString().slice(0, 10),
  },
  '@/lib/customer-support': {
    buildSupportContactAcknowledgement: () => '',
    buildSupportContactLine: () => '',
    buildSupportContactLineFromConfig: () => '',
  },
  '@/lib/order-status-display': { getOrderStageLabel: (status: string) => status },
  '@/lib/size-charts': {
    getDefaultSizeChartCategories: () => [],
    getSizeChartDefinition: () => null,
    getSizeChartImagePath: () => '',
  },
  '@/lib/order-draft': {
    getBusinessDayRangeFromEstimate: () => ({ min: 2, max: 3 }),
  },
  '@/lib/chat/message-utils': {
    firstNameOf: () => '',
    formatSizeList: (value: string) => value || '',
    sortSizeOptions: (values: string[]) => values,
    splitCsv: (value: string) =>
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
  },
  '@/lib/product-garment-specs': { buildGarmentSpecsForCustomer: () => '' },
  // Real implementations, not stubs: all three are free of path aliases, and
  // availability answers depend on the genuine variant maths. Without these the
  // module failed to load at all and every test in this file was skipped.
  '@/lib/variant-availability': variantAvailability,
  '@/lib/product-item-code': productItemCodeModule,
  '@/lib/chat/greeting-variants': greetingVariants,
});

const messageUtils = loadModule<{
  isGreetingMessage: (message: string) => boolean;
  looksLikeCatalogQuestion: (message: string) => boolean;
}>(path.join(projectRoot, 'src/lib/chat/message-utils.ts'), {
  '@/lib/contact-profile': { cleanStoredContactName: (value: string) => value },
});

const heuristics = loadModule<{
  buildHeuristicAction: (
    input: RouterInput,
    product: RouterProductContext | null
  ) => AiRoutedAction;
  findProductByMessage: (
    products: RouterProductContext[],
    currentMessage: string,
    recentMessages: RouterInput['recentMessages']
  ) => RouterProductContext | null;
}>(path.join(projectRoot, 'src/lib/ai-router/heuristics.ts'), {
  '@/lib/contact-profile': {
    extractContactDetailsFromText: (message: string) => {
      const labelledName = message.match(/^\s*name\s*:\s*(.+)$/i)?.[1]?.trim();
      return labelledName ? { name: labelledName } : {};
    },
  },
  '@/lib/chat/message-utils': { looksLikeCourierProviderQuestion: () => false },
  '@/lib/confirmation-intent': confirmationIntent,
});

const conversationState = loadModule<{
  normalizeConversationState: (
    value?: Partial<ConversationStateData> | null
  ) => ConversationStateData;
}>(path.join(projectRoot, 'src/lib/conversation-state.ts'), {
  '@/lib/prisma': {},
});

const products: CatalogGuidanceProduct[] = [
  {
    id: 1,
    name: 'Oversized Casual Top',
    style: 'oversized_top',
    price: 1750,
    fabric: 'Cotton',
    sizes: 'S,M,L',
    colors: 'Black,White',
    stock: 11,
    inventory: { availableQty: 11 },
    variants: [
      { size: 'S', color: 'Black', status: 'active', inventory: { availableQty: 2 } },
      { size: 'S', color: 'White', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Black', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'White', status: 'active', inventory: { availableQty: 2 } },
      { size: 'L', color: 'Black', status: 'active', inventory: { availableQty: 2 } },
      { size: 'L', color: 'White', status: 'active', inventory: { availableQty: 1 } },
    ],
  },
  {
    id: 2,
    name: 'Ribbed Crop Top',
    style: 'crop_top',
    price: 1250,
    fabric: 'Ribbed Cotton',
    sizes: 'S,M',
    colors: 'Beige,Pink',
    stock: 6,
    inventory: { availableQty: 6 },
    variants: [
      { size: 'S', color: 'Beige', status: 'active', inventory: { availableQty: 2 } },
      { size: 'S', color: 'Pink', status: 'active', inventory: { availableQty: 1 } },
      { size: 'M', color: 'Beige', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Pink', status: 'active', inventory: { availableQty: 1 } },
    ],
  },
  {
    id: 3,
    name: 'Breezy Summer Dress',
    style: 'summer_dress',
    price: 2950,
    fabric: 'Rayon',
    sizes: 'S,M,L',
    colors: 'Coral,Sage',
    stock: 9,
    inventory: { availableQty: 9 },
    variants: [
      { size: 'S', color: 'Coral', status: 'active', inventory: { availableQty: 2 } },
      { size: 'S', color: 'Sage', status: 'active', inventory: { availableQty: 1 } },
      { size: 'M', color: 'Coral', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Sage', status: 'active', inventory: { availableQty: 2 } },
      { size: 'L', color: 'Coral', status: 'active', inventory: { availableQty: 1 } },
      { size: 'L', color: 'Sage', status: 'active', inventory: { availableQty: 1 } },
    ],
  },
  {
    id: 4,
    name: 'Relaxed Linen Pants',
    style: 'linen_pants',
    price: 2400,
    fabric: 'Linen Blend',
    sizes: 'S,M,L',
    colors: 'Beige,Black',
    stock: 10,
    inventory: { availableQty: 10 },
    variants: [
      { size: 'S', color: 'Beige', status: 'active', inventory: { availableQty: 2 } },
      { size: 'S', color: 'Black', status: 'active', inventory: { availableQty: 1 } },
      { size: 'M', color: 'Beige', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Black', status: 'active', inventory: { availableQty: 2 } },
      { size: 'L', color: 'Beige', status: 'active', inventory: { availableQty: 2 } },
      { size: 'L', color: 'Black', status: 'active', inventory: { availableQty: 1 } },
    ],
  },
  {
    id: 5,
    name: 'Pleated Midi Skirt',
    style: 'midi_skirt',
    price: 2100,
    fabric: 'Crepe',
    sizes: 'S,M,L',
    colors: 'Black,Cream',
    stock: 8,
    inventory: { availableQty: 8 },
    variants: [
      { size: 'S', color: 'Black', status: 'active', inventory: { availableQty: 1 } },
      { size: 'S', color: 'Cream', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Black', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Cream', status: 'active', inventory: { availableQty: 1 } },
      { size: 'L', color: 'Black', status: 'active', inventory: { availableQty: 1 } },
      { size: 'L', color: 'Cream', status: 'active', inventory: { availableQty: 1 } },
    ],
  },
];

const routerProducts: RouterProductContext[] = products.map((product) => ({
  name: product.name,
  style: product.style || '',
  price: product.price,
  sizes: product.sizes,
  colors: product.colors,
  availableQty: product.inventory?.availableQty ?? product.stock ?? 0,
}));

function routerInput(currentMessage: string): RouterInput {
  return {
    brand: 'Happybuy',
    currentMessage,
    pendingStep: 'none',
    knownContact: {},
    lastReferencedOrderId: null,
    latestOrderId: null,
    latestActiveOrderId: null,
    recentMessages: [],
    products: routerProducts,
  };
}

test('answers an available exact variant with its requested combination', () => {
  const product = products[0];
  const prompt = 'Is the Oversized Casual Top available in Black, size L?';
  const requested = resolveRequestedVariant(product, prompt);

  assert.deepEqual(requested, { size: 'L', color: 'Black' });

  const reply = replyBuilders.buildProductQuestionReply(
    product,
    'availability',
    prompt
  );
  assert.match(
    reply,
    /(?:Black[\s\S]*\bL\b[\s\S]*available|available[\s\S]*Black[\s\S]*\bL\b)/i
  );
});

// Availability is answered for the exact colour and size asked about, without
// quoting the warehouse count — that number is ours, and a customer asking
// whether a top exists in Black L wants a yes, not an inventory figure.
test('confirms the requested variant without quoting stock figures', () => {
  const product = products[0];
  const prompt =
    'Exactly how many Black size L Oversized Casual Tops are in stock right now?';
  const reply = replyBuilders.buildProductQuestionReply(
    product,
    'availability',
    prompt
  );

  assert.match(reply, /Black[\s\S]*size L|size L[\s\S]*Black/i);
  assert.doesNotMatch(reply, /Available stock/i);
  // Neither the variant count nor the aggregate leaks through.
  assert.doesNotMatch(reply, /\b(?:2|11)\s*items?\b/i);
});

test('persists the previous recommendation shortlist for referential follow-ups', () => {
  const rawState = {
    lastRecommendedProductIds: [1, 5, 4],
  } as unknown as Partial<ConversationStateData>;
  const normalized = conversationState.normalizeConversationState(rawState) as ConversationStateData & {
    lastRecommendedProductIds?: number[];
  };

  assert.deepEqual(normalized.lastRecommendedProductIds, [1, 5, 4]);
});

test('persists recommendation constraints for refined follow-ups', () => {
  const rawState = {
    lastRecommendationConstraints: {
      maximumPrice: 2500,
      colors: ['Black'],
    },
  } as unknown as Partial<ConversationStateData>;
  const normalized = conversationState.normalizeConversationState(rawState) as ConversationStateData & {
    lastRecommendationConstraints?: {
      maximumPrice: number;
      colors: string[];
    };
  };

  assert.deepEqual(normalized.lastRecommendationConstraints, {
    maximumPrice: 2500,
    colors: ['Black'],
  });
});

test('can rank a retained shortlist for a hot-weather follow-up', () => {
  const retainedShortlist = [products[0], products[4], products[3]];
  const result = buildCatalogRecommendationReply(
    retainedShortlist,
    'Which one of those is coolest for a hot day?'
  );

  assert.equal(result.products[0]?.name, 'Relaxed Linen Pants');
  assert.match(result.reply, /strong warm-weather match based on its recorded Linen Blend/i);
  assert.doesNotMatch(result.reply, /Breezy Summer Dress|Ribbed Crop Top/);
});

test('recognizes a catalog request even when it starts with a greeting', () => {
  const prompt = 'Hi, what clothes do you currently have available?';

  assert.equal(messageUtils.isGreetingMessage(prompt), true);
  assert.equal(messageUtils.looksLikeCatalogQuestion(prompt), true);
});

test('heuristic routing prioritizes browse intent over the greeting', () => {
  const prompt = 'Hi, what clothes do you currently have available?';
  const action = heuristics.buildHeuristicAction(routerInput(prompt), null);

  assert.equal(action.action, 'catalog_list');
});

test('routes labelled contact details as an existing-order update after prompting for them', () => {
  const input: RouterInput = {
    ...routerInput('Name: BMD Balasuriya'),
    lastReferencedOrderId: 542,
    recentMessages: [
      {
        role: 'assistant',
        message:
          'Sure - please send the new name, delivery address, or phone number for order #542.',
      },
    ],
  };

  const action = heuristics.buildHeuristicAction(input, null);

  assert.equal(action.action, 'update_order_contact');
  assert.equal(action.contact.name, 'BMD Balasuriya');
});

test('resolves a misspelled product name and extracts its requested variant', () => {
  const prompt = 'Do u have the breezy sumr dress in Sage size M?';
  const matched = heuristics.findProductByMessage(routerProducts, prompt, []);

  assert.equal(matched?.name, 'Breezy Summer Dress');
  const action = heuristics.buildHeuristicAction(routerInput(prompt), matched);
  assert.equal(action.action, 'product_question');
  assert.equal(action.size, 'M');
  assert.equal(action.color, 'Sage');
});

test('answers all requested variant fields after typo recovery', () => {
  const product = products[2];
  const prompt = 'Do u have the breezy sumr dress in Sage size M?';
  const reply = replyBuilders.buildProductQuestionReply(
    product,
    'availability',
    prompt
  );

  assert.match(
    reply,
    /(?:Sage[\s\S]*\bM\b[\s\S]*available|available[\s\S]*Sage[\s\S]*\bM\b)/i
  );
});

test('uses recorded style when asked which product has a relaxed casual fit', () => {
  const comparison = buildProductComparisonReply(
    [products[0], products[1]],
    'Which is better for a relaxed casual fit, the Ribbed Crop Top or Oversized Casual Top?'
  );

  assert.ok(comparison);
  assert.equal(comparison.preferredProduct.name, 'Oversized Casual Top');
  assert.match(comparison.reply, /relaxed casual|relaxed fit/i);
});

test('requires one stocked variant to satisfy requested color and size together', () => {
  const sparseProduct: CatalogGuidanceProduct = {
    id: 99,
    name: 'Sparse Variant Top',
    price: 1500,
    sizes: 'M,L',
    colors: 'Black,White',
    variants: [
      { size: 'L', color: 'Black', status: 'active', inventory: { availableQty: 1 } },
      { size: 'M', color: 'White', status: 'active', inventory: { availableQty: 1 } },
    ],
  };
  const result = rankCatalogRecommendations(
    [sparseProduct],
    'I need a Black top in size M'
  );

  assert.equal(result.exactMatch, false);
});

test('does not silently discard explicit unknown color and size constraints', () => {
  const result = rankCatalogRecommendations(products, 'Show me something Purple in size 3XL');

  assert.equal(result.exactMatch, false);
  assert.deepEqual(result.requestedColors, ['Purple']);
  assert.deepEqual(result.requestedSizes, ['3XL']);
});

test('under-budget shortlist follow-up states when none of those options qualify', () => {
  const result = buildShortlistRecommendationReply(
    [products[0], products[3]],
    'Which one of those is under Rs 1000?'
  );

  assert.ok(result);
  assert.match(result.reply, /none of those|does not match|no exact/i);
  assert.doesNotMatch(result.reply, /good match from/i);
});

test('natural color and size phrasing confirms that exact variant', () => {
  const reply = replyBuilders.buildProductQuestionReply(
    products[0],
    'availability',
    'Do you have the Oversized Casual Top in Black L?'
  );

  assert.match(reply, /Black[\s\S]*size L|size L[\s\S]*Black/i);
  assert.match(reply, /\bavailable\b/i);
  assert.doesNotMatch(reply, /Available stock/i);
});
