import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractTikTokWebhook,
  parseTikTokWebhookContent,
} from '../src/lib/tiktok-normalize.ts';

function commentEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    client_key: 'app-123',
    event: 'comment.update',
    create_time: 1_786_000_000,
    user_openid: '_000business',
    content: JSON.stringify({
      comment_id: '7247000000000000001',
      video_id: '7203000000000000002',
      parent_comment_id: '7247000000000000000',
      comment_type: 'reply',
      comment_action: 'insert',
      unique_identifier: 'customer_123',
      timestamp: 1_786_000_000_123,
      text: '  Is medium available?  ',
      ...overrides,
    }),
  };
}

test('normalizes an inserted TikTok comment into a root-comment support thread', () => {
  const result = extractTikTokWebhook(commentEnvelope());
  assert.equal(result.unsupportedEventCount, 0);
  assert.deepEqual(result.comments[0], {
    eventId: 'tiktok:comment:_000business:7247000000000000001:insert:1786000000123',
    clientKey: 'app-123',
    businessOpenId: '_000business',
    commentId: '7247000000000000001',
    threadId: '7247000000000000000',
    videoId: '7203000000000000002',
    parentCommentId: '7247000000000000000',
    customerOpenId: 'customer_123',
    text: 'Is medium available?',
    commentType: 'reply',
    action: 'insert',
    occurredAt: new Date(1_786_000_000_123),
  });
});

test('preserves unquoted 64-bit TikTok IDs from serialized webhook content', () => {
  const content = parseTikTokWebhookContent(
    '{"comment_id":7247000000000000001,"video_id":7203000000000000002,"parent_comment_id":0}',
  );
  assert.equal(content?.comment_id, '7247000000000000001');
  assert.equal(content?.video_id, '7203000000000000002');
  assert.equal(content?.parent_comment_id, '0');
});

test('uses the comment itself as the thread for a root comment', () => {
  const result = extractTikTokWebhook(commentEnvelope({
    parent_comment_id: undefined,
    comment_type: 'comment',
  }));
  assert.equal(result.comments[0]?.threadId, '7247000000000000001');
  assert.equal(result.comments[0]?.parentCommentId, null);
});

test('normalizes a text DM and uses the TikTok conversation as the support thread', () => {
  const result = extractTikTokWebhook({
    client_key: 'app-123',
    event: 'im_receive_msg',
    create_time: 1_786_000_000,
    user_openid: '_000business',
    content: JSON.stringify({
      conversation_id: '7388+000000000000001',
      message_id: '7389000000000000002',
      timestamp: 1_786_000_000_456,
      from_user: {
        id: '_000customer',
        role: 'USER',
      },
      from: 'Nimali',
      to: '_000business',
      type: 'text',
      text: { body: '  Can I order this dress?  ' },
    }),
  });

  assert.equal(result.unsupportedEventCount, 0);
  assert.deepEqual(result.directMessages[0], {
    eventId: 'tiktok:dm:_000business:7389000000000000002',
    clientKey: 'app-123',
    businessOpenId: '_000business',
    conversationId: '7388+000000000000001',
    messageId: '7389000000000000002',
    customerOpenId: '_000customer',
    customerName: 'Nimali',
    text: 'Can I order this dress?',
    messageType: 'text',
    providerMetadata: null,
    automatable: true,
    occurredAt: new Date(1_786_000_000_456),
  });
});

test('routes every non-text DM type to manual support while ignoring echoes and restricted EU notices', () => {
  const base = {
    client_key: 'app-123',
    create_time: 1_786_000_000,
    user_openid: '_000business',
    content: JSON.stringify({
      conversation_id: '7388000000000000001',
      message_id: '7389000000000000002',
      timestamp: 1_786_000_000_456,
      from_user: { id: '_000customer', role: 'USER' },
      from: 'Nimali',
      type: 'image',
      image: { media_id: 'media_123' },
    }),
  };
  assert.equal(extractTikTokWebhook({ ...base, event: 'im_send_msg' }).directMessages.length, 0);
  assert.equal(extractTikTokWebhook({ ...base, event: 'im_receive_msg_eu' }).directMessages.length, 0);
  const image = extractTikTokWebhook({ ...base, event: 'im_receive_msg' }).directMessages[0];
  assert.equal(image?.text, '[TikTok image received]');
  assert.equal(image?.messageType, 'image');
  assert.deepEqual(image?.providerMetadata, { mediaId: 'media_123' });
  assert.equal(image?.automatable, false);

  const placeholders = {
    share_post: '[TikTok post shared]',
    video: '[TikTok video received]',
    emoji: '[TikTok emoji received]',
    sticker: '[TikTok sticker received]',
    reaction: '[TikTok reaction received]',
    template: '[TikTok template message received]',
  };
  for (const [type, text] of Object.entries(placeholders)) {
    const event = extractTikTokWebhook({
      ...base,
      event: 'im_receive_msg',
      content: JSON.stringify({
        ...JSON.parse(String(base.content)),
        type,
      }),
    }).directMessages[0];
    assert.equal(event?.text, text);
    assert.equal(event?.automatable, false);
  }
});

test('normalizes comment lifecycle, sent-message, and authorization removal events', () => {
  const deleted = extractTikTokWebhook(commentEnvelope({ comment_action: 'delete' }));
  assert.equal(deleted.comments.length, 0);
  assert.equal(deleted.commentLifecycleEvents[0]?.action, 'delete');

  const sent = extractTikTokWebhook({
    client_key: 'app-123',
    event: 'im_send_msg',
    create_time: 1_786_000_000,
    user_openid: '_000business',
    content: JSON.stringify({
      conversation_id: '7388+000000000000001',
      message_id: '7389000000000000099',
      timestamp: 1_786_000_000_999,
    }),
  });
  assert.equal(sent.sentMessages[0]?.messageId, '7389000000000000099');

  const removed = extractTikTokWebhook({
    client_key: 'app-123',
    event: 'authorization.removed',
    create_time: 1_786_000_000,
    user_openid: '_000business',
    content: '{}',
  });
  assert.equal(removed.authorizationsRemoved[0]?.businessOpenId, '_000business');
});

test('ignores blank comments, unknown actions, and malformed envelopes', () => {
  assert.equal(extractTikTokWebhook(commentEnvelope({ text: '   ' })).comments.length, 0);
  assert.equal(extractTikTokWebhook(commentEnvelope({ comment_action: 'unknown' })).unsupportedEventCount, 1);
  assert.equal(extractTikTokWebhook({ event: 'comment.update' }).unsupportedEventCount, 1);
  assert.equal(extractTikTokWebhook({ ...commentEnvelope(), event: 'post.publish.complete' }).comments.length, 0);
});
