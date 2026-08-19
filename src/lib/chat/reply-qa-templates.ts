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
        'There are no items listed right now. Please check again later.',
      sinhala:
        'දැනට භාණ්ඩ ලැයිස්තුගත කර නැහැ. පසුව නැවත බලන්න.',
      tamil:
        'இப்போது பொருட்கள் பட்டியலிடப்படவில்லை. பிறகு மீண்டும் பார்க்கவும்.',
    },
  },
  {
    key: 'refund_damage',
    label: 'Damaged item / refund',
    templates: {
      english:
        'I’m sorry about this. Please send your order number and clear photos of the item and package so our team can review it.',
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
        'We can check the exchange options. Please send your order number and the size, color, or item you want instead.',
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
        'We take orders online and do not have a confirmed branch list here. Our support team can confirm store locations.',
      sinhala:
        'දැනට මෙම chat එක online orders සඳහා සකසා ඇත. Item details, delivery, COD, හෝ orders ගැන මෙතැනින්ම පණිවිඩයක් එවිය හැක. Store location හෝ branch විස්තර සඳහා අපගේ support team එක නවතම තොරතුරු තහවුරු කරයි.',
      tamil:
        'தற்போது இந்த chat online orders காக அமைக்கப்பட்டுள்ளது. Item details, delivery, COD, அல்லது orders பற்றி இங்கே message செய்யலாம். Store location அல்லது branch விவரங்களுக்கு எங்கள் support team சமீபத்திய தகவலை உறுதிப்படுத்தும்.',
    },
  },
];
