import prisma from '@/lib/prisma';
import { logWarn } from '@/lib/app-log';
import { DEFAULT_STORE_KEY } from '@/lib/runtime-config';

function cleanSecret(value?: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, '').trim();
  return cleaned ? cleaned : null;
}

export async function getCourierWebhookSecret(): Promise<string | null> {
  const envSecret = cleanSecret(process.env.COURIER_WEBHOOK_SECRET);
  if (envSecret) {
    return envSecret;
  }

  try {
    const settings = await prisma.merchantSettings.findUnique({
      where: { storeKey: DEFAULT_STORE_KEY },
      select: { courierWebhookSecret: true },
    });

    return cleanSecret(settings?.courierWebhookSecret);
  } catch (error) {
    logWarn('Courier Webhook', 'Could not read courier webhook secret from merchant settings.', {
      error,
    });
    return null;
  }
}
