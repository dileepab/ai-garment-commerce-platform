/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

const originalFile = fs.readFileSync('src/lib/chat-orchestrator.ts', 'utf-8');

// The main goal of this script is just to print the line numbers for each case to verify our approach
const cases = [
  'greeting', 'catalog_list', 'product_question', 'size_chart', 'place_order',
  'confirm_pending', 'cancel_order', 'reorder_last', 'order_status', 'order_details',
  'update_order_quantity', 'delivery_question', 'payment_question', 'exchange_question',
  'gift_request', 'support_contact_request', 'thanks_acknowledgement', 'fallback'
];

cases.forEach(c => {
  const match = originalFile.indexOf(`case '${c}': {`);
  if (match !== -1) {
    const linesBefore = originalFile.substring(0, match).split('\n').length;
    console.log(`Found ${c} at line ${linesBefore}`);
  } else {
    console.log(`Did not find ${c}`);
  }
});
