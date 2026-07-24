import QRCode from 'qrcode';
import royalExpressCities from '@/data/royalexpress-city-list.json';
import sriLankaPostcodes from '@/data/sri-lanka-postcodes.json';

const cityNamesById = new Map(royalExpressCities.map((city) => [String(city.id), city.name]));

function normalizePlace(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const postcodeAliases: Record<string, string> = {
  negombo: '11500',
};

const postcodesByCity = new Map(
  Object.entries(sriLankaPostcodes).map(([city, postcode]) => [normalizePlace(city), postcode]),
);

type LabelAddressFields = {
  streetAddress?: string;
  city?: string;
  district?: string;
};

function parseLabeledAddress(value?: string | null): LabelAddressFields | null {
  const source = value?.trim();
  if (!source) return null;

  const pattern = /(?:^|[,\n]\s*)(name|street address|delivery address|address|city\/town|city|town|district|phone number|telephone|contact number|mobile number|phone|mobile)\s*[:\-]\s*/gi;
  const matches = [...source.matchAll(pattern)];
  if (matches.length === 0) return null;

  const fields: LabelAddressFields = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = match[1].toLowerCase();
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const fieldValue = source.slice(start, end).replace(/[,\s]+$/, '').trim();
    if (!fieldValue) continue;

    if (key === 'street address' || key === 'delivery address' || key === 'address') {
      fields.streetAddress ||= fieldValue;
    } else if (key === 'city/town' || key === 'city' || key === 'town') {
      fields.city ||= fieldValue;
    } else if (key === 'district') {
      fields.district ||= fieldValue;
    }
  }

  return fields;
}

function cleanAddressDisplayValue(value: string) {
  return value
    .replace(/,\s*(?:phone(?: number)?|telephone|contact number|mobile(?: number)?|name)\s*:?\s*[^,]+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/, '')
    .trim();
}

function isPlausibleLocation(value?: string | null) {
  const cleaned = value?.trim();
  if (!cleaned || cleaned.length > 60) return false;
  if (/\b(?:phone|telephone|mobile|contact|street address|address|name)\b/i.test(cleaned)) return false;
  if (/\b(?:i want|change|order|size|colour|color)\b/i.test(cleaned)) return false;
  if ((cleaned.match(/\d/g) || []).length > 2) return false;
  return true;
}

function inferCityFromCompositeAddress(value?: string | null) {
  const source = value?.trim();
  if (!source || !/,\s*(?:phone(?: number)?|telephone|contact number|mobile(?: number)?|name)\s*:?/i.test(source)) {
    return null;
  }

  const cleaned = cleanAddressDisplayValue(source);
  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  const candidate = parts.length > 1 ? parts[parts.length - 1] : null;
  return isPlausibleLocation(candidate) ? candidate : null;
}

export function buildRoyalExpressLabelAddressLines(
  values: Array<string | null | undefined>,
  locationValues: Array<string | null | undefined> = [],
) {
  const selected: string[] = [];
  const normalizedLocations = new Set(
    locationValues.filter((value): value is string => Boolean(value?.trim())).map(normalizePlace),
  );

  for (const value of values) {
    const source = value?.trim();
    if (!source) continue;

    const parsed = parseLabeledAddress(source);
    const candidate = parsed?.streetAddress || cleanAddressDisplayValue(source);
    const addressParts = candidate.split(',').map((part) => part.trim()).filter(Boolean);
    while (
      addressParts.length > 1 &&
      normalizedLocations.has(normalizePlace(addressParts[addressParts.length - 1]))
    ) {
      addressParts.pop();
    }
    const cleaned = addressParts.join(', ');
    if (!cleaned) continue;

    const normalized = normalizePlace(cleaned);
    const duplicate = selected.some((existing) => {
      const normalizedExisting = normalizePlace(existing);
      return normalizedExisting.includes(normalized) || normalized.includes(normalizedExisting);
    });

    if (!duplicate) selected.push(cleaned);
  }

  return selected.length > 0 ? selected : ['No address provided'];
}

function resolveColomboPostcode(normalizedCity: string) {
  const match = normalizedCity.match(/^colombo0?([1-9]|1[0-5])$/);
  if (!match) return null;

  return String(Number(match[1]) * 100).padStart(5, '0');
}

function extractPostcode(values: Array<string | null | undefined>) {
  for (const value of values) {
    const match = value?.match(/(?:^|\D)(\d{5})(?=\D|$)/);
    if (match) return match[1];
  }

  return null;
}

export function buildRoyalExpressQrMatrix(value: string) {
  const cleaned = value.trim() || '0';
  const modules = QRCode.create(cleaned, { errorCorrectionLevel: 'M' }).modules;

  return {
    size: modules.size,
    cells: Array.from(modules.data, (cell) => Boolean(cell)),
  };
}

export function formatRoyalExpressLabelPhone(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return '-';

  return raw
    .split(/\s*[,/]\s*/)
    .map((part) => {
      const digits = part.replace(/\D/g, '');
      const national =
        digits.length === 11 && digits.startsWith('94')
          ? digits.slice(2)
          : digits.length === 10 && digits.startsWith('0')
            ? digits.slice(1)
            : digits;

      if (national.length !== 9) return part.trim();
      return `+94 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
    })
    .join(' / ');
}

export function resolveRoyalExpressLabelLocation(input: {
  receiverCityId?: string | null;
  deliveryCity?: string | null;
  deliveryDistrict?: string | null;
  addressParts?: Array<string | null | undefined>;
}) {
  const labeledLocation = [
    ...(input.addressParts || []),
    input.deliveryCity,
    input.deliveryDistrict,
  ]
    .map(parseLabeledAddress)
    .find((fields) => fields?.city || fields?.district);
  const embeddedCity = (input.addressParts || [])
    .map(inferCityFromCompositeAddress)
    .find((value): value is string => Boolean(value));
  const courierCity = input.receiverCityId
    ? cityNamesById.get(String(input.receiverCityId).trim())
    : undefined;
  const deliveryCity = isPlausibleLocation(input.deliveryCity) ? input.deliveryCity?.trim() : undefined;
  const deliveryDistrict = isPlausibleLocation(input.deliveryDistrict)
    ? input.deliveryDistrict?.trim()
    : undefined;
  const city =
    labeledLocation?.city ||
    embeddedCity ||
    deliveryCity ||
    courierCity ||
    labeledLocation?.district ||
    deliveryDistrict ||
    '-';
  const explicitPostcode = extractPostcode([
    ...(input.addressParts || []),
    input.deliveryCity,
    input.deliveryDistrict,
  ]);
  const normalizedCity = city === '-' ? '' : normalizePlace(city);
  const postalCode =
    explicitPostcode ||
    postcodeAliases[normalizedCity] ||
    resolveColomboPostcode(normalizedCity) ||
    postcodesByCity.get(normalizedCity) ||
    '-';

  return { city, postalCode };
}
