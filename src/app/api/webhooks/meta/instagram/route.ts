import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';

// Meta uses the exact same verification standard for Instagram webhooks
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new NextResponse(challenge, { status: 200 });
    } else {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  return new NextResponse('Bad Request', { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // IG webhooks follow a slightly different messaging shape natively, but still tied to 'instagram' object types
    if (body.object === 'instagram') {
       for (const entry of body.entry) {
          // Check for messaging fields
          if (entry.messaging) {
            const webhookEvent = entry.messaging[0];
            const senderId = webhookEvent.sender.id;
            
            if (webhookEvent.message && webhookEvent.message.text) {
              const messageText = webhookEvent.message.text;
              
              console.log(`[Instagram Webhook] Message from ${senderId}: ${messageText}`);
              
              // Forward this to internal /api/ai/messages logic, then POST to IG Graph API to respond
            }
          }
       }
       return NextResponse.json({ success: true, message: "EVENT_RECEIVED" }, { status: 200 });
    }
    
    return NextResponse.json({ success: false }, { status: 404 });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
