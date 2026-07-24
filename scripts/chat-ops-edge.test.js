/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const MESSAGE_UTILS_FILE = path.join(ROOT, 'src', 'lib', 'chat', 'message-utils.ts');
const ORDERS_FILE = path.join(ROOT, 'src', 'lib', 'chat', 'orders.ts');
const PRICING_FILE = path.join(ROOT, 'src', 'lib', 'order-draft', 'pricing.ts');
const REPLY_BUILDERS_FILE = path.join(ROOT, 'src', 'lib', 'chat', 'reply-builders.ts');
const CATALOG_GUIDANCE_FILE = path.join(ROOT, 'src', 'lib', 'chat', 'catalog-guidance.ts');

function transpile(filePath) {
  const ts = require('typescript');
  const source = fs.readFileSync(filePath, 'utf8');

  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
}

function loadModule(filePath, replacements) {
  const moduleInstance = new Module(filePath);
  moduleInstance.filename = filePath;
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalRequire = moduleInstance.require.bind(moduleInstance);

  moduleInstance.require = (request) =>
    Object.prototype.hasOwnProperty.call(replacements, request)
      ? replacements[request]
      : originalRequire(request);
  moduleInstance._compile(transpile(filePath), filePath);
  return moduleInstance.exports;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const deliverySettings = {
  colomboCharge: 150,
  outsideColomboCharge: 200,
  colomboEstimate: '1-2 business days',
  outsideColomboEstimate: '2-3 business days',
};

const {
  getDeliveryChargeForAddress,
  getKoombiyoDeliveryRateForAddress,
  resolveKoombiyoDeliveryDestination,
} = loadModule(PRICING_FILE, {
  './formatters': { normalizeText },
  '@/lib/runtime-config': {
    getDefaultMerchantSettings: () => ({ delivery: deliverySettings }),
  },
  '@/lib/data/koombiyo-delivery-rates.json': require('../src/lib/data/koombiyo-delivery-rates.json'),
});

const {
  extractDeliveryLocationHint,
} = loadModule(MESSAGE_UTILS_FILE, {
  '@/lib/contact-profile': {
    cleanStoredContactName: (value) => value || '',
  },
  '@/lib/customer-support': {},
});
const catalogGuidance = loadModule(CATALOG_GUIDANCE_FILE, {});

const {
  buildDeliveryReply,
  buildPaymentAvailabilityReply,
} = loadModule(REPLY_BUILDERS_FILE, {
  '@/lib/chat/catalog-guidance': catalogGuidance,
  '@/lib/contact-profile': {
    getMissingContactFields: () => [],
  },
  '@/lib/delivery-calendar': {
    calculateSriLankaDeliveryWindow: () => ({
      earliestDate: new Date('2026-07-28T00:00:00.000Z'),
      latestDate: new Date('2026-07-30T00:00:00.000Z'),
    }),
    formatSriLankaDisplayDate: (date) => date.toISOString().slice(0, 10),
  },
  '@/lib/customer-support': {
    buildSupportContactAcknowledgement: () => '',
    buildSupportContactLine: () => '',
    buildSupportContactLineFromConfig: () => '',
  },
  '@/lib/order-status-display': {
    getOrderStageLabel: (status) => status,
  },
  '@/lib/size-charts': {
    getDefaultSizeChartCategories: () => [],
    getSizeChartDefinition: () => null,
    getSizeChartImagePath: () => '',
  },
  '@/lib/order-draft': {
    getBusinessDayRangeFromEstimate: () => [2, 3],
  },
  '@/lib/chat/message-utils': {
    firstNameOf: () => '',
    formatSizeList: (value) => value || '',
    sortSizeOptions: (values) => values,
    splitCsv: (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean),
  },
  '@/lib/product-garment-specs': {
    buildGarmentSpecsForCustomer: () => '',
  },
});

function loadOrderHandlers() {
  const noOp = () => null;

  return loadModule(ORDERS_FILE, {
    '@/lib/prisma': {},
    '@/lib/chat/order-flow': {
      getRequestedOrderId: noOp,
      resolveCustomerTargetOrder: noOp,
      buildQuantityUpdateSummaryFromOrder: noOp,
      buildReorderDraftFromOrder: noOp,
    },
    '@/lib/chat/reply-builders': {
      buildMissingContactPrompt: () =>
        'To proceed with the order, please share:\nName:\nStreet Address:\nCity/Town:\nDistrict:\nPhone Number:',
      buildMissingOrderLookupReply: noOp,
      buildVariantPrompt: () => '',
    },
    '@/lib/contact-profile': {
      extractContactDetailsFromText: () => ({}),
      formatDeliveryAddress: () => '',
      getMissingContactFields: () => [
        'name',
        'streetAddress',
        'city',
        'district',
        'phone',
      ],
    },
    '@/lib/order-draft': {
      buildContactConfirmationReply: noOp,
      buildOrderSummaryReply: noOp,
      getDeliveryChargeForAddress: () => 0,
      getDeliveryEstimateForAddress: () => '2-3 business days',
    },
    '@/lib/order-details': {
      buildCancellationSuccessReply: noOp,
      buildOrderContactUpdateSuccessReply: noOp,
      buildOrderAlreadyCancelledReply: noOp,
      buildOrderPlacedReply: noOp,
      buildQuantityUpdateSuccessReply: noOp,
      buildQuantityUpdateSummaryReply: noOp,
      calculateOrderDeliveryCharge: () => 0,
    },
    '@/lib/orders': {
      cancelOrderById: noOp,
      createOrderFromCatalog: noOp,
      isOrderMutableStatus: () => false,
      OrderRequestError: class OrderRequestError extends Error {},
      updateSingleItemOrderQuantityById: noOp,
    },
    '@/lib/koombiyo-courier': {
      autoAssignKoombiyoWaybill: noOp,
    },
    '@/lib/customer-self-service': {
      buildSelfServiceEscalationReply: noOp,
      isCustomerSelfServiceCancellationAllowed: () => false,
      isCustomerSelfServiceContactUpdateAllowed: () => false,
    },
    '@/lib/conversation-state': {
      saveConversationStateIfCurrent: noOp,
    },
    '@/lib/chat/message-utils': {
      splitCsv: (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean),
      sortSizeOptions: (values) => values,
      mentionsLatestOrderReference: () => false,
      mentionsOwnedOrderReference: () => false,
    },
    '@/lib/customer-support': {
      buildSupportContactLineFromConfig: () => '',
    },
    '@/lib/size-charts': {
      getSizeChartCategoryFromStyle: noOp,
      getSizeChartImagePath: noOp,
    },
    './shared-actions': {
      upsertCustomerContact: noOp,
    },
  });
}

function buildDeliveryReplyForLocation(address) {
  return buildDeliveryReply({
    address,
    referenceDate: new Date('2026-07-24T00:00:00.000Z'),
    requestedDate: null,
    isDraft: true,
    getDeliveryEstimateForAddress: () => '2-3 business days',
    getDeliveryChargeForAddress: (value) =>
      getKoombiyoDeliveryRateForAddress(value)?.chargeFirstKg ?? Number.NaN,
    includeCharge: true,
  });
}

test('known Koombiyo destination is resolved and quoted exactly', () => {
  const rate = getKoombiyoDeliveryRateForAddress('Negombo');

  assert.equal(rate?.destination, 'negombo');
  assert.equal(rate?.chargeFirstKg, 450);
  assert.match(buildDeliveryReplyForLocation('Negombo'), /Delivery to Negombo costs Rs 450/);
});

test('native-script city names resolve to their configured Koombiyo rate', () => {
  assert.equal(getKoombiyoDeliveryRateForAddress('කුරුණෑගල')?.chargeFirstKg, 400);
  assert.equal(getKoombiyoDeliveryRateForAddress('குருநாகல்')?.chargeFirstKg, 400);
});

test('outside-Colombo policy wording uses the configured regional rate', () => {
  assert.equal(getKoombiyoDeliveryRateForAddress('outside Colombo'), null);
  assert.equal(getDeliveryChargeForAddress('outside Colombo', deliverySettings), 200);
});

test('destination typo suggestion prefers the canonical spelling', () => {
  assert.equal(resolveKoombiyoDeliveryDestination('Negmbo').suggestion, 'Negombo');
});

test('misspelled destination is identified as unmatched before a price is quoted', () => {
  const message = 'How much is delivery to Negmbo?';
  const location = extractDeliveryLocationHint(message);

  assert.equal(location, 'Negmbo');
  assert.equal(getKoombiyoDeliveryRateForAddress(location), null);

  const reply = buildDeliveryReplyForLocation(location);
  assert.doesNotMatch(reply, /costs Rs/i);
  assert.match(reply, /confirm|did you mean|district|postal|city or town/i);
});

test('delivery location extraction excludes the trailing timing clause', () => {
  const message = 'How much is delivery to Moonbase Junction, and when will it arrive?';
  const location = extractDeliveryLocationHint(message);

  assert.equal(location, 'Moonbase Junction');
});

test('fictional destination is identified as unmatched before serviceability is promised', () => {
  const location = 'Moonbase Junction';

  assert.equal(getKoombiyoDeliveryRateForAddress(location), null);

  const reply = buildDeliveryReplyForLocation(location);
  assert.doesNotMatch(reply, /costs Rs|expected delivery window/i);
  assert.match(reply, /confirm|district|postal|city or town/i);
});

test('split transfer and COD question is answered explicitly', () => {
  const reply = buildPaymentAvailabilityReply({
    message: 'Can I pay half by bank transfer and the rest by COD?',
    methods: ['COD', 'Online Transfer'],
    onlineTransferLabel: 'Online Transfer',
  });

  assert.match(reply, /split|half.*rest|combine|single payment/i);
  assert.match(reply, /not supported|not available|cannot|can't|confirm/i);
  assert.doesNotMatch(reply, /^Yes, COD works for us\./i);
});

test('asking whether COD and transfer are both offered is not treated as split payment', () => {
  const reply = buildPaymentAvailabilityReply({
    message: 'Do you offer COD and bank transfer?',
    methods: ['COD', 'Online Transfer'],
    onlineTransferLabel: 'Online Transfer',
  });

  assert.match(reply, /both COD and Online Transfer are available/i);
  assert.doesNotMatch(reply, /split payment|not supported/i);
});

test('credit-card and PayPal question rejects unsupported methods and lists valid options', () => {
  const reply = buildPaymentAvailabilityReply({
    message: 'Can I pay by credit card or PayPal instead of COD?',
    methods: ['COD', 'Online Transfer'],
    onlineTransferLabel: 'Online Transfer',
  });

  assert.match(reply, /credit card|card/i);
  assert.match(reply, /PayPal/i);
  assert.match(reply, /not available|not supported|only/i);
  assert.match(reply, /COD/i);
  assert.match(reply, /Online Transfer/i);
});

async function runPreOrderVariantChange() {
  const { handle_place_order: handlePlaceOrder } = loadOrderHandlers();
  const product = {
    id: 1,
    name: 'Oversized Casual Top',
    brand: 'Happybuy',
    stock: 10,
    sizes: 'S,M,L',
    colors: 'Black,White',
    inventory: { availableQty: 10 },
    variants: [
      { id: 1, size: 'M', color: 'Black', inventory: { availableQty: 2 } },
      { id: 6, size: 'L', color: 'White', inventory: { availableQty: 2 } },
    ],
    colorImages: [],
    creatives: [],
  };
  const previousDraft = {
    productId: 1,
    productName: product.name,
    brand: product.brand,
    variantId: 1,
    quantity: 1,
    size: 'M',
    color: 'Black',
    price: 1750,
    deliveryCharge: 0,
    total: 1750,
    paymentMethod: 'COD',
    giftWrap: false,
    deliveryEstimate: '2-3 business days',
    name: '',
    address: '',
    streetAddress: '',
    city: '',
    district: '',
    phone: '',
  };
  const nextDraft = {
    ...previousDraft,
    variantId: 6,
    size: 'L',
    color: 'White',
  };

  return handlePlaceOrder({
    aiAction: {
      action: 'place_order',
      productName: product.name,
      size: 'L',
      color: 'White',
      quantity: null,
    },
    products: [product],
    state: {
      pendingStep: 'contact_collection',
      orderDraft: previousDraft,
    },
    helpers: {
      buildDraftFromSource: () => nextDraft,
      findProductByName: () => product,
      finalizeReply: async (params) => params,
      clearPendingConversationState: (state) => state,
    },
  });
}

test('pre-order variant change remains stored while contact details are missing', async () => {
  const result = await runPreOrderVariantChange();

  assert.equal(result.nextState.orderDraft.size, 'L');
  assert.equal(result.nextState.orderDraft.color, 'White');
  assert.equal(result.nextState.orderDraft.variantId, 6);
  assert.equal(result.nextState.pendingStep, 'contact_collection');
});

test('pre-order variant change is acknowledged before repeating the contact prompt', async () => {
  const result = await runPreOrderVariantChange();

  assert.match(result.reply, /updated|changed/i);
  assert.match(result.reply, /White/i);
  assert.match(result.reply, /\bL\b/);
  assert.match(result.reply, /To proceed with the order, please share:/i);
});
