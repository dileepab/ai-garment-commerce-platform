import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildConversationParticipantsRequest,
  buildInstagramProfileRequest,
  buildMessengerProfileRequest,
  getInstagramProfileDisplayName,
  getMessengerProfileDisplayName,
  parseConversationParticipantName,
  parseInstagramUserProfile,
  parseMessengerUserProfile,
  preferStoredMetaProfileName,
} from '../src/lib/meta-profile.ts';

test('Messenger profile lookup requests only the name fields with bearer authentication', () => {
  const request = buildMessengerProfileRequest({
    graphVersion: 'v25.0',
    senderId: 'messenger-sender',
    accessToken: 'secret-page-token',
  });
  const url = new URL(request.url);

  assert.equal(url.host, 'graph.facebook.com');
  assert.equal(url.pathname, '/v25.0/messenger-sender');
  assert.equal(url.searchParams.get('fields'), 'first_name,last_name');
  assert.equal(url.searchParams.has('access_token'), false);
  assert.deepEqual(request.init.headers, {
    Authorization: 'Bearer secret-page-token',
  });
});

test('Messenger profile parsing ignores gender and builds a clean display name', () => {
  const profile = parseMessengerUserProfile({
    first_name: '  Dileepa ',
    last_name: ' Balasuriya  ',
    gender: 'male',
  });

  assert.deepEqual(profile, {
    firstName: 'Dileepa',
    lastName: 'Balasuriya',
  });
  assert.equal(profile ? getMessengerProfileDisplayName(profile) : '', 'Dileepa Balasuriya');
});

test('Instagram profile lookup follows the configured token family', () => {
  const facebookLogin = buildInstagramProfileRequest({
    graphVersion: 'v25.0',
    senderId: 'instagram-sender',
    accessToken: 'page-token',
    useInstagramGraph: false,
  });
  const instagramLogin = buildInstagramProfileRequest({
    graphVersion: 'v25.0',
    senderId: 'instagram-sender',
    accessToken: 'instagram-token',
    useInstagramGraph: true,
  });

  assert.equal(new URL(facebookLogin.url).host, 'graph.facebook.com');
  assert.equal(new URL(instagramLogin.url).host, 'graph.instagram.com');
  assert.equal(new URL(facebookLogin.url).searchParams.get('fields'), 'name,username');
  assert.equal(new URL(instagramLogin.url).searchParams.get('fields'), 'name,username');
});

test('Instagram profile display prefers name and falls back to username', () => {
  const namedProfile = parseInstagramUserProfile({
    name: ' Dileepa Balasuriya ',
    username: ' postmanme2b ',
  });
  const usernameOnly = parseInstagramUserProfile({ name: ' ', username: '@postmanme2b' });

  assert.equal(namedProfile ? getInstagramProfileDisplayName(namedProfile) : '', 'Dileepa Balasuriya');
  assert.equal(usernameOnly ? getInstagramProfileDisplayName(usernameOnly) : '', '@postmanme2b');
  assert.equal(parseInstagramUserProfile({ id: 'instagram-sender' }), null);
  assert.equal(parseMessengerUserProfile({ error: { message: 'denied' } }), null);
});

test('Meta profile name replaces only a missing placeholder', () => {
  assert.equal(
    preferStoredMetaProfileName('Unknown', 'Dileepa Balasuriya'),
    'Dileepa Balasuriya'
  );
  assert.equal(
    preferStoredMetaProfileName('Nimal Perera', 'Dileepa Balasuriya'),
    'Nimal Perera'
  );
  assert.equal(preferStoredMetaProfileName('', '@postmanme2b'), '@postmanme2b');
  assert.equal(preferStoredMetaProfileName('', 'James Brown'), 'James Brown');
});


test('Conversation lookup asks the page for just this customer\'s thread', () => {
  const request = buildConversationParticipantsRequest({
    graphVersion: 'v25.0',
    pageOrAccountId: '1271000000006065',
    senderId: 'messenger-sender',
    accessToken: 'secret-page-token',
    platform: 'messenger',
  });
  const url = new URL(request.url);

  assert.equal(url.host, 'graph.facebook.com');
  assert.equal(url.pathname, '/v25.0/1271000000006065/conversations');
  assert.equal(url.searchParams.get('platform'), 'messenger');
  assert.equal(url.searchParams.get('user_id'), 'messenger-sender');
  assert.equal(url.searchParams.get('fields'), 'participants');
  assert.equal(url.searchParams.has('access_token'), false);
  assert.deepEqual(request.init.headers, {
    Authorization: 'Bearer secret-page-token',
  });
});

test('Conversation participants name the customer and never the brand page', () => {
  const payload = {
    data: [
      {
        id: 't_100',
        participants: {
          data: [
            { name: 'Happy Buy', id: '1271000000006065' },
            { name: '  Nimal  Perera ', id: 'messenger-sender' },
          ],
        },
      },
    ],
  };

  assert.equal(
    parseConversationParticipantName(payload, {
      senderId: 'messenger-sender',
      pageOrAccountId: '1271000000006065',
    }),
    'Nimal Perera'
  );
});

test('Conversation participants fall back to the party that is not the page', () => {
  const payload = {
    data: [
      {
        participants: {
          data: [
            { name: 'Happy Buy', id: '1271000000006065' },
            { username: '@postmanme2b', id: 'some-other-id' },
          ],
        },
      },
    ],
  };

  assert.equal(
    parseConversationParticipantName(payload, {
      senderId: 'instagram-sender',
      pageOrAccountId: '1271000000006065',
    }),
    '@postmanme2b'
  );
});

test('Conversation lookup that names nobody stays empty rather than guessing', () => {
  assert.equal(
    parseConversationParticipantName(
      { data: [] },
      { senderId: 'messenger-sender', pageOrAccountId: '1271000000006065' }
    ),
    ''
  );
  assert.equal(
    parseConversationParticipantName(
      { error: { message: 'denied' } },
      { senderId: 'messenger-sender', pageOrAccountId: '1271000000006065' }
    ),
    ''
  );
  // Only the page is listed, so there is no customer name to take.
  assert.equal(
    parseConversationParticipantName(
      {
        data: [
          { participants: { data: [{ name: 'Happy Buy', id: '1271000000006065' }] } },
        ],
      },
      { senderId: 'messenger-sender', pageOrAccountId: '1271000000006065' }
    ),
    ''
  );
});
