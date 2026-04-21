import { readFile } from 'node:fs/promises';
import path from 'node:path';

const reusableAttachmentCache = new Map<string, string>();

function getMimeType(filePath: string): string {
  if (filePath.endsWith('.png')) {
    return 'image/png';
  }

  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (filePath.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

function resolvePublicFilePath(publicPath: string): string {
  const normalizedPath = publicPath.startsWith('/') ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), 'public', normalizedPath);
}

async function sendMessengerPayload(senderId: string, payload: Record<string, unknown>) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    console.error('Missing META_PAGE_ACCESS_TOKEN in environment variables.');
    return;
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        ...payload,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Meta API Error:', data);
    } else {
      console.log(`[Meta Messenger Send] Message sent successfully to ${senderId}`);
    }
  } catch (error) {
    console.error('Error sending message to Meta:', error);
  }
}

export async function sendMessengerMessage(senderId: string, messageText: string) {
  await sendMessengerPayload(senderId, {
    message: { text: messageText },
  });
}

async function uploadReusableMessengerAttachment(publicPath: string): Promise<string | null> {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    console.error('Missing META_PAGE_ACCESS_TOKEN in environment variables.');
    return null;
  }

  const cachedAttachmentId = reusableAttachmentCache.get(publicPath);
  if (cachedAttachmentId) {
    return cachedAttachmentId;
  }

  try {
    const filePath = resolvePublicFilePath(publicPath);
    const fileBuffer = await readFile(filePath);
    const formData = new FormData();

    formData.append(
      'message',
      JSON.stringify({
        attachment: {
          type: 'image',
          payload: {
            is_reusable: true,
          },
        },
      })
    );

    formData.append(
      'filedata',
      new Blob([fileBuffer], { type: getMimeType(filePath) }),
      path.basename(filePath)
    );

    const response = await fetch(
      `https://graph.facebook.com/v22.0/me/message_attachments?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error('Meta Attachment Upload Error:', data);
      return null;
    }

    const attachmentId =
      typeof data?.attachment_id === 'string' ? data.attachment_id : null;

    if (attachmentId) {
      reusableAttachmentCache.set(publicPath, attachmentId);
    }

    return attachmentId;
  } catch (error) {
    console.error('Error uploading Messenger attachment:', error);
    return null;
  }
}

export async function sendMessengerImage(senderId: string, imagePathOrUrl: string) {
  if (/^https?:\/\//i.test(imagePathOrUrl)) {
    await sendMessengerPayload(senderId, {
      message: {
        attachment: {
          type: 'image',
          payload: {
            url: imagePathOrUrl,
            is_reusable: true,
          },
        },
      },
    });
    return;
  }

  const attachmentId = await uploadReusableMessengerAttachment(imagePathOrUrl);

  if (!attachmentId) {
    return;
  }

  await sendMessengerPayload(senderId, {
    message: {
      attachment: {
        type: 'image',
        payload: {
          attachment_id: attachmentId,
        },
      },
    },
  });
}

export async function getUserProfile(senderId: string): Promise<{ firstName: string; lastName: string; gender: string } | null> {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) return null;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/${senderId}?fields=first_name,last_name,gender&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await response.json();

    if (response.ok && data.first_name) {
      console.log(`[Meta Profile] ${data.first_name} ${data.last_name || ''} (${data.gender || 'unknown'})`);
      return {
        firstName: data.first_name,
        lastName: data.last_name || '',
        gender: data.gender || 'unknown',
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}
