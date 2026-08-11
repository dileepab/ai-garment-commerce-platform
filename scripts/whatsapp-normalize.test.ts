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

/**
 * A Click-to-WhatsApp ad attaches this to the first message only. Dropping it
 * means the order that follows can never be tied back to the ad that paid for
 * it — Ads Manager reports conversations, the database reports orders, and
 * nothing joins the two.
 */
test('an ad click is captured off the first message', () => {
  const normalized = normalizeWhatsAppMessage(
    {
      from: '94770000000',
      id: 'wamid.ad-1',
      type: 'text',
      text: { body: 'Order HAP-0001' },
      referral: {
        source_type: 'ad',
        source_id: '120210000000000',
        source_url: 'https://fb.me/abc',
        headline: 'Tie-Strap Smocked Sundress',
        ctwa_clid: 'ARBxyz123',
      },
    },
    '555'
  );

  assert.equal(normalized?.messageText, 'Order HAP-0001');
  assert.deepEqual(normalized?.adReferral, {
    sourceType: 'ad',
    sourceId: '120210000000000',
    sourceUrl: 'https://fb.me/abc',
    headline: 'Tie-Strap Smocked Sundress',
    clickId: 'ARBxyz123',
  });
});

// An ad click can land as an image or a catalog cart just as easily as text.
test('an ad click on a non-text message is captured too', () => {
  const referral = { source_id: '1202', ctwa_clid: 'ARB' };

  const image = normalizeWhatsAppMessage(
    { from: '9477', id: 'wamid.img', type: 'image', image: { id: 'media-1' }, referral },
    '555'
  );
  const interactive = normalizeWhatsAppMessage(
    {
      from: '9477',
      id: 'wamid.int',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'SIZES', title: 'Sizes' } },
      referral,
    },
    '555'
  );

  assert.equal(image?.adReferral?.sourceId, '1202');
  assert.equal(interactive?.adReferral?.sourceId, '1202');
});

test('an ordinary message carries no referral', () => {
  const normalized = normalizeWhatsAppMessage(
    { from: '9477', id: 'wamid.plain', type: 'text', text: { body: 'hello' } },
    '555'
  );

  assert.equal(normalized?.adReferral, undefined);
});

// A payload naming no ad and no click cannot be reconciled against spend.
test('a referral naming nothing identifying is ignored', () => {
  const normalized = normalizeWhatsAppMessage(
    {
      from: '9477',
      id: 'wamid.thin',
      type: 'text',
      text: { body: 'hi' },
      referral: { headline: 'Big Sale' },
    },
    '555'
  );

  assert.equal(normalized?.adReferral, undefined);
});
