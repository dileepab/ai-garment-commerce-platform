import { CatalogProduct } from './types';
import { SizeChartCategory, getSizeChartCategoryFromStyle, getSizeChartDefinition } from '@/lib/size-charts';
import { ContactField, collectContactDetailsFromMessages } from '@/lib/contact-profile';
import { splitCsv } from './text-matching';
import { formatSriLankaDisplayDate } from '@/lib/delivery-calendar';

export function buildVariantPrompt(productName: string, size?: string, color?: string, product?: CatalogProduct | null): string {
  const prompts: string[] = [];

  if (!size) {
    const sizeOptions = splitCsv(product?.sizes);
    prompts.push(
      sizeOptions.length > 0
        ? `Please let me know the size you need for ${productName}. Available sizes: ${sizeOptions.join(', ')}.`
        : `Please let me know the size you need for ${productName}.`
    );
  }

  if (!color) {
    const colorOptions = splitCsv(product?.colors);
    prompts.push(
      colorOptions.length > 0
        ? `Please let me know the color you need for ${productName}. Available colors: ${colorOptions.join(', ')}.`
        : `Please let me know the color you need for ${productName}.`
    );
  }

  return prompts.join('\n');
}

export function buildSizeChartSelectionReply(products: CatalogProduct[]): string {
  const allCategories: SizeChartCategory[] = ['tops', 'dresses', 'pants', 'skirts'];
  const mappedCategories = products
    .map((product) => getSizeChartCategoryFromStyle(product.style))
    .filter((category): category is SizeChartCategory => Boolean(category));
  const uniqueCategories = [...new Set(mappedCategories)];
  const categoriesToShow = uniqueCategories.length > 0 ? uniqueCategories : allCategories;
  const categoryLabels = categoriesToShow
    .map((category) => getSizeChartDefinition(category).label)
    .join(', ');

  return `Sure. Which item type would you like the size chart for? Available types: ${categoryLabels}.`;
}

export function getSingleCatalogChartCategory(products: CatalogProduct[]): SizeChartCategory | null {
  const mappedCategories = products
    .map((product) => getSizeChartCategoryFromStyle(product.style))
    .filter((category): category is SizeChartCategory => Boolean(category));
  const uniqueCategories = [...new Set(mappedCategories)];

  return uniqueCategories.length === 1 ? uniqueCategories[0] : null;
}

export function buildMissingFieldLabels(missingFields: ContactField[]): string {
  return missingFields
    .map((field) => {
      if (field === 'name') {
        return 'Name:';
      }
      if (field === 'address') {
        return 'Address:';
      }
      return 'Phone Number:';
    })
    .join('\n');
}

export function buildMissingContactPrompt(missingFields: ContactField[]): string {
  if (missingFields.length === 0) {
    return '';
  }

  return [
    'To proceed with the order, please share:',
    buildMissingFieldLabels(missingFields),
  ].join('\n');
}

export function buildSummaryReplyWithIntro(intro: string, summary: string): string {
  return `${intro}\n\n${summary}`;
}

export function describeOrderStatus(status: string): string {
  if (status === 'packed') {
    return 'Your order is already packed.';
  }
  if (status === 'confirmed') {
    return 'Your order is already confirmed.';
  }
  return 'Your order is already placed.';
}

export function buildDeliveryWindowReply(
  intro: string,
  earliestDate: Date,
  latestDate: Date,
  requestedDate: Date | null,
  isDraft: boolean,
  referenceDate: Date
): string {
  const windowText = `${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}`;

  if (requestedDate) {
    if (latestDate <= requestedDate) {
      return `${intro} The expected delivery window is ${windowText}, so it should arrive by ${formatSriLankaDisplayDate(requestedDate)}.`;
    }
    if (isDraft) {
      return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${windowText}, so delivery before ${formatSriLankaDisplayDate(requestedDate)} is not possible.`;
    }
    return `${intro} The expected delivery window is ${windowText}, so delivery before ${formatSriLankaDisplayDate(requestedDate)} cannot be guaranteed.`;
  }

  if (isDraft) {
    return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${windowText}.`;
  }

  return `${intro} The expected delivery window is ${windowText}.`;
}

export function buildNewOrderNextStepReply(
  contacts: ReturnType<typeof collectContactDetailsFromMessages>,
  missingFields: ContactField[]
): string {
  if (missingFields.length > 0) {
    return buildMissingContactPrompt(missingFields);
  }

  if (contacts.name && contacts.address && contacts.phone) {
    return 'If you would still like to place a new order, please tell me the item, size, and color you need.';
  }

  return 'If you would still like to place a new order, please tell me the item, size, and color you need.';
}
