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
        'Our latest collection is dropping very soon! Stay tuned to our page for updates. If you have a specific item in mind, feel free to drop the details here.',
      sinhala:
        'අපගේ අලුත්ම ඇඳුම් එකතුව ළඟදීම බලාපොරොත්තු වන්න! පිටුවට සම්බන්ධ වී සිටින්න. ඔබට අවශ්‍ය විශේෂ ඇඳුමක් ඇත්නම්, කරුණාකර අපට පණිවිඩයක් එවන්න.',
      tamil:
        'எங்களது புதிய ஆடைகள் விரைவில் வரவிருக்கின்றன! புதிய வரவுகளை அறிய எங்களது பக்கத்தோடு இணைந்திருங்கள். உங்களுக்கு ஏதேனும் குறிப்பிட்ட ஆடை தேவைப்பட்டால் மெசேஜ் செய்யவும்.',
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
