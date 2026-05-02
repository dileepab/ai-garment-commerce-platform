import { logDebug, logError } from '@/lib/app-log';
import type { MetaSendResult } from '@/lib/meta';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

function missingTokenResult(): MetaSendResult {
  logError('Meta', 'Missing META_PAGE_ACCESS_TOKEN in environment variables.');
  return {
    ok: false,
    error: 'META_PAGE_ACCESS_TOKEN is missing.',
  };
}

function getPayloadError(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: { message?: string } }).error;
    return error?.message;
  }

  return undefined;
}

async function readGraphResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Sends a public reply to a Facebook comment.
 * FB Endpoint: POST /v22.0/{comment_id}/comments
 */
export async function sendFacebookCommentReply(commentId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return missingTokenResult();

  try {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${commentId}/comments?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await readGraphResponseBody(response);
    if (!response.ok) {
      logError('Meta', 'FB Public Comment Reply failed.', {
        commentId,
        status: response.status,
        data,
      });
      return {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
    } else {
      logDebug('Meta', `FB Public Comment Reply sent to ${commentId}.`);
      return { ok: true, status: response.status, data };
    }
  } catch (error) {
    logError('Meta', 'Error sending FB comment reply.', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Meta comment send error.',
    };
  }
}

/**
 * Sends a private reply (DM) to a Facebook comment.
 * FB Endpoint: POST /v22.0/{comment_id}/private_replies
 */
export async function sendFacebookPrivateReply(commentId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return missingTokenResult();

  try {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${commentId}/private_replies?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await readGraphResponseBody(response);
    if (!response.ok) {
      logError('Meta', 'FB Private Reply failed.', {
        commentId,
        status: response.status,
        data,
      });
      return {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
    } else {
      logDebug('Meta', `FB Private Reply sent via comment ${commentId}.`);
      return { ok: true, status: response.status, data };
    }
  } catch (error) {
    logError('Meta', 'Error sending FB private reply.', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Meta private reply error.',
    };
  }
}

/**
 * Sends a public reply to an Instagram comment.
 * IG Endpoint: POST /v22.0/{comment_id}/replies
 */
export async function sendInstagramCommentReply(commentId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return missingTokenResult();

  try {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${commentId}/replies?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await readGraphResponseBody(response);
    if (!response.ok) {
      logError('Meta', 'IG Public Comment Reply failed.', {
        commentId,
        status: response.status,
        data,
      });
      return {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
    } else {
      logDebug('Meta', `IG Public Comment Reply sent to ${commentId}.`);
      return { ok: true, status: response.status, data };
    }
  } catch (error) {
    logError('Meta', 'Error sending IG comment reply.', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Meta comment send error.',
    };
  }
}

/**
 * Sends a private reply (DM) to an Instagram comment.
 * IG Endpoint: POST /v22.0/{page_id}/messages
 * Note: page_id here belongs to the Instagram Professional Account.
 */
export async function sendInstagramPrivateReply(commentId: string, pageIdOrAccountId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return missingTokenResult();

  try {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pageIdOrAccountId}/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    });

    const data = await readGraphResponseBody(response);
    if (!response.ok) {
      logError('Meta', 'IG Private Reply failed.', {
        commentId,
        pageIdOrAccountId,
        status: response.status,
        data,
      });
      return {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
    } else {
      logDebug('Meta', `IG Private Reply sent via comment ${commentId}.`);
      return { ok: true, status: response.status, data };
    }
  } catch (error) {
    logError('Meta', 'Error sending IG private reply.', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Meta private reply error.',
    };
  }
}
