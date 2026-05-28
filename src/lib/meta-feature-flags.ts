import { getMerchantSettings } from '@/lib/runtime-config';

export async function isMetaCommentAutoReplyEnabled(brand?: string | null): Promise<boolean> {
  const settings = await getMerchantSettings(brand);
  return settings.automation.commentAutoReplyEnabled;
}

export async function getMetaCommentAutoReplyMode(brand?: string | null): Promise<'enabled' | 'disabled'> {
  return await isMetaCommentAutoReplyEnabled(brand) ? 'enabled' : 'disabled';
}
