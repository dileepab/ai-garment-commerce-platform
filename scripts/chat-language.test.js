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

const { formatConversationHistoryForPrompt } = loadLanguageModule();
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

console.log('Chat language history tests passed');
