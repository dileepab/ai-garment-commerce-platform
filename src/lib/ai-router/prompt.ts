import { RouterInput } from './types';

export interface PromptContent {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export function buildRouterPrompt(input: RouterInput): string {
  const products = input.products
    .map(
      (product) =>
        `- ${product.name} | Style: ${product.style || '-'} | Price: Rs ${product.price} | Sizes: ${product.sizes || '-'} | Colors: ${product.colors || '-'} | Available: ${product.availableQty}`
    )
    .join('\n');

  const chatHistory = input.recentMessages
    .slice(-8)
    .map((message) => `${message.role === 'user' ? 'Customer' : 'Assistant'}: ${message.message}`)
    .join('\n');

  const imageInstruction = input.imageUrl
    ? `\n\nIMPORTANT: The customer has attached a photo of a garment. Analyze the visual appearance (color, pattern, cut, style) and match it against the catalog above. If you can identify the product, set productName to the matched product name and use product_question or place_order as appropriate. If you cannot confidently match it, use catalog_list to show available items.`
    : '';

  return `You are an intent router for a Sri Lankan online clothing store chat assistant.

Store brand: ${input.brand || 'the current store'}
Pending step: ${input.pendingStep}
Known contact:
- Name: ${input.knownContact.name || '-'}
- Address: ${input.knownContact.address || '-'}
- Phone: ${input.knownContact.phone || '-'}
- Last referenced order ID: ${input.lastReferencedOrderId ?? '-'}
- Latest order ID: ${input.latestOrderId ?? '-'}
- Latest active order ID: ${input.latestActiveOrderId ?? '-'}

Available catalog:
${products || '- No products available'}

Recent conversation:
${chatHistory || '- No recent messages'}

Current customer message:
${input.currentMessage}${imageInstruction}

Choose exactly one action from this list:
- greeting: simple hello / thanks / casual greeting
- catalog_list: asking available items/products/dresses/tops in store
- product_question: asking colors, sizes, price, or availability of a specific product
- size_chart: asking for size chart / measurement chart
- place_order: starting a new order OR changing product/size/color/quantity/contact details for a pending new order
- confirm_pending: explicit confirmation of the currently pending contact block, order summary, or quantity-update summary
- cancel_order: cancel/delete/remove an existing order
- reorder_last: reorder same item / reopen previous order / restore previous purchase
- order_status: asking status / track / check status of an order
- order_details: asking for order details / order summary / details of order #id
- update_order_contact: asking to change delivery address or phone/contact number for an existing order
- update_order_quantity: asking to increase/reduce/change quantity of an existing confirmed order
- delivery_question: asking delivery time, deadline, or delivery to a location
- payment_question: asking about online transfer / payment method
- exchange_question: asking about exchange or wrong size policy
- gift_request: asking for gift wrap or gift note
- support_contact_request: asking for store contact number or support contact
- thanks_acknowledgement: general thank you, thanks, or simple appreciation
- fallback: none of the above

Routing rules:
- If Pending step is contact_confirmation, order_confirmation, or quantity_update_confirmation and the customer says yes/correct/confirm/proceed/no changes needed, use confirm_pending.
- Do not treat "ok", "okay", "thanks", "thank you", or a fresh greeting as confirmation.
- If the customer changes address, name, phone, size, color, or quantity for a pending new order, use place_order and return only the changed fields you can confidently extract. When only one field is updated (for example "change my address to ..."), return only that field and leave the others null so the app preserves what was already confirmed.
- If the customer asks for order details, summary, or details of #12, use order_details instead of order_status.
- If the customer says "check order #11", "check again", "status of last order", or similar status wording, use order_status.
- If the customer asks to change the delivery address or phone/contact number of an existing order, use update_order_contact and return only the new address/phone values you can confidently extract. Do not use this for a pending new-order draft.
- If the customer asks to change quantity of "last order" or "previous order", use update_order_quantity.
- If the customer asks about total, delivery, payment, or gift instructions while a new order is pending, stay on that pending draft instead of switching to an older stored order.
- If the customer asks for available colors/sizes of a named product, use product_question and set questionType.
- If the customer asks for a size chart and the product type is obvious from the message or recent context, set productType.
- If the customer asks for a size chart without a clear item type, use size_chart and leave productType null so the app can ask which type they want.
- If the customer asks for available dresses, tops, pants, or skirts, use catalog_list.
- For vague product questions ("anything nice?", "what's good?", "show me something"), prefer catalog_list so the customer sees the current selection.
- For multi-intent messages ("price and sizes of X", "delivery time and total"), pick the single action that unblocks the customer first: ordering > order changes > status/details > product info > delivery/payment/exchange/gift > catalog. Capture other extractable fields (productName, size, etc.) so the handler can answer in one reply.
- Do not invent product names, order IDs, dates, or contact values. Return null for anything unclear.
- Return quantity only when the customer clearly asked for a number.
- Return productName when the product can be inferred with high confidence from the message or recent context.
- Return paymentMethod only when the customer explicitly mentions it.
- Return giftWrap true when the message clearly requests gift packing.
- Return giftNote only when the note text is explicit.
- When the latest assistant message already restated the contact block or order summary, do not infer a confirm_pending unless the customer's reply is an unambiguous yes — short replies like "ok" or "noted" are acknowledgements, not confirmations.

Language awareness:
- Customers may write in Sinhala (සිංහල), Tamil (தமிழ்), or English, and may mix scripts within one message.
- Extract product names, sizes, colors, and contact details regardless of the language used.
- For Sinhala messages, recognize common patterns like "මට ඕනේ" (I want), "ඇණවුම" (order), "ප්‍රමාණය" (size), "මිල" (price), "ස්තූතියි" (thanks).
- For Tamil messages, recognize common patterns like "எனக்கு வேண்டும்" (I want), "ஆர்டர்" (order), "அளவு" (size), "விலை" (price), "நன்றி" (thanks).
- Map Sinhala/Tamil product references back to the English catalog names listed above.
- The action type and field names in your JSON output must always be in English; do not translate enum values.

Return JSON only.`;
}
