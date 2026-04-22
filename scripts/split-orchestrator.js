/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

const content = fs.readFileSync('src/lib/chat-orchestrator.ts', 'utf-8');

// 1. Get imports block
const lastImportIdx = content.lastIndexOf('import ');
const endOfImports = content.indexOf('\n\n', lastImportIdx);
const importsBlockRaw = content.substring(0, endOfImports);

// Fix paths since the files are moving into a subfolder
const importsBlock = importsBlockRaw.replace(/from '\.\//g, "from '../");

// 2. Define the context definition that we will inject in a types file
const typesContent = `
${importsBlock}
import { AiRoutedAction } from '@/lib/ai-action-router';
import { CustomerMessageInput, CustomerMessageResult } from '../chat-orchestrator';

export type ChatContext = {
  input: CustomerMessageInput;
  state: any;
  customer: any;
  brandFilter: string | undefined;
  globalProducts: any[];
  products: any[];
  latestOrder: any;
  latestActiveOrder: any;
  latestAssistantText: string;
  explicitOrderId: number | null;
  requestedProductTypes: any[];
  followUpMissingOrderId: number | null;
  mergedContact: any;
  aiAction: AiRoutedAction;
  helpers: {
    findProductByName: (name: string | null) => any;
    findCustomerOrderById: (orderId?: number | null) => Promise<any>;
    buildDraftFromSource: (product: any, previousDraft?: any) => any;
    finalizeReply: (params: any) => Promise<CustomerMessageResult>;
    escalateToSupport: (reason: any, orderId?: number | null) => Promise<CustomerMessageResult>;
    clearPendingConversationState: (state: any) => any;
  };
};
`;

fs.writeFileSync('src/lib/chat-orchestrator/types.ts', typesContent);

// 3. Extract the cases
const cases = [
  'greeting', 'catalog_list', 'product_question', 'size_chart', 'place_order',
  'confirm_pending', 'cancel_order', 'reorder_last', 'order_status', 'order_details',
  'update_order_quantity', 'delivery_question', 'payment_question', 'exchange_question',
  'gift_request', 'support_contact_request', 'thanks_acknowledgement', 'fallback'
];

let switchStartIdx = content.indexOf('switch (effectiveAction) {\n');
const restOfSwitch = content.substring(switchStartIdx + 'switch (effectiveAction) {\n'.length);

const chunks = {};
cases.forEach((c, idx) => {
  const caseHeader = `case '${c}': {`;
  const nextCaseHeader = idx < cases.length - 1 ? `case '${cases[idx+1]}': {` : null;
  
  const start = restOfSwitch.indexOf(caseHeader);
  if (start === -1) {
    if (c === 'fallback') {
       chunks[c] = `  return ctx.helpers.finalizeReply({ reply: "I'm sorry, I didn't quite catch that." });`;
    }
    return;
  }
  
  let end = nextCaseHeader ? restOfSwitch.indexOf(nextCaseHeader) : restOfSwitch.lastIndexOf('  }\n}');
  
  if (start !== -1 && end !== -1) {
      let body = restOfSwitch.substring(start + caseHeader.length, end).trim();
      if (body.endsWith('break;')) body = body.substring(0, body.length - 6).trim();
      if (body.endsWith('}')) body = body.substring(0, body.length - 1).trim();
      
      const destructure = `  const {
    input, state, customer, brandFilter, globalProducts, products,
    latestOrder, latestActiveOrder, latestAssistantText, explicitOrderId,
    requestedProductTypes, followUpMissingOrderId, mergedContact, aiAction
  } = ctx;
  const {
    findProductByName, findCustomerOrderById, buildDraftFromSource,
    finalizeReply, escalateToSupport, clearPendingConversationState
  } = ctx.helpers;
  `;
      chunks[c] = destructure + '\n  ' + body;
  }
});

// 4. Generate grouped handler files
const groups = {
  catalog: ['catalog_list', 'product_question', 'size_chart'],
  orders: ['place_order', 'confirm_pending', 'cancel_order', 'reorder_last', 'update_order_quantity'],
  info: ['greeting', 'order_status', 'order_details', 'delivery_question', 'payment_question', 'exchange_question', 'gift_request', 'support_contact_request', 'thanks_acknowledgement', 'fallback']
};

Object.entries(groups).forEach(([groupName, groupCases]) => {
  let fileContent = `${importsBlock}\nimport { ChatContext } from './types';\n\n`;
  
  groupCases.forEach(c => {
    if (chunks[c]) {
      fileContent += `export async function handle_${c}(ctx: ChatContext) {\n${chunks[c]}\n}\n\n`;
    }
  });
  
  fs.writeFileSync(`src/lib/chat-orchestrator/${groupName}.ts`, fileContent);
});

// 5. Rewrite chat-orchestrator.ts cleanly!
let beforeImports = content.substring(0, endOfImports);
let afterImports = content.substring(endOfImports);

const newImports = `\nimport { ChatContext } from './chat-orchestrator/types';\nimport * as CatalogHandlers from './chat-orchestrator/catalog';\nimport * as OrderingHandlers from './chat-orchestrator/orders';\nimport * as InfoHandlers from './chat-orchestrator/info';\n`;

let rewritten = beforeImports + newImports + afterImports;

// Re-evaluate switch index since we added imports
switchStartIdx = rewritten.indexOf('switch (effectiveAction) {\n');
let topBlock = rewritten.substring(0, switchStartIdx);

let ctxBuilder = `  const ctx: ChatContext = {
    input, state, customer, brandFilter, globalProducts, products,
    latestOrder, latestActiveOrder, latestAssistantText, explicitOrderId,
    requestedProductTypes, followUpMissingOrderId, mergedContact, aiAction,
    helpers: {
      findProductByName, findCustomerOrderById, buildDraftFromSource,
      finalizeReply, escalateToSupport, clearPendingConversationState
    }
  };
`;

let newSwitch = ctxBuilder + '\n  switch (effectiveAction) {\n';

cases.forEach(c => {
  let group;
  if (groups.catalog.includes(c)) group = 'CatalogHandlers';
  else if (groups.orders.includes(c)) group = 'OrderingHandlers';
  else group = 'InfoHandlers';
  
  newSwitch += `    case '${c}': return ${group}.handle_${c}(ctx);\n`;
});

topBlock += newSwitch + '  }\n}\n';

fs.writeFileSync('src/lib/chat-orchestrator.ts', topBlock);

console.log("Refactor script executed successfully.");
