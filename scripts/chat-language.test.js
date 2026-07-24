/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const LANGUAGE_FILE = path.join(__dirname, '..', 'src', 'lib', 'chat', 'language.ts');

function loadLanguageModule() {
  const ts = require('typescript');
  const source = fs.readFileSync(LANGUAGE_FILE, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: LANGUAGE_FILE,
  });
  const moduleInstance = new Module(LANGUAGE_FILE);
  moduleInstance.filename = LANGUAGE_FILE;
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(LANGUAGE_FILE));
  const originalRequire = moduleInstance.require.bind(moduleInstance);
  moduleInstance.require = (request) => {
    if (request === '@/lib/app-log') {
      return { logDebug: () => {}, logError: () => {}, logWarn: () => {} };
    }
    return originalRequire(request);
  };
  moduleInstance._compile(result.outputText, LANGUAGE_FILE);
  return moduleInstance.exports;
}

const {
  buildLanguagePreferenceAcknowledgement,
  detectCustomerScriptStyle,
  formatConversationHistoryForPrompt,
  localizeReplyWithGemini,
} = loadLanguageModule();
const newestFirst = Array.from({ length: 10 }, (_, index) => ({
  role: index % 2 === 0 ? 'assistant' : 'user',
  message: `message-${10 - index}`,
}));

const formatted = formatConversationHistoryForPrompt(newestFirst);
const formattedLines = formatted.split('\n');

assert(!formattedLines.some((line) => line.endsWith('message-1')));
assert(!formattedLines.some((line) => line.endsWith('message-2')));
assert(formatted.indexOf('message-3') < formatted.indexOf('message-10'));
assert.equal(formattedLines.length, 8);
assert.match(formatted, /^Customer: message-3/);
assert.match(formatted, /Assistant: message-10$/);

assert.equal(detectCustomerScriptStyle('COD thiyanawada?', 'sinhala'), 'roman');
assert.equal(detectCustomerScriptStyle('COD තියෙනවද?', 'sinhala'), 'native');
assert.equal(
  buildLanguagePreferenceAcknowledgement('sinhala', 'roman'),
  'Ow, puluwan. Methanin passe mama Roman Sinhala walin help karannam.'
);

async function run() {
  const romanDelivery = await localizeReplyWithGemini(
    'Delivery to Negombo costs Rs 450. Delivery to Negombo usually takes 2-3 business days, excluding weekends and Sri Lankan public holidays. If the order is confirmed on July 24, 2026, the expected delivery window is July 28, 2026 to July 30, 2026.\n\nYes, COD works for us. Available payment methods are COD and Online Transfer.',
    'sinhala',
    'roman'
  );

  assert.match(romanDelivery, /Negombo walata delivery charge eka Rs 450/);
  assert.match(romanDelivery, /Ow, COD puluwan/);
  assert.doesNotMatch(romanDelivery, /[\u0D80-\u0DFF]/);

  const romanVariantUpdate = await localizeReplyWithGemini(
    "Got it — I've updated the selection to size L.\n\nPlease let me know the color you need for Breezy Summer Dress. Available colors: Coral, Sage.",
    'sinhala',
    'roman'
  );
  assert.match(romanVariantUpdate, /selection eka size L walata update kala/);
  assert.match(romanVariantUpdate, /ona color eka kiyannako/);
  assert.doesNotMatch(romanVariantUpdate, /[\u0D80-\u0DFF]/);

  const nativeSinhalaFabric = await localizeReplyWithGemini(
    'Pleated Midi Skirt:\nFabric: Crepe',
    'sinhala',
    'native'
  );
  assert.match(nativeSinhalaFabric, /රෙදි වර්ගය: Crepe/);
  assert.doesNotMatch(nativeSinhalaFabric, /Fabric:/);

  const romanTamilFabric = await localizeReplyWithGemini(
    'Pleated Midi Skirt:\nFabric: Crepe',
    'tamil',
    'roman'
  );
  assert.match(romanTamilFabric, /Thuni: Crepe/);
  assert.doesNotMatch(romanTamilFabric, /Fabric:/);
  console.log('Chat language history and script-style tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
