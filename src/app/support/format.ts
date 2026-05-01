import type { SupportThreadMessage } from './types';

export const SUPPORT_THREAD_MESSAGE_LIMIT = 40;
export const SUPPORT_THREAD_POLL_MS = 4000;

export function formatSupportDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatSupportTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function serializeSupportMessage(message: {
  id: number;
  role: string;
  message: string;
  createdAt: Date;
}): SupportThreadMessage {
  return {
    id: message.id,
    role: message.role,
    message: message.message,
    createdAt: message.createdAt.toISOString(),
    createdAtLabel: formatSupportTime(message.createdAt),
  };
}
