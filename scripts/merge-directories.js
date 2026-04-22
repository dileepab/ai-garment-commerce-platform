/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const srcDir = 'src/lib/chat-orchestrator';
const destDir = 'src/lib/chat';

try {
  const files = fs.readdirSync(srcDir);
  files.forEach(file => {
    fs.renameSync(path.join(srcDir, file), path.join(destDir, file));
  });

  fs.rmdirSync(srcDir);

  ['catalog.ts', 'info.ts', 'orders.ts', 'types.ts'].forEach(file => {
    const p = path.join(destDir, file);
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(/from '\.\.\/chat\//g, "from './");
    fs.writeFileSync(p, content);
  });

  const orchPath = 'src/lib/chat-orchestrator.ts';
  let orchContent = fs.readFileSync(orchPath, 'utf8');
  orchContent = orchContent.replace(/from '\.\/chat-orchestrator\//g, "from './chat/");
  fs.writeFileSync(orchPath, orchContent);
  console.log("Merge completed successfully via Node.");
} catch (e) {
  console.error("Error during merge: ", e);
}
