import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // ManyChat payloads vary depending on your request setup.
    // Example: { "subscriber_id": 1234, "message": "Hi", "channel": "messenger" }
    
    // 1. Extract customer message 
    const message = body.message || body.last_text;
    const subscriberId = body.subscriber_id;

    console.log(`[ManyChat Webhook] Received from ${subscriberId}: ${message}`);

    // 2. Here you would process the message via AI 
    // const aiReply = await getAiReply(message);
    
    // 3. Return response back to ManyChat so it can forward it to the user.
    return NextResponse.json({ 
        version: "v2",
        content: {
            messages: [
                {
                    type: "text",
                    text: `Echo back from Garment Platform AI: We received "${message}"`
                }
            ]
        }
    });

  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
