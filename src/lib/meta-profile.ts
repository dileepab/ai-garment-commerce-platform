export const MESSENGER_PROFILE_FIELDS = ['first_name', 'last_name'] as const;
export const INSTAGRAM_PROFILE_FIELDS = ['name', 'username'] as const;

export interface MessengerUserProfile {
  firstName: string;
  lastName: string;
}

export interface InstagramUserProfile {
  name: string;
  username: string;
}

const PLACEHOLDER_PROFILE_NAMES = new Set([
  '',
  'unknown',
  'unknown customer',
  'not provided',
  'none',
  'n/a',
  'na',
]);

interface MetaProfileRequest {
  url: string;
  init: RequestInit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function buildProfileRequest(params: {
  host: 'graph.facebook.com' | 'graph.instagram.com';
  graphVersion: string;
  senderId: string;
  accessToken: string;
  fields: readonly string[];
}): MetaProfileRequest {
  const url = new URL(
    `https://${params.host}/${params.graphVersion}/${encodeURIComponent(params.senderId)}`
  );
  url.searchParams.set('fields', params.fields.join(','));

  return {
    url: url.toString(),
    init: {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  };
}

export function buildMessengerProfileRequest(params: {
  graphVersion: string;
  senderId: string;
  accessToken: string;
}): MetaProfileRequest {
  return buildProfileRequest({
    ...params,
    host: 'graph.facebook.com',
    fields: MESSENGER_PROFILE_FIELDS,
  });
}

/**
 * The Page/IG conversation the customer is already in, looked up by their id.
 *
 * The direct profile lookup above only returns a name for people who hold a
 * role on the Meta app; for an ordinary customer it answers 200 with nothing
 * but an id, which is why every real Messenger thread in the inbox was headed
 * "Unknown" while the one belonging to the app admin was not. The conversation
 * participant list is covered by pages_read_engagement, which this app already
 * uses to read Page posts, and it names both sides of the thread.
 */
export function buildConversationParticipantsRequest(params: {
  graphVersion: string;
  pageOrAccountId: string;
  senderId: string;
  accessToken: string;
  platform: 'messenger' | 'instagram';
}): MetaProfileRequest {
  const url = new URL(
    `https://graph.facebook.com/${params.graphVersion}/${encodeURIComponent(
      params.pageOrAccountId
    )}/conversations`
  );
  url.searchParams.set('platform', params.platform);
  // Narrows the page's conversations to this one customer's thread.
  url.searchParams.set('user_id', params.senderId);
  url.searchParams.set('fields', 'participants');

  return {
    url: url.toString(),
    init: {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  };
}

/**
 * Picks the customer out of a participant list.
 *
 * Both sides of the thread are listed, so the brand's own page has to be
 * excluded — matching the sender's id first, and otherwise taking the one
 * participant that is not the page.
 */
export function parseConversationParticipantName(
  payload: unknown,
  params: { senderId: string; pageOrAccountId?: string }
): string {
  if (!isRecord(payload)) return '';

  const conversations = Array.isArray(payload.data) ? payload.data : [];
  const participants: Record<string, unknown>[] = [];

  for (const conversation of conversations) {
    if (!isRecord(conversation)) continue;
    const holder = conversation.participants;
    if (!isRecord(holder)) continue;
    const entries = Array.isArray(holder.data) ? holder.data : [];
    for (const entry of entries) {
      if (isRecord(entry)) participants.push(entry);
    }
  }

  const nameOf = (participant: Record<string, unknown>): string => {
    const name = cleanText(participant.name);
    if (name) return name;
    const username = cleanText(participant.username).replace(/^@+/, '');
    return username ? `@${username}` : '';
  };

  const byId = participants.find(
    (participant) => cleanText(participant.id) === params.senderId
  );
  if (byId) {
    const name = nameOf(byId);
    if (name) return name;
  }

  const notThePage = participants.find((participant) => {
    const id = cleanText(participant.id);
    return id !== params.pageOrAccountId && Boolean(nameOf(participant));
  });

  return notThePage ? nameOf(notThePage) : '';
}

export function buildInstagramProfileRequest(params: {
  graphVersion: string;
  senderId: string;
  accessToken: string;
  useInstagramGraph: boolean;
}): MetaProfileRequest {
  return buildProfileRequest({
    ...params,
    host: params.useInstagramGraph ? 'graph.instagram.com' : 'graph.facebook.com',
    fields: INSTAGRAM_PROFILE_FIELDS,
  });
}

export function parseMessengerUserProfile(payload: unknown): MessengerUserProfile | null {
  if (!isRecord(payload)) return null;

  const firstName = cleanText(payload.first_name);
  const lastName = cleanText(payload.last_name);

  return firstName || lastName ? { firstName, lastName } : null;
}

export function parseInstagramUserProfile(payload: unknown): InstagramUserProfile | null {
  if (!isRecord(payload)) return null;

  const name = cleanText(payload.name);
  const username = cleanText(payload.username).replace(/^@+/, '');

  return name || username ? { name, username } : null;
}

export function getMessengerProfileDisplayName(profile: MessengerUserProfile): string {
  return `${profile.firstName} ${profile.lastName}`.replace(/\s+/g, ' ').trim();
}

export function getInstagramProfileDisplayName(profile: InstagramUserProfile): string {
  return profile.name || (profile.username ? `@${profile.username}` : '');
}

export function preferStoredMetaProfileName(
  storedName: string | null | undefined,
  profileName: string | null | undefined
): string {
  const normalizedStoredName = cleanText(storedName);

  if (!PLACEHOLDER_PROFILE_NAMES.has(normalizedStoredName.toLowerCase())) {
    return normalizedStoredName;
  }

  return cleanText(profileName);
}
