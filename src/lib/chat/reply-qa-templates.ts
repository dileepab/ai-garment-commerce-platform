import type { CustomerLanguage } from '@/lib/chat/language';

export interface ReplyQaTemplate {
  key: string;
  label: string;
  templates: Record<CustomerLanguage, string>;
}

export const REPLY_QA_TEMPLATES: ReplyQaTemplate[] = [
  {
    key: 'empty_catalog',
    label: 'Empty catalog',
    templates: {
      english:
        'We do not have any items listed right now. New products will be available soon—follow our page for updates.',
      sinhala:
        'දැනට අපගේ catalog එකේ භාණ්ඩ කිසිවක් ලැයිස්තුගත කර නැහැ. අලුත් භාණ්ඩ ළඟදීම එක් කරනු ඇත—updates සඳහා අපගේ page එක follow කරන්න.',
      tamil:
        'தற்போது எங்கள் catalog-ல் எந்தப் பொருட்களும் பட்டியலிடப்படவில்லை. புதிய பொருட்கள் விரைவில் சேர்க்கப்படும்—updates-க்கு எங்கள் page-ஐ follow செய்யுங்கள்.',
    },
  },
  {
    key: 'refund_damage',
    label: 'Damaged item / refund',
    templates: {
      english:
        'I want to make sure you get the right help for this order issue. Please send your order number and clear photos of the item and package so our team can review the refund or replacement options.',
      sinhala:
        'ඔබට ලැබුණු භාණ්ඩය ගැන ඇති ගැටලුවට කණගාටුයි. කරුණාකර ඔබේ ඇණවුම් අංකය සහ භාණ්ඩයේ හා පැකේජයේ පැහැදිලි ඡායාරූප එවන්න. අපගේ කණ්ඩායම refund හෝ replacement විකල්ප පරීක්ෂා කරයි.',
      tamil:
        'உங்கள் பொருளில் ஏற்பட்ட பிரச்சினைக்கு மன்னிக்கவும். Refund அல்லது replacement விருப்பங்களை எங்கள் குழு பரிசீலிக்க உங்கள் order number மற்றும் பொருள்/பேக்கேஜ் தெளிவான புகைப்படங்களை அனுப்புங்கள்.',
    },
  },
  {
    key: 'exchange',
    label: 'Size / item exchange',
    templates: {
      english:
        'We can check the exchange options for you. Please send your order number and the size, color, or item you want instead, subject to stock availability.',
      sinhala:
        'ඔබට exchange විකල්ප පරීක්ෂා කර දෙන්නම්. කරුණාකර ඔබේ ඇණවුම් අංකය සහ ඔබට අවශ්‍ය size, color, හෝ item එක එවන්න. මෙය stock තිබීම මත රඳා පවතී.',
      tamil:
        'Exchange விருப்பங்களை பார்க்கலாம். உங்கள் order number மற்றும் மாற்றாக வேண்டிய size, color, அல்லது item விவரங்களை அனுப்புங்கள். இது stock இருப்பதை பொறுத்தது.',
    },
  },
  {
    key: 'location',
    label: 'Location / branches',
    templates: {
      english:
        'At the moment this chat is set up for online orders. You can message us here for item details, delivery, COD, or orders. For store location or branch details, our support team can confirm the latest information.',
      sinhala:
        'දැනට මෙම chat එක online orders සඳහා සකසා ඇත. Item details, delivery, COD, හෝ orders ගැන මෙතැනින්ම පණිවිඩයක් එවිය හැක. Store location හෝ branch විස්තර සඳහා අපගේ support team එක නවතම තොරතුරු තහවුරු කරයි.',
      tamil:
        'தற்போது இந்த chat online orders காக அமைக்கப்பட்டுள்ளது. Item details, delivery, COD, அல்லது orders பற்றி இங்கே message செய்யலாம். Store location அல்லது branch விவரங்களுக்கு எங்கள் support team சமீபத்திய தகவலை உறுதிப்படுத்தும்.',
    },
  },
];
