import { GoogleGenAI } from '@google/genai';
import prisma from '@/lib/prisma';
import {
  cleanStoredContactValue,
  collectContactDetailsFromMessages,
  extractContactDetailsFromText,
  formatContactBlock,
  getMissingContactFields,
  mergeContactDetails,
} from '@/lib/contact-profile';
import { buildHumanSupportReply, buildSupportContactLineFromConfig } from '@/lib/customer-support';
import { logDebug, logError } from '@/lib/app-log';
import { getMerchantSettings, logRuntimeWarnings } from '@/lib/runtime-config';

const MODEL_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

const MAX_HISTORY = 20;

interface RecentChatMessage {
  role: string;
  message: string;
}

interface ModelError {
  status?: number;
  message?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as ModelError).status;
    return typeof status === 'number' ? status : undefined;
  }

  return undefined;
}

export async function getAiStockReply(
  customerMessage: string,
  senderId?: string,
  channel?: string,
  brandFilter?: string,
  customerName?: string,
  customerGender?: string,
  options?: {
    persistConversation?: boolean;
  }
) {
  try {
    logRuntimeWarnings('AI');
    const persistConversation = options?.persistConversation ?? true;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return "AI is currently offline. We have received your message and will assist you shortly!";
    }

    const ai = new GoogleGenAI({ apiKey });

    // 1. Fetch real-time products & variant inventory context
    const whereClause = brandFilter ? { brand: brandFilter } : {};
    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        inventory: true,
        variants: { include: { inventory: true } },
      },
    });

    const stockContext = products.map(p => {
      const activeVariants = p.variants.filter(v => (v.inventory?.availableQty ?? 0) > 0);
      if (activeVariants.length > 0) {
        // Show each in-stock variant so AI can answer "do you have black M?"
        const variantLines = activeVariants.map(
          v => `  • ${v.color} ${v.size}: ${v.inventory?.availableQty ?? 0} available`
        ).join('\n');
        return `- ${p.name} (Brand: ${p.brand}, Style: ${p.style}, Price: Rs ${p.price})\n${variantLines}`;
      }
      // Product has no in-stock variants — show product-level total
      return `- ${p.name} (Style: ${p.style}, Brand: ${p.brand}, Sizes: ${p.sizes}, Colors: ${p.colors}): ${p.inventory?.availableQty || 0} pieces available. Price: Rs ${p.price}`;
    }).join('\n');

    // 2. Fetch conversation history and customer profile if senderId is provided
    let chatHistory = '';
    let storedName = '';
    let storedPhone = '';
    let storedAddress = '';
    let previousMessages: RecentChatMessage[] = [];
    let existingCustomerId: number | null = null;

    if (senderId) {
      // Fetch chat history
      previousMessages = await prisma.chatMessage.findMany({
        where: { senderId },
        orderBy: { createdAt: 'desc' },
        take: MAX_HISTORY,
        select: {
          role: true,
          message: true,
        },
      });

      chatHistory = previousMessages.reverse().map(m =>
        `${m.role === 'user' ? 'Customer' : 'You (AI)'}: ${m.message}`
      ).join('\n');

      // Fetch customer profile
      const customer = await prisma.customer.findUnique({
        where: { externalId: senderId },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      if (customer) {
        existingCustomerId = customer.id;
        storedName = cleanStoredContactValue(customer.name);
        storedPhone = customer.phone || '';
        storedAddress = customer.orders[0]?.deliveryAddress || '';
        logDebug('AI', `Loaded stored profile for sender ${senderId}.`);
      }

      const detailsFromHistory = collectContactDetailsFromMessages(previousMessages, {
        name: storedName || customerName,
        address: storedAddress,
        phone: storedPhone,
      });

      const missingBeforeCurrentMessage = getMissingContactFields(detailsFromHistory);
      const currentMessageDetails = extractContactDetailsFromText(
        customerMessage,
        missingBeforeCurrentMessage.length === 1 ? missingBeforeCurrentMessage[0] : undefined
      );

      const mergedDetails = mergeContactDetails(detailsFromHistory, currentMessageDetails);
      storedName = mergedDetails.name;
      storedPhone = mergedDetails.phone;
      storedAddress = mergedDetails.address;

      const profileName = storedName || cleanStoredContactValue(customerName);

      if (existingCustomerId) {
        const nextName = storedName || profileName;
        const nextPhone = storedPhone || null;

        if (nextName !== customer?.name || nextPhone !== customer?.phone) {
          await prisma.customer.update({
            where: { id: existingCustomerId },
            data: {
              name: nextName || customer?.name || '',
              phone: nextPhone,
              channel: channel || customer?.channel || 'web',
            },
          });
        }
      } else if (profileName || storedPhone) {
        const createdCustomer = await prisma.customer.create({
          data: {
            externalId: senderId,
            name: profileName || '',
            phone: storedPhone || null,
            channel: channel || 'web',
          },
        });

        existingCustomerId = createdCustomer.id;
      }

      // Save the new customer message
      if (persistConversation) {
        await prisma.chatMessage.create({
          data: {
            senderId,
            channel: channel || 'web',
            role: 'user',
            message: customerMessage,
          }
        });
      }
    }

    // 3. Build system instructions
    const nameToUse = cleanStoredContactValue(storedName || customerName || '');
    const firstName = nameToUse.split(' ')[0] || '';

    const profileMemory = formatContactBlock({
      name: nameToUse,
      address: storedAddress,
      phone: storedPhone,
    });

    const missingContactFields = getMissingContactFields({
      name: nameToUse,
      address: storedAddress,
      phone: storedPhone,
    });

    const missingContactInstructions =
      missingContactFields.length > 0
        ? `CURRENT CONTACT GAPS: ${missingContactFields.join(', ')}. If the customer is ordering, ask for exactly these missing fields together in one message.`
        : 'CURRENT CONTACT GAPS: none. If the customer is ordering, do not ask for name, address, or phone again. Show the saved contact block and ask the customer to confirm or correct it.';

    const customerInfo = firstName
      ? `\nCUSTOMER INFO:\n- Name: ${firstName}\n- Gender hint: ${customerGender || 'unknown'}\n- Use their first name in the FIRST greeting only if it feels natural.\n- After the first greeting, use neutral professional wording.`
      : '';

    const storeName = brandFilter || 'our store';
    const settings = await getMerchantSettings(brandFilter);
    const supportContactLine = buildSupportContactLineFromConfig(settings.support);

    const systemPrompt = `You are Nisha, a professional customer service representative for ${storeName}, an online clothing store in Sri Lanka. You respond to customers on social media with professionalism and warmth.
${customerInfo}

PROFILE MEMORY (From Database):
${profileMemory}

${missingContactInstructions}

CRITICAL BRAND RULE:
- You work ONLY for ${storeName}. You do NOT know about any other clothing stores.
- NEVER mention any other brand names or stores.
- If asked about other brands, politely say you only handle ${storeName} products.

PERSONALITY:
- Professional, polite, and helpful — like a well-trained online store agent.
- Warm but not overly casual. Think premium customer service.
- Use proper sentences, no slang.
- If the customer's gender is unknown, use neutral professional wording with no title. Never use "Madam/Sir".
- Do not greet twice in the same reply.
- Emojis only at the end of confirmations (e.g. ✅), never excessively.

LANGUAGE RULE:
- Detect the customer's language from their message.
- If the customer writes in Sinhala (සිංහල), reply entirely in Sinhala using natural, conversational Sinhala script.
- If the customer writes in Tamil (தமிழ்), reply entirely in Tamil.
- If the customer writes in English, reply in English.
- Always mirror the customer's language. Never switch languages mid-conversation unless the customer does.
- If the language is ambiguous or mixed, reply in the language that appears dominant. If truly unclear, ask a short clarification in Sinhala first (as it is the most common local language), e.g. "ඔබ සිංහලෙන් කතා කරනවාද? / Would you prefer English?"
- Product names, order IDs, and prices should always use their original form (e.g. "Rs 1650") regardless of language.

CONVERSION & FOLLOW-UP RULES:
- Never leave a message hanging. ALWAYS end with a helpful, low-friction question to drive the sale.
- IF CUSTOMER ASKS PRICE/AVAILABILITY: Answer directly, then follow up with: "Would you like to see the size chart?" or "Shall I check if we can deliver this to your area by tomorrow?"
- IF STOCK IS LOW (< 5 pieces): Create subtle urgency, e.g., "Only 3 pieces left in this color! Should I reserve one for you while you decide?"
- IF CUSTOMER IS UNDECIDED: Offer a benefit, e.g., "This fabric is perfect for the current weather. Would you like to see more close-up photos?"
- IF ORDERING: Instead of just asking for details, use: "To get this delivered to you quickly, could you share your name, address, and phone number?"

YOUR STOCK (use ONLY this data):
${stockContext}

${chatHistory ? `RECENT CHAT:\n${chatHistory}\n` : ''}

ORDER FLOW & DATA COLLECTION:
1. CUSTOMER WANTS TO BUY: 
   - Check PROFILE MEMORY above before asking anything.
   - When Name, Address, or Phone Number are missing, ask for ALL missing fields in ONE short message.
   - Use these exact labels on separate lines and only include the fields that are still missing:
Name:
Address:
Phone Number:
   - If the customer replies with only some of them, ask again for ONLY the remaining missing fields using the same label format.
   - If all three details are already known, do NOT ask again. Move straight to the confirmation step.

2. DATA CORRECTION:
   - If the customer provides a detail that differs from PROFILE MEMORY, update your understanding and use the NEW information immediately.
   - After any correction, show the full contact block again so the customer can verify it.

3. CONTACT CONFIRMATION BLOCK:
   - Before finalizing an order, show this exact plain-text block with one field per line:
Name: [customer name]
Address: [delivery address]
Phone Number: [phone number]
   - Then ask the customer to confirm these details or send corrections.
   - Never use bullets, tables, markdown boxes, or decorative separators for this contact block.

4. FINAL CONFIRMATION (MANDATORY):
   Once you have all details (Product, Quantity, Size, Color, Name, Address, Phone), display this EXACT summary:

Order Summary
Product: [product name]
Quantity: [quantity]
Size: [size]
Color: [color]
Price: Rs [price]
Name: [customer name]
Address: [delivery address]
Phone Number: [phone number]

Then ask: "Does everything look perfect? Shall I go ahead and confirm this for you so we can dispatch it as soon as possible? 😊"

5. COMPLETION:
   - If they say "Yes" or similar, confirm the order is successfully placed.

IMPORTANT:
- Keep messages SHORT (1-3 sentences), except for the Order Summary.
- Don't repeat yourself. If we already have Name, Address, and Phone Number, show them and ask for confirmation instead of asking again.
- If only one field is missing, ask only for that field.
- When contact details are complete, always show the plain-text contact block before the final order summary.
- Answer the customer's exact question first. Do not ignore a question about size chart, delivery charges, payment, exchange, or delivery timing.
- For delivery deadline questions, give a direct yes/no answer first. Use business-day wording, exclude weekends and Sri Lankan public holidays, and never promise prioritization or an impossible date.
- If the customer asks for a size chart and the item is not clear, ask which item they want the chart for.
- If the item is clear, say you will send the correct size chart. Do not claim that no size chart exists.
- If an order is already confirmed, speak about it as an existing order. Do not ask the customer to proceed or place the order again.
- Never state a live order status unless it was retrieved by the system. If the customer asks for order status and you are unsure, say you will check rather than guessing.
- Never say you are "currently checking the system" or ask the customer to wait "a moment" for a status lookup. Either provide the retrieved result or say the status could not be verified yet.
- Never claim that an order was placed, confirmed, cancelled, deleted, or re-ordered unless the customer already received a system message containing "Order ID:" or "Cancelled Order ID:".
- Never claim that an order quantity was updated, reopened, restored, or changed unless the customer already received a system-generated update summary or success message for that action.
- If the customer asks to cancel, delete, replace, or re-order and you do not have a system confirmation yet, explain the next step, but do not say the action is already completed.
- If the customer explicitly asks for a human, says the reply is unclear, or has a serious complaint, it is acceptable to direct them to real support using this contact line: ${supportContactLine}`;

    const requestParams = {
      contents: customerMessage,
      config: {
        systemInstruction: systemPrompt,
      }
    };

    // 4. Fallback chain: try each model in order
    let reply = buildHumanSupportReply({
      reason: 'unclear_request',
      supportConfig: settings.support,
    });

    for (let i = 0; i < MODEL_CHAIN.length; i++) {
      const model = MODEL_CHAIN[i];
      try {
        logDebug('AI', `Trying model ${model}.`);
        const response = await ai.models.generateContent({
          model,
          ...requestParams,
        });
        logDebug('AI', `Model ${model} responded successfully.`);
        reply = response.text || reply;
        break;
      } catch (error: unknown) {
        const status = getErrorStatus(error);
        if ((status === 429 || status === 503 || status === 404) && i < MODEL_CHAIN.length - 1) {
          logDebug('AI', `${model} returned ${status}; falling back to ${MODEL_CHAIN[i + 1]}.`);
          continue;
        }
        throw error;
      }
    }

    // 5. Save AI reply to conversation history
    if (persistConversation && senderId) {
      await prisma.chatMessage.create({
        data: {
          senderId,
          channel: channel || 'web',
          role: 'assistant',
          message: reply,
        }
      });
    }

    return reply;
  } catch (error: unknown) {
    logError('AI', 'Failed to generate AI stock reply.', error);
    return getErrorMessage(error) === 'fetch failed'
      ? buildHumanSupportReply({
          reason: 'unclear_request',
        })
      : buildHumanSupportReply({
          reason: 'unclear_request',
        });
  }
}

