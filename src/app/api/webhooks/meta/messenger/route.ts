import { NextResponse } from 'next/server';
import { sendMessengerImage, sendMessengerMessage, getUserProfile } from '@/lib/meta';
import { getErrorMessage } from '@/lib/error-message';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';

const IS_CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === '1';

// Map each Facebook Page ID to its brand
// Add your Page IDs here once you connect each page
function getPageBrand(pageId: string): string | null {
  const PAGE_BRAND_MAP: Record<string, string> = {};
  
  // Load from environment variables
  if (process.env.HAPPYBY_PAGE_ID) PAGE_BRAND_MAP[process.env.HAPPYBY_PAGE_ID] = 'Happyby';
  if (process.env.CLEOPATRA_PAGE_ID) PAGE_BRAND_MAP[process.env.CLEOPATRA_PAGE_ID] = 'Cleopatra';
  if (process.env.MODABELLA_PAGE_ID) PAGE_BRAND_MAP[process.env.MODABELLA_PAGE_ID] = 'Modabella';

  return PAGE_BRAND_MAP[pageId] || null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Meta Webhook] Verification successful.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.log('[Meta Webhook] Verification failed.');
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  return new NextResponse('Bad Request', { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.object === 'page') {
       for (const entry of body.entry) {
          if (!entry.messaging) continue;
          
          // Detect which Facebook Page received the message
          const pageId = entry.id;
          const brand = getPageBrand(pageId);
          
          const webhookEvent = entry.messaging[0];
          const senderId = webhookEvent.sender.id;
          
          if (webhookEvent.message && webhookEvent.message.text) {
             const messageText = webhookEvent.message.text;
             console.log(`[Meta Webhook] Page: ${brand || 'unknown'} | From ${senderId}: ${messageText}`);
             
             // Fetch customer's Facebook profile for personalization
             const profile = IS_CHAT_TEST_MODE ? null : await getUserProfile(senderId);
             const customerName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : undefined;
             const customerGender = profile?.gender;

             const result = await routeCustomerMessage({
               senderId,
               channel: 'messenger',
               currentMessage: messageText,
               brand: brand || undefined,
               customerName,
               customerGender,
             });

             if (!IS_CHAT_TEST_MODE) {
               await sendMessengerMessage(senderId, result.reply);

               if (result.imagePaths?.length) {
                 for (const imagePath of result.imagePaths) {
                   await sendMessengerImage(senderId, imagePath);
                 }
               } else if (result.imagePath) {
                 await sendMessengerImage(senderId, result.imagePath);
               }
             }
          }
       }
       return NextResponse.json({ success: true, message: "EVENT_RECEIVED" }, { status: 200 });
    }
    
    return NextResponse.json({ success: false }, { status: 404 });
  } catch (error: unknown) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
