import { logDebug, logError } from '@/lib/app-log';

/**
 * Sends a public reply to a Facebook comment.
 * FB Endpoint: POST /v22.0/{comment_id}/comments
 */
export async function sendFacebookCommentReply(commentId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return;

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${commentId}/comments?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    if (!response.ok) {
      logError('Meta', 'FB Public Comment Reply failed.', data);
    } else {
      logDebug('Meta', `FB Public Comment Reply sent to ${commentId}.`);
    }
  } catch (error) {
    logError('Meta', 'Error sending FB comment reply.', error);
  }
}

/**
 * Sends a private reply (DM) to a Facebook comment.
 * FB Endpoint: POST /v22.0/{comment_id}/private_replies
 */
export async function sendFacebookPrivateReply(commentId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return;

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${commentId}/private_replies?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    if (!response.ok) {
      logError('Meta', 'FB Private Reply failed.', data);
    } else {
      logDebug('Meta', `FB Private Reply sent via comment ${commentId}.`);
    }
  } catch (error) {
    logError('Meta', 'Error sending FB private reply.', error);
  }
}

/**
 * Sends a public reply to an Instagram comment.
 * IG Endpoint: POST /v22.0/{comment_id}/replies
 */
export async function sendInstagramCommentReply(commentId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return;

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${commentId}/replies?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    if (!response.ok) {
      logError('Meta', 'IG Public Comment Reply failed.', data);
    } else {
      logDebug('Meta', `IG Public Comment Reply sent to ${commentId}.`);
    }
  } catch (error) {
    logError('Meta', 'Error sending IG comment reply.', error);
  }
}

/**
 * Sends a private reply (DM) to an Instagram comment.
 * IG Endpoint: POST /v22.0/{page_id}/messages
 * Note: page_id here belongs to the Instagram Professional Account.
 */
export async function sendInstagramPrivateReply(commentId: string, pageIdOrAccountId: string, message: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return;

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${pageIdOrAccountId}/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      logError('Meta', 'IG Private Reply failed.', data);
    } else {
      logDebug('Meta', `IG Private Reply sent via comment ${commentId}.`);
    }
  } catch (error) {
    logError('Meta', 'Error sending IG private reply.', error);
  }
}
