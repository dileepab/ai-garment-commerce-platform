/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.join(__dirname, '..');

function loadTypeScriptModule(relativePath, dependencyOverrides = {}) {
  const ts = require('typescript');
  const filename = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const moduleInstance = new Module(filename);
  moduleInstance.filename = filename;
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = moduleInstance.require.bind(moduleInstance);

  moduleInstance.require = (request) => {
    if (Object.hasOwn(dependencyOverrides, request)) {
      return dependencyOverrides[request];
    }

    return originalRequire(request);
  };
  moduleInstance._compile(result.outputText, filename);
  return moduleInstance.exports;
}

const language = loadTypeScriptModule('src/lib/chat/language.ts', {
  '@/lib/app-log': { logDebug: () => {}, logError: () => {}, logWarn: () => {} },
});
const messageUtils = loadTypeScriptModule('src/lib/chat/message-utils.ts', {
  '@/lib/contact-profile': { cleanStoredContactName: (value) => value },
});
const catalogGuidance = loadTypeScriptModule('src/lib/chat/catalog-guidance.ts');
const replyBuilders = loadTypeScriptModule('src/lib/chat/reply-builders.ts', {
  '@/lib/chat/catalog-guidance': catalogGuidance,
  '@/lib/contact-profile': {
    getMissingContactFields: () => [],
  },
  '@/lib/delivery-calendar': {
    calculateSriLankaDeliveryWindow: () => null,
    formatSriLankaDisplayDate: (value) => String(value),
  },
  '@/lib/customer-support': {
    buildSupportContactAcknowledgement: () => '',
    buildSupportContactLine: () => '',
    buildSupportContactLineFromConfig: () => '',
  },
  '@/lib/order-status-display': { getOrderStageLabel: () => '' },
  '@/lib/size-charts': {
    getDefaultSizeChartCategories: () => [],
    getSizeChartDefinition: () => null,
    getSizeChartImagePath: () => null,
  },
  '@/lib/order-draft': { getBusinessDayRangeFromEstimate: () => null },
  '@/lib/chat/message-utils': messageUtils,
  '@/lib/product-garment-specs': { buildGarmentSpecsForCustomer: () => '' },
});

test('recognizes a native Sinhala language preference request', () => {
  const message = 'සිංහලෙන් කියන්න පුළුවන්ද?';
  const resolution = language.resolveCustomerLanguage(message, 'english');

  assert.equal(resolution.language, 'sinhala');
  assert.equal(resolution.isExplicitPreferenceRequest, true);
  assert.equal(language.isLanguagePreferenceOnlyMessage(message), true);
});

test('recognizes a native Tamil language preference request', () => {
  const message = 'தமிழில் பதில் சொல்ல முடியுமா?';
  const resolution = language.resolveCustomerLanguage(message, 'english');

  assert.equal(resolution.language, 'tamil');
  assert.equal(resolution.isExplicitPreferenceRequest, true);
  assert.equal(language.isLanguagePreferenceOnlyMessage(message), true);
});

for (const message of ['Vanakkam!', 'romba nandri!']) {
  test(`classifies Roman Tamil phrase as Tamil: ${message}`, () => {
    assert.equal(language.detectCustomerLanguage(message), 'tamil');
    assert.equal(language.detectCustomerScriptStyle(message, 'tamil'), 'roman');
  });
}

for (const [label, message] of [
  [
    'native Sinhala',
    'ආයුබෝවන්! ගිම්හානයට සැහැල්ලු ඇඳුමක් නිර්දේශ කරන්න පුළුවන්ද?',
  ],
  ['Roman Sinhala', 'mata hot weather ekata adinna light dress ekak ona'],
  [
    'native Tamil',
    'வணக்கம்! வெயில் காலத்திற்கு லேசான உடை பரிந்துரைக்க முடியுமா?',
  ],
  ['Roman Tamil', 'enakku hot weather-ku light dress venum'],
]) {
  test(`recognizes ${label} recommendation intent`, () => {
    assert.equal(catalogGuidance.looksLikeRecommendationRequest(message), true);
  });
}

