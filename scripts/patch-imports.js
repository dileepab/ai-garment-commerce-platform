/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

function patch(file) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(
    "import { ChatContext } from './types';", 
    "import { ChatContext } from './types';\nimport { updateOrderGiftInstructions, upsertCustomerContact } from '../chat-orchestrator';"
  );
  fs.writeFileSync(file, content);
}

patch('src/lib/chat-orchestrator/info.ts');
patch('src/lib/chat-orchestrator/orders.ts');
