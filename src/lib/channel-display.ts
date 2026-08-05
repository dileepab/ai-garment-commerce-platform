const CHANNEL_LABELS: Record<string, string> = {
  messenger: 'Messenger',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  tiktok_dm: 'TikTok DM',
  tiktok_comment: 'TikTok Comment',
  direct: 'Direct',
};

const CHANNEL_COLORS: Record<string, string> = {
  messenger: '#0866FF',
  instagram: '#C13584',
  whatsapp: '#128C7E',
  tiktok_dm: '#18181B',
  tiktok_comment: '#3F3F46',
  direct: '#6A635A',
};

export function getSupportChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] || channel.replace(/_/g, ' ');
}

export function getSupportChannelColor(channel: string): string {
  return CHANNEL_COLORS[channel] || '#6A635A';
}
