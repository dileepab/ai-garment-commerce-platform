/**
 * WhatsApp catalog product messages.
 *
 * A text list makes the customer go and find the item themselves. A product
 * message renders as a native card with the catalog image, price and an "Add to
 * cart" button, so the bot can recommend something and the customer can act on
 * it without leaving the conversation.
 *
 * Two shapes exist. A Single Product Message points at one catalog item. A
 * Multi Product Message lists several under a header, which is what a "what do
 * you have?" answer needs.
 *
 * The retailer id must match the catalog exactly, so callers pass ids built by
 * buildMetaCatalogVariantRetailerId — the same function that writes the feed.
 * A guessed id renders an empty card rather than failing loudly, which is why
 * nothing here invents one.
 */

/** Meta rejects a product list with no sections, and caps a section at 30. */
const MAX_PRODUCTS_PER_SECTION = 30;
/** Header text is required for a product list and is truncated by Meta at 60. */
const MAX_HEADER_LENGTH = 60;
const MAX_BODY_LENGTH = 1024;
const MAX_FOOTER_LENGTH = 60;

export interface CatalogProductRef {
  /** Catalog retailer id, e.g. "HAP-0002-V31". */
  retailerId: string;
}

export interface ProductListSection {
  title: string;
  products: CatalogProductRef[];
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function base(recipient: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
  };
}

/** One catalog item as a card. Returns null when there is no usable id. */
export function buildSingleProductPayload(params: {
  recipient: string;
  catalogId: string;
  retailerId: string;
  body?: string | null;
  footer?: string | null;
}): Record<string, unknown> | null {
  const catalogId = params.catalogId?.trim();
  const retailerId = params.retailerId?.trim();
  if (!catalogId || !retailerId) return null;

  const body = params.body?.trim();
  const footer = params.footer?.trim();

  return {
    ...base(params.recipient),
    type: 'interactive',
    interactive: {
      type: 'product',
      ...(body ? { body: { text: truncate(body, MAX_BODY_LENGTH) } } : {}),
      ...(footer ? { footer: { text: truncate(footer, MAX_FOOTER_LENGTH) } } : {}),
      action: {
        catalog_id: catalogId,
        product_retailer_id: retailerId,
      },
    },
  };
}

/**
 * Several catalog items under a header. Returns null when nothing usable is
 * left after filtering, so the caller can fall back to a text list rather than
 * send an empty carousel.
 */
export function buildProductListPayload(params: {
  recipient: string;
  catalogId: string;
  header: string;
  body: string;
  sections: ProductListSection[];
  footer?: string | null;
}): Record<string, unknown> | null {
  const catalogId = params.catalogId?.trim();
  if (!catalogId) return null;

  const sections = params.sections
    .map((section) => ({
      title: truncate(section.title, MAX_HEADER_LENGTH),
      product_items: section.products
        .map((product) => product.retailerId?.trim())
        .filter((id): id is string => Boolean(id))
        .slice(0, MAX_PRODUCTS_PER_SECTION)
        .map((id) => ({ product_retailer_id: id })),
    }))
    .filter((section) => section.product_items.length > 0);

  if (sections.length === 0) return null;

  // A single product renders better as a card than as a one-row list.
  if (sections.length === 1 && sections[0].product_items.length === 1) {
    return buildSingleProductPayload({
      recipient: params.recipient,
      catalogId,
      retailerId: sections[0].product_items[0].product_retailer_id,
      body: params.body,
      footer: params.footer,
    });
  }

  const footer = params.footer?.trim();

  return {
    ...base(params.recipient),
    type: 'interactive',
    interactive: {
      type: 'product_list',
      header: { type: 'text', text: truncate(params.header, MAX_HEADER_LENGTH) },
      body: { text: truncate(params.body, MAX_BODY_LENGTH) },
      ...(footer ? { footer: { text: truncate(footer, MAX_FOOTER_LENGTH) } } : {}),
      action: {
        catalog_id: catalogId,
        sections,
      },
    },
  };
}
