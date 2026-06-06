export const SIZE_PATTERN = /\b(4XL|3XL|2XL|XXL|XL|XS|S|M|L|double extra large|extra large|extra small|small|medium|large)\b/i;
export const SAME_ITEM_PATTERNS = [
  /\bsame item\b/i,
  /\bsame top\b/i,
  /\bsame size\b/i,
  /\bsame one\b/i,
  /\bsame product\b/i,
  /\bre[\s-]?order\b/i,
  /\border again\b/i,
  /\breplace it\b/i,
  /\breplace the order\b/i,
  /\badd this order\b/i,
  /\beka(?:mai)?\b/i,
];

export const ORDER_SUMMARY_PATTERN = /\border summary\b/i;
export const CONTACT_CONFIRMATION_HINT_PATTERN =
  /name:\s*.+\n(?:street address:\s*.+\ncity\/town:\s*.+\ndistrict:\s*.+|address:\s*.+)\nphone number:\s*.+/i;
export const GIFT_PATTERN = /\bgift\b/i;
export const HAPPY_BIRTHDAY_PATTERN = /\bhappy birthday\b/i;
export const ONLINE_TRANSFER_PATTERN = /\bonline transfer\b|\bbank transfer\b/i;
export const ORDER_COMPLETION_PATTERN =
  /\border id:\s*#\d+\b/i;
export const ORDER_CANCELLATION_PATTERN =
  /\bcancelled order id:\s*#\d+\b/i;
export const ORDER_UPDATE_COMPLETION_PATTERN =
  /\byour order has been updated successfully\b/i;