test('keeps recommendation intent when a message also starts with a greeting', () => {
  const message = 'Hi 👋 Any comfy clothes for travelling?';

  assert.equal(messageUtils.isGreetingMessage(message), true);
  assert.equal(catalogGuidance.looksLikeRecommendationRequest(message), true);
});

test('answers every requested product field when common typos are recoverable', () => {
  const reply = replyBuilders.buildProductQuestionReply(
    {
      name: 'Breezy Summer Dress',
      price: 2950,
      sizes: 'S,M,L',
      colors: 'Coral,Sage',
      fabric: 'Rayon',
      inventory: { availableQty: 9 },
    },
    'price',
    'breezy sumar dres prce n szes?'
  );

  assert.match(reply, /(?:Price|priced).*Rs 2950/i);
  assert.match(reply, /Sizes?: S, M, L/i);
});

test('thanks detection does not swallow a request that follows the thanks', () => {
  assert.equal(messageUtils.isThanksMessage('Thanks!'), true);
  assert.equal(messageUtils.isThanksMessage('Thanks, but I need to change the size'), false);
  assert.equal(messageUtils.isThanksMessage('ස්තුතියි, ඒත් size එක වෙනස් කරන්න'), false);
  assert.equal(messageUtils.isThanksMessage('நன்றி, ஆனால் size மாற்ற வேண்டும்'), false);
});

test('native language preference plus a product question is not preference-only', () => {
  assert.equal(
    language.isLanguagePreferenceOnlyMessage('සිංහලෙන් මේ ඇඳුමේ මිල කියන්න'),
    false
  );
  assert.equal(
    language.isLanguagePreferenceOnlyMessage('தமிழில் இந்த உடையின் விலை சொல்லுங்கள்'),
    false
  );
});

test('extracts multilingual recommendation budgets and colors', () => {
  const testProducts = [
    {
      id: 1,
      name: 'Black Cotton Top',
      price: 1750,
      fabric: 'Cotton',
      sizes: 'M',
      colors: 'Black',
      stock: 2,
    },
    {
      id: 2,
      name: 'White Linen Top',
      price: 2400,
      fabric: 'Linen',
      sizes: 'M',
      colors: 'White',
      stock: 2,
    },
  ];

  for (const message of [
    'mata Rs 2000ta aduwen kalu top ekak ona',
    'enakku Rs 2000 kulla karuppu top venum',
    'රු 2000ට අඩුවෙන් කළු top එකක් නිර්දේශ කරන්න',
    'Rs 2000க்குள் கருப்பு top பரிந்துரைக்கவும்',
  ]) {
    const result = catalogGuidance.rankCatalogRecommendations(testProducts, message);
    assert.equal(result.requestedBudget, 2000, message);
    assert.deepEqual(result.requestedColors, ['Black'], message);
    assert.equal(result.products[0]?.name, 'Black Cotton Top', message);
  }
});

test('maps native color wording to an available catalog variant', () => {
  const product = {
    id: 1,
    name: 'Oversized Casual Top',
    price: 1750,
    sizes: 'M,L',
    colors: 'Black,White',
    variants: [
      { size: 'M', color: 'Black', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'White', status: 'active', inventory: { availableQty: 1 } },
    ],
  };

  assert.equal(
    catalogGuidance.resolveRequestedVariant(product, 'කළු පාට එකක් තියෙනවද?').color,
    'Black'
  );
  assert.equal(
    catalogGuidance.resolveRequestedVariant(product, 'அது கருப்பு நிறத்தில் இருக்கிறதா?').color,
    'Black'
  );
});

test('recognizes native-language product comparison intent', () => {
  assert.equal(
    catalogGuidance.looksLikeProductComparison('මේ දෙකෙන් වඩා හොඳ එක මොකක්ද?'),
    true
  );
  assert.equal(
    catalogGuidance.looksLikeProductComparison('இந்த இரண்டில் எது சிறந்தது?'),
    true
  );
});
