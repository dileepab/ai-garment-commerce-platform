/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const BOT_TRAINING_FILE = path.join(__dirname, '..', 'src', 'lib', 'bot-training.ts');
const LANGUAGE_FILE = path.join(__dirname, '..', 'src', 'lib', 'chat', 'language.ts');

function transpile(filePath) {
  const ts = require('typescript');
  const source = fs.readFileSync(filePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  });
  return result.outputText;
}

function loadModule(filePath, replacements = {}) {
  const code = transpile(filePath);
  const m = new Module(filePath);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalRequire = m.require.bind(m);
  m.require = (req) => {
    if (replacements[req]) return replacements[req];
    return originalRequire(req);
  };
  m._compile(code, filePath);
  return m.exports;
}

const languageModule = loadModule(LANGUAGE_FILE, {
  '@/lib/app-log': {
    logDebug: () => {},
    logError: () => {},
    logWarn: () => {},
  },
});
const training = loadModule(BOT_TRAINING_FILE, {
  '@/lib/chat/language': languageModule,
  '@/lib/prisma': {},
});

assert.equal(
  training.matchesBotTrainingRule({ matchType: 'contains', pattern: 'cod' }, 'COD thiyanawada?'),
  true
);
assert.equal(
  training.matchesBotTrainingRule({ matchType: 'exact', pattern: 'cod available?' }, 'COD available?'),
  true
);
assert.equal(
  training.matchesBotTrainingRule({ matchType: 'exact', pattern: 'cod available?' }, 'is COD available?'),
  false
);
assert.equal(
  training.matchesBotTrainingRule({ matchType: 'keywords', pattern: 'kurunegala, delivery' }, 'How many days for delivery to Kurunegala?'),
  true
);

const signals = training.summarizeTrainingQuestionSignals([
  { message: 'COD available?', channel: 'messenger', createdAt: new Date('2026-05-30T10:00:00Z') },
  { message: 'cod available?', channel: 'messenger', createdAt: new Date('2026-05-30T11:00:00Z') },
  { message: 'hi', channel: 'messenger', createdAt: new Date('2026-05-30T12:00:00Z') },
]);

assert.equal(signals.length, 1);
assert.equal(signals[0].count, 2);
assert.equal(signals[0].language, 'english');

console.log('Bot training tests passed');