export async function getAiCommentReply(
  comment: string,
  brand?: string
) {
  try {
    logRuntimeWarnings('AI Comment');
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return "Hi 😊 Please check inbox for full details.";
    }

    const ai = new GoogleGenAI({ apiKey });

    // 1. Fetch real-time products & variant inventory context
    const whereClause = brand ? { brand } : {};
    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        inventory: true,
        variants: { include: { inventory: true } },
      },
    });

    const stockContext = products.map(p => {
      const activeVariants = p.variants.filter(v => (v.inventory?.availableQty ?? 0) > 0);
      if (activeVariants.length > 0) {
        const variantSummary = activeVariants
          .map(v => `${v.color} ${v.size}`)
          .join(', ');
        const total = activeVariants.reduce((sum, v) => sum + (v.inventory?.availableQty ?? 0), 0);
        return `- ${p.name}: Rs ${p.price} | Style: ${p.style} | Available variants: ${variantSummary} | Total stock: ${total}`;
      }
      return `- ${p.name}: Rs ${p.price} | Style: ${p.style} | Sizes: ${p.sizes} | Colors: ${p.colors} | Stock: ${p.inventory?.availableQty || 0} available`;
    }).join('\n');

    const brandName = brand || 'our store';

    const systemPrompt = `You are an AI sales assistant for a Sri Lankan women’s clothing brand.
Your goal: Convert social media comments into direct messages and sales.

---
Context:
Brand: ${brandName}
Catalog Content:
${stockContext}

---
Instructions:
- Reply in the SAME language as the customer (Sinhala / Tamil / English)
- Keep reply SHORT (max 1–2 sentences)
- Friendly and natural tone
- If asking price → include price from Catalog Content
- If asking size → mention available sizes from Catalog Content
- If asking availability → mention stock from Catalog Content
- If unclear → give general helpful reply

Rules:
- ALWAYS encourage DM (e.g. "Check inbox", "Inbox for details"). Use high-conversion CTAs.
- EXAMPLE CTA: "Sent more photos to your inbox! Shall I check your size for you?", "Details sent to DM. We only have few pieces left!"
- DO NOT hallucinate or guess missing data. If the specific product is not clear from the comment, give a general store reply.
- DO NOT give long explanations
- DO NOT mention AI
- Use simple emojis if appropriate (😊😍)

Fallback:
If product/price/stock context for the specific query is unknown:
Reply: "Hi 😊 I've sent our latest collection to your DM. You'll love the new designs!"

Output:
ONLY the final reply text`;

    const requestParams = {
      contents: `Customer Comment: "${comment}"`,
      config: {
        systemInstruction: systemPrompt,
      }
    };

    let reply = "Hi 😊 Please check inbox for full details.";

    for (const model of MODEL_CHAIN) {
      try {
        logDebug('AI Comment', `Trying model ${model}.`);
        const response = await ai.models.generateContent({
          model,
          ...requestParams,
        });
        logDebug('AI Comment', `Model ${model} responded successfully.`);
        reply = response.text || reply;
        break;
      } catch (error: unknown) {
        const status = getErrorStatus(error);
        if ((status === 429 || status === 503 || status === 404) && MODEL_CHAIN.indexOf(model) < MODEL_CHAIN.length - 1) {
          continue;
        }
        throw error;
      }
    }

    return reply;
  } catch (error: unknown) {
    logError('AI Comment', 'Failed to generate AI comment reply.', error);
    return "Hi 😊 Please check inbox for full details.";
  }
}
