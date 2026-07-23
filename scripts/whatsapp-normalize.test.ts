import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractWhatsAppWebhook,
  normalizeWhatsAppMessage,
} from '../src/lib/whatsapp-normalize.ts';

test('normalizes WhatsApp text and interactive replies', () => {
  assert.deepEqual(
    normalizeWhatsAppMessage(
      {
        from: '94770000000',
        id: 'wamid.text-1',
        type: 'text',
        text: { body: '  What is available?  ' },
      },
      'phone-number-id-1',
    ),
    {
      eventId: 'whatsapp:phone-number-id-1:wamid.text-1',
      senderId: '94770000000',
      channel: 'whatsapp',
      pageOrAccountId: 'phone-number-id-1',
      messageText: 'What is available?',
      isEcho: false,
      isPostback: false,
    },
  );

  const interactive = normalizeWhatsAppMessage(
    {
      from: '94770000000',
      id: 'wamid.button-1',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'ORDER_SIZE|size=M',
          title: 'Medium',
        },
      },
    },
    'phone-number-id-1',
  );

  assert.equal(interactive?.messageText, 'M size');
  assert.equal(interactive?.postbackPayload, 'ORDER_SIZE|size=M');
  assert.equal(interactive?.isPostback, true);
});

test('extracts the Phone Number ID, customer name, image, and status callbacks', () => {
  const extracted = extractWhatsAppWebhook({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-id-must-not-be-used-for-routing',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '94714123777',
            phone_number_id: 'happybuy-phone-number-id',
          },
          contacts: [{ wa_id: '94770000000', profile: { name: 'Dileepa' } }],
          messages: [{
            from: '94770000000',
            id: 'wamid.image-1',
            type: 'image',
            image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'Do you have this?' },
          }],
          statuses: [{
            id: 'wamid.outbound-1',
            status: 'delivered',
            timestamp: '1784567890',
            recipient_id: '94770000000',
          }],
        },
      }],
    }],
  });

  assert.equal(extracted.messages.length, 1);
  assert.equal(extracted.messages[0]?.message.pageOrAccountId, 'happybuy-phone-number-id');
  assert.equal(extracted.messages[0]?.message.mediaId, 'media-1');
  assert.equal(extracted.messages[0]?.message.messageText, 'Do you have this?');
  assert.equal(extracted.messages[0]?.customerName, 'Dileepa');
  assert.equal(extracted.statuses.length, 1);
  assert.equal(extracted.statuses[0]?.status, 'delivered');
  assert.match(extracted.statuses[0]?.eventId ?? '', /status:delivered/);
});

test('does not route status-only callbacks or unsupported messages as customer text', () => {
  const extracted = extractWhatsAppWebhook({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'phone-number-id-1' },
          messages: [{ from: '94770000000', id: 'wamid.audio-1', type: 'audio' }],
          statuses: [{ id: 'wamid.outbound-1', status: 'read' }],
        },
      }],
    }],
  });

  assert.equal(extracted.messages.length, 0);
  assert.equal(extracted.unsupportedMessageCount, 1);
  assert.equal(extracted.statuses.length, 1);
});
