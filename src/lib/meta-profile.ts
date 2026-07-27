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
