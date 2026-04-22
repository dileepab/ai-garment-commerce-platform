/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

let typesFile = fs.readFileSync('src/lib/ai-router/types.ts', 'utf-8');
typesFile = typesFile.replace(
  "'gift_request',\\n  'fallback',",
  "'gift_request',\\n  'support_contact_request',\\n  'thanks_acknowledgement',\\n  'fallback',"
);
fs.writeFileSync('src/lib/ai-router/types.ts', typesFile);

let promptFile = fs.readFileSync('src/lib/ai-router/prompt.ts', 'utf-8');
promptFile = promptFile.replace(
  "- gift_request: asking for gift wrap or gift note\\n- fallback: none of the above",
  "- gift_request: asking for gift wrap or gift note\\n- support_contact_request: asking for store contact number or support contact\\n- thanks_acknowledgement: general thank you, thanks, or simple appreciation\\n- fallback: none of the above"
);
fs.writeFileSync('src/lib/ai-router/prompt.ts', promptFile);
