'use client';

import React, { useState, useTransition } from 'react';
import { setProductCatalogListing } from '@/app/products/actions';
import { PERSONAS_BY_BRAND, type PersonaId } from '@/lib/persona-data';
import type { CreativeAspectRatio, CreativeGenerationQuality, ViewAngle } from '@/lib/creative-generator';
import { buildGarmentSpecsForAi } from '@/lib/product-garment-specs';
import { productItemCode } from '@/lib/product-item-code';
import ImageLightbox from './ImageLightbox';
import ReferenceImagePicker, {
  hasAnyReference,
  inferredAngles,
  referenceSetToInputs,
  type ReferenceSet,
} from './ReferenceImagePicker';
import {
  generateCreativeBatchAction,
  regenerateCreativeAction,
  saveGeneratedCreative,
  discardCreativeDraft,
  searchProductsForContent,
  generateChannelCaptions,
  createSocialPost,
  publishSocialPost,
  getCreativesForProduct,
  type BatchSourceImage,
} from './actions';

const VIEW_ANGLES: { id: ViewAngle; label: string }[] = [
  { id: 'front',   label: 'Front' },
  { id: 'side',    label: 'Side' },
  { id: 'back',    label: 'Back' },
  { id: 'closeup', label: 'Close-up' },
];

const ASPECT_RATIOS: { id: CreativeAspectRatio; label: string; help: string }[] = [
  { id: '4:5', label: 'Portrait 4:5', help: 'Instagram + Facebook feed. Most screen space.' },
  { id: '1:1', label: 'Square 1:1', help: 'Safe everywhere, good for carousels.' },
  { id: '9:16', label: 'Story 9:16', help: 'Stories and Reels.' },
  { id: '4:3', label: 'Landscape 4:3', help: 'Wide crops and website banners.' },
];

interface DraftResult {
  creativeId: number;
  imageData: string;
  prompt: string;
  viewAngle?: ViewAngle;
  sourceColor?: string;
  // False when the angle had no reference photo and was invented.
  grounded?: boolean;
  corrections?: string[];
}

// Product photos arrive as a flat list of colour/angle rows; generation needs
// them grouped into one reference set per colour.
function groupColorReferences(product: ProductSearchResult | null): Record<string, ReferenceSet> {
  const grouped: Record<string, ReferenceSet> = {};
  for (const image of product?.colorImages ?? []) {
    if (!image.imageUrl?.trim()) continue;
    const angle = (image.angle ?? 'front') as ViewAngle;
    grouped[image.color] = { ...grouped[image.color], [angle]: image.imageUrl };
  }
  return grouped;
}

interface ExistingCreative {
  id: number;
  viewAngle: string | null;
  personaStyle: string | null;
  createdAt: string | Date;
}

/**
 * A saved creative picked for the post, carrying the product it belongs to.
 *
 * The product travels with the selection because the creative grid only ever
 * holds one product's images: switch products to add a second item and the
 * first product's tiles are gone, so an id on its own could no longer say what
 * had been chosen or let it be removed.
 */
interface ReusedCreative {
  id: number;
  productId: number;
  productName: string;
  itemCode: string | null;
  viewAngle: string | null;
  /** Short label for this photo, from its own product rather than the post. */
  summary: string;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const Ic = {
  close: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  sparkle: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  refresh: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  arrowRight: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  arrowLeft: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  send: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  save: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  fb: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
    </svg>
  ),
  ig: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  ),
};

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductSearchResult {
  id: number;
  sku: string | null;
  name: string;
  brand: string;
  style: string | null;
  price: number;
  fabric: string | null;
  colors: string | null;
  sizes: string | null;
  imageUrl: string | null;
  colorImages?: Array<{ id: number; color: string; angle?: string | null; imageUrl: string }>;
  garmentLengthCm?: number | null;
  sleeveLengthCm?: number | null;
  sleeveType?: string | null;
  fitType?: string | null;
  neckline?: string | null;
  closureDetails?: string | null;
  hasSideSlit?: boolean | null;
  sideSlitHeightCm?: number | null;
  hemDetails?: string | null;
  sleeveHemDetails?: string | null;
  patternDetails?: string | null;
  referenceModelHeightCm?: number | null;
  wornLengthNote?: string | null;
  aiFidelityNotes?: string | null;
}

function productDisplayImage(product: ProductSearchResult | null): string | null {
  return product?.imageUrl || product?.colorImages?.[0]?.imageUrl || null;
}

// Colours the product has at least one photo for, in a stable order.
function referenceColors(references: Record<string, ReferenceSet>): string[] {
  return Object.keys(references).filter(color => hasAnyReference(references[color])).sort();
}

interface CreatePostWizardModalProps {
  availableBrands: string[];
  onClose: () => void;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

// ── Component ────────────────────────────────────────────────────────────────

export default function CreatePostWizardModal({
  availableBrands,
  onClose,
  onComplete,
}: CreatePostWizardModalProps) {
  const defaultBrands = availableBrands;

  const [step, setStep] = useState<Step>(1);

  // Step 1 — Setup
  const [brand, setBrand] = useState(defaultBrands[0] ?? '');
  const [personaId, setPersonaId] = useState<PersonaId>(
    PERSONAS_BY_BRAND[defaultBrands[0] ?? '']?.[0]?.id ?? 'none',
  );
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null);
  const [productContext, setProductContext] = useState('');
  const [garmentFitNotes, setGarmentFitNotes] = useState('');
  // Reference photos when no product is linked, keyed by angle.
  const [references, setReferences] = useState<ReferenceSet>({});
  // Reference photos per colour once a product is linked. Seeded from the
  // product record; the user can fill in angles the catalogue is missing.
  const [colorReferences, setColorReferences] = useState<Record<string, ReferenceSet>>({});
  const [expandedColor, setExpandedColor] = useState<string | null>(null);

  // Step 1 cont. — view angles + existing creatives (per linked product)
  const [viewAngles, setViewAngles] = useState<ViewAngle[]>(['front']);
  // Ticked by default: publishing to Facebook and Instagram is the moment a
  // product goes live, and the WhatsApp catalog should not lag behind it.
  const [listInCatalog, setListInCatalog] = useState(true);
  const [generationQuality, setGenerationQuality] = useState<CreativeGenerationQuality>('standard');
  const [aspectRatio, setAspectRatio] = useState<CreativeAspectRatio>('4:5');
  const [colorViewAngles, setColorViewAngles] = useState<Record<string, ViewAngle[]>>({});
  const [existingCreatives, setExistingCreatives] = useState<ExistingCreative[]>([]);

  // Step 2 — Generate (drafts is the batch; selectedDraftIds are carried into Step 3/4)
  const [drafts, setDrafts] = useState<DraftResult[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<number[]>([]);
  const [reusedCreatives, setReusedCreatives] = useState<ReusedCreative[]>([]);
  const [correctionTextById, setCorrectionTextById] = useState<Record<number, string>>({});
  const [regeneratingDraftId, setRegeneratingDraftId] = useState<number | null>(null);

  // Convenience: selected creative images (fresh drafts or reused existing creatives).
  const selectedDrafts = selectedDraftIds
    .map(id => drafts.find(d => d.creativeId === id))
    .filter((d): d is DraftResult => Boolean(d));
  const selectedDraft = selectedDrafts[0] ?? null;
  const generatedImageData = selectedDrafts[0]?.imageData
    ?? (reusedCreatives.length > 0 ? `/api/content/creatives/${reusedCreatives[0].id}/image` : null);
  const generatedImageDataList = selectedDrafts.length > 0
    ? selectedDrafts.map(d => d.imageData)
    : reusedCreatives.map((c) => `/api/content/creatives/${c.id}/image`);
  const usedPrompt = selectedDraft?.prompt ?? null;
  const selectedCreativeIds = reusedCreatives.length > 0
    ? reusedCreatives.map((c) => c.id)
    : selectedDraftIds;

  // The products this post is actually about. Reused creatives can span several
  // items; a fresh generation is always the one product on screen.
  const postProducts = reusedCreatives.length > 0
    ? [...new Map(reusedCreatives.map((c) => [c.productId, c])).values()]
    : selectedProduct
      ? [{
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          itemCode: productItemCode(selectedProduct),
        }]
      : [];
  // Only a post about one item can prefill its code into the WhatsApp link.
  // With several, the code would name whichever item happened to be selected
  // last — so a shopper who tapped because they liked the third photo would
  // start an order for the first.
  const singlePostProduct = postProducts.length === 1 ? postProducts[0] : null;

  // Step 3 — Caption & Review
  const [channels, setChannels] = useState<string[]>(['facebook', 'instagram']);
  const [generatedCaptions, setGeneratedCaptions] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  // Per-channel copy. A blank entry means that channel publishes `caption`.
  const [channelCaptions, setChannelCaptions] = useState<Record<string, string>>({});
  const [suggestionsByChannel, setSuggestionsByChannel] = useState<Record<string, string[]>>({});
  const [imageDescription, setImageDescription] = useState('');

  // Step 4 — Publish (no extra state — uses prior fields)

  const [formError, setFormError] = useState<string | null>(null);

  const [isSearching, startSearching] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [isRegeneratingDraft, startRegeneratingDraft] = useTransition();
  const [isGeneratingCaptions, startGeneratingCaptions] = useTransition();
  const [isFinishing, startFinishing] = useTransition();

  const isLoading = isGenerating || isRegeneratingDraft || isGeneratingCaptions || isFinishing;
  const colorsWithReferences = referenceColors(colorReferences);
  const plannedGenerationCount = colorsWithReferences.length > 0
    ? colorsWithReferences.reduce((sum, color) => sum + (colorViewAngles[color] ?? viewAngles).length, 0)
    : Math.max(1, viewAngles.length);
  // Angles queued for generation that no photo covers — these get invented.
  const missingAngles = colorsWithReferences.length > 0
    ? [...new Set(colorsWithReferences.flatMap(color =>
        inferredAngles(colorReferences[color], colorViewAngles[color] ?? viewAngles)))]
    : inferredAngles(references, viewAngles);

  // ── Step 1 helpers ─────────────────────────────────────────────────────────

  function handleSearchProduct(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setProductSearch(q);
    if (q.length > 2) {
      startSearching(async () => {
        const res = await searchProductsForContent(q, brand);
        if (res.success && 'products' in res && res.products) {
          setSearchResults(res.products as ProductSearchResult[]);
        }
      });
    } else {
      setSearchResults([]);
    }
  }

  function handleSelectProduct(product: ProductSearchResult) {
    setSelectedProduct(product);
    const context = `Name: ${product.name}. Fabric: ${product.fabric || 'N/A'}. Style: ${product.style || 'N/A'}. Price: Rs ${product.price}. Colors: ${product.colors || 'N/A'}. Sizes: ${product.sizes || 'N/A'}.`;
    const garmentSpecs = buildGarmentSpecsForAi(product);
    setProductContext(context);
    setGarmentFitNotes(garmentSpecs);
    setProductSearch('');
    setSearchResults([]);
    const grouped = groupColorReferences(product);
    // Products with no colour rows still have a single main photo — treat it as
    // the front reference so generation is never left with nothing.
    const mainImage = productDisplayImage(product);
    if (Object.keys(grouped).length === 0 && mainImage) {
      setReferences({ front: mainImage });
    } else {
      setReferences({});
    }
    setColorReferences(grouped);
    setExpandedColor(null);
    setColorViewAngles(Object.fromEntries(referenceColors(grouped).map(color => [color, viewAngles])));
    // Load existing saved creatives for this product so the user can reuse them.
    getCreativesForProduct(product.id).then(res => {
      if (res.success && 'creatives' in res && res.creatives) {
        setExistingCreatives(res.creatives as unknown as ExistingCreative[]);
      } else {
        setExistingCreatives([]);
      }
    }).catch(() => setExistingCreatives([]));
  }

  /**
   * Puts the product search back, without touching what is already in the post.
   *
   * This is how a second item gets added: the search box is replaced by the
   * selected product's card, so the only route back to searching is here. It
   * deliberately leaves reusedCreatives alone — that list is the post's
   * contents, not this product's, and each entry has its own remove button.
   */
  function handleClearProduct() {
    setSelectedProduct(null);
    setProductContext('');
    setGarmentFitNotes('');
    setProductSearch('');
    setReferences({});
    setColorReferences({});
    setExpandedColor(null);
    setColorViewAngles({});
    setExistingCreatives([]);
  }

  function updateColorReferences(color: string, next: ReferenceSet) {
    setColorReferences(prev => ({ ...prev, [color]: next }));
  }

  function toggleAngle(angle: ViewAngle) {
    setViewAngles(prev =>
      prev.includes(angle) ? prev.filter(a => a !== angle) : [...prev, angle],
    );
  }

  function toggleColorAngle(color: string, angle: ViewAngle) {
    setColorViewAngles(prev => {
      const current = prev[color] ?? viewAngles;
      return {
        ...prev,
        [color]: current.includes(angle)
          ? current.filter(a => a !== angle)
          : [...current, angle],
      };
    });
  }

  /**
   * Toggles a saved creative in or out of the post.
   *
   * Selection order is kept: it becomes the carousel order on Facebook and
   * Instagram, so the picture the shopper sees first is the one clicked first.
   */
  /**
   * Toggles a saved creative in or out of the post.
   *
   * Selection order is kept: it becomes the carousel order on Facebook and
   * Instagram, so the picture the shopper sees first is the one clicked first.
   * Selections survive changing the product, which is what lets one post carry
   * several items.
   */
  function toggleReuseExisting(creative: ExistingCreative) {
    if (!selectedProduct) return;

    setReusedCreatives(prev =>
      prev.some(entry => entry.id === creative.id)
        ? prev.filter(entry => entry.id !== creative.id)
        : [
            ...prev,
            {
              id: creative.id,
              productId: selectedProduct.id,
              productName: selectedProduct.name,
              itemCode: productItemCode(selectedProduct),
              viewAngle: creative.viewAngle,
              summary: describeProduct(selectedProduct),
            },
          ]
    );
  }

  function removeReusedCreative(id: number) {
    setReusedCreatives(prev => prev.filter(entry => entry.id !== id));
  }

  function handleUseReusedCreatives() {
    if (reusedCreatives.length === 0) return;

    // Reusing saved creatives skips Step 2 entirely — no Gemini call, and the
    // images are already saved, so there is nothing to clean up afterwards.
    discardAllUnsavedDrafts().catch(() => {});
    setDrafts([]);
    setSelectedDraftIds([]);
    setStep(3);
    if (!imageDescription.trim()) setImageDescription(buildAutoDescription());
    if (generatedCaptions.length === 0) generateCaptionsForImage();
  }

  async function discardAllUnsavedDrafts() {
    const unsavedIds = drafts
      .filter(d => !selectedDraftIds.includes(d.creativeId))
      .map(d => d.creativeId);
    // Also discard selected ones only if user is closing without saving — handled in handleClose.
    await Promise.all(unsavedIds.map(id => discardCreativeDraft(id).catch(() => {})));
  }

  // ── Step 2 helpers ─────────────────────────────────────────────────────────

  function handleGenerateImage() {
    setFormError(null);
    if (!productContext.trim()) {
      setFormError('A product description is required to generate an image.');
      return;
    }
    if (colorsWithReferences.length === 0 && viewAngles.length === 0) {
      setFormError('Select at least one view angle.');
      return;
    }
    if (colorsWithReferences.length > 0 && plannedGenerationCount === 0) {
      setFormError('Select at least one view angle for a colour variant.');
      return;
    }

    startGenerating(async () => {
      // Discard ALL prior drafts (including any previously selected one) before regenerating.
      const allOldIds = drafts.map(d => d.creativeId);
      await Promise.all(allOldIds.map(id => discardCreativeDraft(id).catch(() => {})));
      setDrafts([]);
      setCorrectionTextById({});
      setSelectedDraftIds([]);
      setReusedCreatives([]);

      const colorSources: BatchSourceImage[] = colorsWithReferences
        .map((color) => ({
          color,
          referenceImages: referenceSetToInputs(colorReferences[color]),
          viewAngles: colorViewAngles[color] ?? viewAngles,
        }))
        .filter((source) => source.viewAngles.length > 0);
      const result = await generateCreativeBatchAction({
        brand: brand.trim(),
        personaId,
        productContext,
        garmentFitNotes,
        referenceImages: referenceSetToInputs(references),
        sourceImages: colorSources.length > 0 ? colorSources : undefined,
        productId: selectedProduct?.id,
        viewAngles,
        quality: generationQuality,
        aspectRatio,
      });

      const newDrafts: DraftResult[] = [];
      const errors: string[] = [];
      for (const r of result.results) {
        if (r.success && r.imageData && r.creativeId) {
          newDrafts.push({
            creativeId: r.creativeId,
            imageData: r.imageData,
            prompt: r.prompt ?? '',
            viewAngle: r.viewAngle,
            sourceColor: r.sourceColor,
            grounded: r.grounded,
            corrections: r.corrections ?? [],
          });
        } else if (r.error) {
          errors.push(r.error);
        }
      }
      setDrafts(newDrafts);
      // Auto-select every successful draft so the user can save all, then deselect any they do not want.
      if (newDrafts.length > 0) setSelectedDraftIds(newDrafts.map(d => d.creativeId));

      if (errors.length > 0 && newDrafts.length === 0) {
        setFormError(errors[0]);
      } else if (errors.length > 0) {
        setFormError(`${errors.length} of ${result.results.length} generations failed.`);
      }
    });
  }

  function handleRegenerate() {
    handleGenerateImage();
  }

  function handleCorrectionTextChange(creativeId: number, value: string) {
    setCorrectionTextById(prev => ({ ...prev, [creativeId]: value }));
  }

  function handleRegenerateDraft(creativeId: number) {
    const correctionText = correctionTextById[creativeId]?.trim();
    if (!correctionText) {
      setFormError('Add a correction note before regenerating this image.');
      return;
    }

    setFormError(null);
    setRegeneratingDraftId(creativeId);
    startRegeneratingDraft(async () => {
      const result = await regenerateCreativeAction(creativeId, correctionText, generationQuality);
      setRegeneratingDraftId(null);

      if (result.success && result.imageData) {
        setDrafts(prev => prev.map(d => (
          d.creativeId === creativeId
            ? {
                ...d,
                imageData: result.imageData!,
                prompt: result.prompt ?? d.prompt,
                viewAngle: result.viewAngle ?? d.viewAngle,
                sourceColor: result.sourceColor ?? d.sourceColor,
                grounded: result.grounded ?? d.grounded,
                corrections: result.corrections ?? d.corrections,
              }
            : d
        )));
        setCorrectionTextById(prev => ({ ...prev, [creativeId]: '' }));
      } else {
        setFormError(result.error ?? 'Regeneration failed. Please retry.');
      }
    });
  }

  function handleToggleDraftSelection(creativeId: number) {
    setSelectedDraftIds(prev =>
      prev.includes(creativeId)
        ? prev.filter(id => id !== creativeId)
        : [...prev, creativeId],
    );
  }

  function handleSelectAllDrafts() {
    setSelectedDraftIds(drafts.map(d => d.creativeId));
  }

  function handleClearDraftSelection() {
    setSelectedDraftIds([]);
  }

  // ── Step 3 helpers ─────────────────────────────────────────────────────────

  function generateCaptionsForImage() {
    if (!brand.trim() || channels.length === 0) return;
    startGeneratingCaptions(async () => {
      const result = await generateChannelCaptions({
        brand: brand.trim(),
        channels,
        // With several items the stored context describes only whichever
        // product was selected last, which may not even be in the post — so the
        // set is named instead. The authoritative per-item details are appended
        // from the database at publish either way.
        productContext: postProducts.length > 1
          ? `This post features ${postProducts.length} items: ${postProducts.map((p) => p.productName).join(', ')}.`
          : productContext.trim() || undefined,
        // Every selected creative, so a multi-colour carousel gets copy that
        // covers the whole range rather than only the first image.
        images: generatedImageDataList,
        imageBase64: generatedImageData ?? undefined,
        // Prefills the caption's WhatsApp link, so the customer's first message
        // already names what they tapped — for a multi-item post that is every
        // code in it, not nothing.
        itemCode: singlePostProduct?.itemCode ?? null,
        itemCodes: postProducts.map((product) => product.itemCode),
        productName: singlePostProduct?.productName ?? null,
      });

      if (!result.success || !result.captionsByChannel) {
        setFormError(result.error ?? 'Caption generation failed.');
        return;
      }

      const byChannel = result.captionsByChannel;
      setSuggestionsByChannel(byChannel);
      // The first channel's suggestions double as the shared caption, which is
      // what publishes for any channel the user does not edit.
      const primary = byChannel[channels[0]] ?? Object.values(byChannel)[0] ?? [];
      setGeneratedCaptions(primary);
      if (!caption.trim() && primary.length > 0) setCaption(primary[0]);

      setChannelCaptions(prev => {
        const next = { ...prev };
        for (const channel of channels) {
          if (!next[channel]?.trim() && byChannel[channel]?.length) {
            next[channel] = byChannel[channel][0];
          }
        }
        return next;
      });
    });
  }

  function setChannelCaption(channel: string, value: string) {
    setChannelCaptions(prev => ({ ...prev, [channel]: value }));
  }

  /**
   * Each photo labelled with its own item, not the post's.
   *
   * A shared label was fine when a post was one product. With three, stamping
   * the last-browsed product's name onto all of them mislabels two — and that
   * label is what a photo falls back to if its product link is ever lost.
   */
  function buildPostCreatives() {
    if (reusedCreatives.length > 0) {
      return reusedCreatives.map((entry, index) => ({
        creativeId: entry.id,
        description: entry.summary || undefined,
        displayOrder: index,
      }));
    }

    // Fresh drafts are always one product, so the edited field applies to all.
    return selectedDraftIds.map((creativeId, index) => ({
      creativeId,
      description: imageDescription.trim() || undefined,
      displayOrder: index,
    }));
  }

  function describeProduct(product: ProductSearchResult): string {
    const parts = [product.name];
    if (product.fabric) parts.push(product.fabric);
    parts.push(`Rs ${product.price}`);
    return parts.join(' — ');
  }

  function buildAutoDescription(): string {
    // A post covering several items cannot be labelled with one of them. Each
    // photo carries its own label instead, and this field steps aside.
    if (reusedCreatives.length > 0) {
      return '';
    }
    if (selectedProduct) {
      return describeProduct(selectedProduct);
    }
    const nameMatch = productContext.match(/Name:\s*([^.]+)/);
    const priceMatch = productContext.match(/Price:\s*([^.]+)/);
    if (nameMatch) {
      let s = nameMatch[1].trim();
      if (priceMatch) s += ` — ${priceMatch[1].trim()}`;
      return s;
    }
    return '';
  }

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  // ── Step transitions ───────────────────────────────────────────────────────

  function goToStep2() {
    setFormError(null);
    if (!brand.trim()) {
      setFormError('Select a brand to continue.');
      return;
    }
    if (!productContext.trim()) {
      setFormError('Search and select a product, or describe one manually.');
      return;
    }
    setStep(2);
  }

  function goToStep3() {
    setFormError(null);
    if (selectedCreativeIds.length === 0 || !generatedImageData) {
      setFormError('Select at least one generated image first.');
      return;
    }

    startFinishing(async () => {
      if (reusedCreatives.length === 0) {
        for (const creativeId of selectedDraftIds) {
          const saveRes = await saveGeneratedCreative(creativeId);
          if (!saveRes.success) {
            setFormError(saveRes.error ?? 'Failed to save selected image.');
            return;
          }
        }
      }

      // Seed image description from product data if empty
      if (!imageDescription.trim()) {
        setImageDescription(buildAutoDescription());
      }
      setStep(3);
      // Auto-trigger caption generation if not already populated
      if (generatedCaptions.length === 0) {
        generateCaptionsForImage();
      }
    });
  }

  function goToStep4() {
    setFormError(null);
    if (!caption.trim()) {
      setFormError('Caption cannot be empty.');
      return;
    }
    if (channels.length === 0) {
      setFormError('Select at least one channel.');
      return;
    }
    setStep(4);
  }

  function goBack() {
    setFormError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  }

  // ── Finish actions ─────────────────────────────────────────────────────────

  function handleSaveAsDraft() {
    if (selectedCreativeIds.length === 0) {
      setFormError('Select at least one creative to save.');
      return;
    }
    setFormError(null);
    startFinishing(async () => {
      // If the user picked fresh drafts, save selected ones and discard unselected ones.
      // If they reused an existing creative, it's already saved — skip both steps.
      if (reusedCreatives.length === 0) {
        for (const creativeId of selectedDraftIds) {
          const saveRes = await saveGeneratedCreative(creativeId);
          if (!saveRes.success) {
            setFormError(saveRes.error ?? 'Failed to save creative.');
            return;
          }
        }
        const unselectedIds = drafts.filter(d => !selectedDraftIds.includes(d.creativeId)).map(d => d.creativeId);
        await Promise.all(unselectedIds.map(id => discardCreativeDraft(id).catch(() => {})));
      }

      // Create the post as draft
      const postRes = await createSocialPost({
        brand: brand.trim(),
        channels,
        caption: caption.trim(),
        captionsByChannel: channelCaptions,
        generatedCaptions: generatedCaptions.length > 0 ? generatedCaptions : undefined,
        productContext: productContext.trim() || undefined,
        status: 'draft',
        postCreatives: buildPostCreatives(),
      });

      if (!postRes.success) {
        setFormError(postRes.error ?? 'Failed to save draft.');
        return;
      }
      onComplete();
    });
  }

  function handlePublishNow() {
    if (selectedCreativeIds.length === 0) {
      setFormError('Select at least one creative to publish.');
      return;
    }
    setFormError(null);
    startFinishing(async () => {
      if (reusedCreatives.length === 0) {
        for (const creativeId of selectedDraftIds) {
          const saveRes = await saveGeneratedCreative(creativeId);
          if (!saveRes.success) {
            setFormError(saveRes.error ?? 'Failed to save creative.');
            return;
          }
        }
        const unselectedIds = drafts.filter(d => !selectedDraftIds.includes(d.creativeId)).map(d => d.creativeId);
        await Promise.all(unselectedIds.map(id => discardCreativeDraft(id).catch(() => {})));
      }

      const postRes = await createSocialPost({
        brand: brand.trim(),
        channels,
        caption: caption.trim(),
        captionsByChannel: channelCaptions,
        generatedCaptions: generatedCaptions.length > 0 ? generatedCaptions : undefined,
        productContext: productContext.trim() || undefined,
        status: 'ready',
        postCreatives: buildPostCreatives(),
      });

      if (!postRes.success || !postRes.postId) {
        setFormError(postRes.error ?? 'Failed to create post.');
        return;
      }

      const baseUrl = window.location.origin;
      const pubRes = await publishSocialPost(postRes.postId, baseUrl);

      if (!pubRes.success && !pubRes.outcomes) {
        setFormError(pubRes.error ?? 'Publish failed.');
        return;
      }

      // Best effort, and only after the post is away: failing to list a product
      // must not read as a failed publish. The feed is pulled hourly, so this
      // reaches WhatsApp on the next fetch either way.
      if (listInCatalog && selectedProduct?.id) {
        await setProductCatalogListing(selectedProduct.id, true).catch(() => {});
      }

      // Even on partial success, treat as completed — history is visible from main list
      onComplete();
    });
  }

  function handleClose() {
    // Discard every unsaved batch draft. A reused existing creative is already saved
    // and must NOT be discarded.
    const idsToDiscard = drafts.map(d => d.creativeId);
    Promise.all(idsToDiscard.map(id => discardCreativeDraft(id).catch(() => {}))).catch(() => {});
    onClose();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={!isLoading ? handleClose : undefined}
        style={{ position: 'fixed', inset: 0, background: 'rgba(24,22,15,0.25)', zIndex: 400 }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', maxWidth: 720,
        maxHeight: '94vh',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-modal)',
        zIndex: 401,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-fg-1)' }}>
              Create &amp; Post — AI Wizard
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-3)', marginTop: 2 }}>
              Product → Image → Caption → Publish
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            style={{
              width: 28, height: 28,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              color: 'var(--color-fg-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {Ic.close}
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} />

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {step === 1 && (
            <Step1Setup
              defaultBrands={defaultBrands}
              brand={brand}
              setBrand={(b) => {
                setBrand(b);
                setPersonaId(PERSONAS_BY_BRAND[b]?.[0]?.id ?? 'none');
                handleClearProduct();
              }}
              personaId={personaId}
              setPersonaId={setPersonaId}
              productSearch={productSearch}
              onProductSearchChange={handleSearchProduct}
              searchResults={searchResults}
              isSearching={isSearching}
              selectedProduct={selectedProduct}
              onSelectProduct={handleSelectProduct}
              onClearProduct={handleClearProduct}
              productContext={productContext}
              setProductContext={setProductContext}
              garmentFitNotes={garmentFitNotes}
              setGarmentFitNotes={setGarmentFitNotes}
              references={references}
              setReferences={setReferences}
              colorReferences={colorReferences}
              updateColorReferences={updateColorReferences}
              colorsWithReferences={colorsWithReferences}
              expandedColor={expandedColor}
              setExpandedColor={setExpandedColor}
              viewAngles={viewAngles}
              toggleAngle={toggleAngle}
              generationQuality={generationQuality}
              setGenerationQuality={setGenerationQuality}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              colorViewAngles={colorViewAngles}
              toggleColorAngle={toggleColorAngle}
              plannedGenerationCount={plannedGenerationCount}
              missingAngles={missingAngles}
              existingCreatives={existingCreatives}
              reusedCreatives={reusedCreatives}
              onToggleReuseExisting={toggleReuseExisting}
              onRemoveReusedCreative={removeReusedCreative}
              onUseReusedCreatives={handleUseReusedCreatives}
              isLoading={isLoading}
            />
          )}

          {step === 2 && (
            <Step2Generate
              brand={brand}
              personaId={personaId}
              productContext={productContext}
              sourceImageCount={colorsWithReferences.length || (hasAnyReference(references) ? 1 : 0)}
              plannedGenerationCount={plannedGenerationCount}
              primaryReferenceUrl={references.front ?? colorReferences[colorsWithReferences[0]]?.front ?? ''}
              missingAngles={missingAngles}
              viewAngles={viewAngles}
              generationQuality={generationQuality}
              drafts={drafts}
              selectedDraftIds={selectedDraftIds}
              onToggleDraftSelection={handleToggleDraftSelection}
              onSelectAllDrafts={handleSelectAllDrafts}
              onClearDraftSelection={handleClearDraftSelection}
              usedPrompt={usedPrompt}
              isGenerating={isGenerating}
              isRegeneratingDraft={isRegeneratingDraft}
              regeneratingDraftId={regeneratingDraftId}
              correctionTextById={correctionTextById}
              onCorrectionTextChange={handleCorrectionTextChange}
              onGenerate={handleGenerateImage}
              onRegenerate={handleRegenerate}
              onRegenerateDraft={handleRegenerateDraft}
            />
          )}

          {step === 3 && (
            <Step3CaptionReview
              brand={brand}
              channels={channels}
              toggleChannel={toggleChannel}
              generatedImageDataList={generatedImageDataList}
              reusedCreatives={reusedCreatives}
              imageDescription={imageDescription}
              setImageDescription={setImageDescription}
              caption={caption}
              setCaption={setCaption}
              generatedCaptions={generatedCaptions}
              channelCaptions={channelCaptions}
              setChannelCaption={setChannelCaption}
              suggestionsByChannel={suggestionsByChannel}
              isGeneratingCaptions={isGeneratingCaptions}
              onRegenerateCaptions={generateCaptionsForImage}
              isLoading={isLoading}
            />
          )}

          {step === 4 && (
            <Step4Publish
              brand={brand}
              channels={channels}
              caption={caption}
              imageDescription={imageDescription}
              generatedImageDataList={generatedImageDataList}
              isFinishing={isFinishing}
            />
          )}

          {formError && (
            <div style={{
              padding: '9px 12px',
              background: 'var(--color-error-muted)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 13,
            }}>
              {formError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '14px 22px',
          borderTop: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <button
            className="btn btn-secondary"
            onClick={step === 1 ? handleClose : goBack}
            disabled={isLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {step === 1 ? 'Cancel' : <>{Ic.arrowLeft} Back</>}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step === 1 && (
              <button
                className="btn btn-primary"
                onClick={goToStep2}
                disabled={isLoading || !productContext.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                Continue {Ic.arrowRight}
              </button>
            )}

            {step === 2 && (
              <button
                className="btn btn-primary"
                onClick={goToStep3}
                disabled={isLoading || selectedCreativeIds.length === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                Continue {Ic.arrowRight}
              </button>
            )}

            {step === 3 && (
              <button
                className="btn btn-primary"
                onClick={goToStep4}
                disabled={isLoading || !caption.trim() || channels.length === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                Continue {Ic.arrowRight}
              </button>
            )}

            {step === 4 && (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={handleSaveAsDraft}
                  disabled={isLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {Ic.save} Save as Draft
                </button>
                {/*
                  Only offered when a product is linked — there is nothing to list
                  otherwise. Ticked by default so the usual path keeps WhatsApp in
                  step with Facebook and Instagram.
                */}
                {selectedProduct && (
                  <label
                    title="Meta re-reads the catalog feed hourly, so this appears in WhatsApp within the hour."
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-fg-2)', marginRight: 4 }}
                  >
                    <input
                      type="checkbox"
                      checked={listInCatalog}
                      onChange={(e) => setListInCatalog(e.target.checked)}
                      disabled={isLoading}
                    />
                    Also list in WhatsApp catalog
                  </label>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handlePublishNow}
                  disabled={isLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {isFinishing ? 'Publishing…' : <>{Ic.send} Publish Now</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const labels = ['Setup', 'Generate', 'Caption', 'Publish'];
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '12px 22px',
      borderBottom: '1px solid var(--color-border-subtle)',
      background: 'var(--color-bg)',
      flexShrink: 0,
    }}>
      {labels.map((label, i) => {
        const idx = (i + 1) as Step;
        const isActive = step === idx;
        const isDone = step > idx;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <div style={{
              width: 22, height: 22,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              background: isActive
                ? 'var(--color-accent)'
                : isDone ? 'var(--color-success-muted)' : 'var(--color-surface-muted)',
              color: isActive
                ? 'white'
                : isDone ? '#1A5C3C' : 'var(--color-fg-3)',
              flexShrink: 0,
            }}>
              {isDone ? Ic.check : idx}
            </div>
            <div style={{
              fontSize: 12, fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--color-fg-1)' : isDone ? 'var(--color-fg-2)' : 'var(--color-fg-3)',
              flex: 1,
            }}>
              {label}
            </div>
            {i < labels.length - 1 && (
              <div style={{
                height: 1,
                flex: 1,
                background: isDone ? 'var(--color-success-muted)' : 'var(--color-border)',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1 — Setup ───────────────────────────────────────────────────────────

interface Step1Props {
  defaultBrands: string[];
  brand: string;
  setBrand: (b: string) => void;
  personaId: PersonaId;
  setPersonaId: (id: PersonaId) => void;
  productSearch: string;
  onProductSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  searchResults: ProductSearchResult[];
  isSearching: boolean;
  selectedProduct: ProductSearchResult | null;
  onSelectProduct: (p: ProductSearchResult) => void;
  onClearProduct: () => void;
  productContext: string;
  setProductContext: (s: string) => void;
  garmentFitNotes: string;
  setGarmentFitNotes: (s: string) => void;
  references: ReferenceSet;
  setReferences: (next: ReferenceSet) => void;
  colorReferences: Record<string, ReferenceSet>;
  updateColorReferences: (color: string, next: ReferenceSet) => void;
  colorsWithReferences: string[];
  expandedColor: string | null;
  setExpandedColor: (color: string | null) => void;
  viewAngles: ViewAngle[];
  toggleAngle: (a: ViewAngle) => void;
  generationQuality: CreativeGenerationQuality;
  setGenerationQuality: (q: CreativeGenerationQuality) => void;
  aspectRatio: CreativeAspectRatio;
  setAspectRatio: (r: CreativeAspectRatio) => void;
  colorViewAngles: Record<string, ViewAngle[]>;
  toggleColorAngle: (color: string, angle: ViewAngle) => void;
  plannedGenerationCount: number;
  missingAngles: ViewAngle[];
  existingCreatives: ExistingCreative[];
  reusedCreatives: ReusedCreative[];
  onToggleReuseExisting: (creative: ExistingCreative) => void;
  onRemoveReusedCreative: (creativeId: number) => void;
  onUseReusedCreatives: () => void;
  isLoading: boolean;
}

function Step1Setup(props: Step1Props) {
  // Distinct items, not images — several angles of one dress is still one item.
  const postProductCount = new Set(props.reusedCreatives.map((entry) => entry.productId)).size;
  const personaList = [
    { id: 'none', label: 'Product only', imageUrl: null as string | null },
    ...(PERSONAS_BY_BRAND[props.brand] || []).map((p) => ({ id: p.id, label: p.label, imageUrl: p.imageUrl })),
  ];
  const colorsWithReferences = props.colorsWithReferences;

  return (
    <>
      {/* Brand */}
      <div>
        <label style={labelStyle}>Brand</label>
        <select
          className="app-input"
          value={props.brand}
          onChange={(e) => props.setBrand(e.target.value)}
          disabled={props.isLoading || props.defaultBrands.length === 0}
        >
          {props.defaultBrands.length === 0 ? (
            <option value="">Add a brand in Settings first</option>
          ) : (
            props.defaultBrands.map((b) => <option key={b} value={b}>{b}</option>)
          )}
        </select>
      </div>

      {/* Product picker */}
      <div style={{ position: 'relative' }}>
        <label style={labelStyle}>
          Product{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (search to auto-fill description &amp; image — search again to add another item)
          </span>
        </label>
        {props.selectedProduct && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: productDisplayImage(props.selectedProduct) ? '96px 1fr auto' : '1fr auto',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            {productDisplayImage(props.selectedProduct) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={productDisplayImage(props.selectedProduct)!}
                alt={props.selectedProduct.name}
                style={{ width: 96, height: 112, borderRadius: 'var(--radius-sm)', objectFit: 'contain', flexShrink: 0, background: 'white', border: '1px solid var(--color-border-subtle)' }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-fg-1)' }}>
                {props.selectedProduct.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-fg-3)' }}>
                Rs {props.selectedProduct.price}
                {props.selectedProduct.fabric && ` · ${props.selectedProduct.fabric}`}
                {props.selectedProduct.style && ` · ${props.selectedProduct.style}`}
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClearProduct}
              disabled={props.isLoading}
              style={{
                alignSelf: 'start',
                background: 'none', border: 'none',
                color: 'var(--color-fg-2)', cursor: 'pointer', padding: 4,
              }}
            >
              {Ic.close}
            </button>
          </div>
        )}
        <>
            <input
              className="app-input"
              placeholder={props.selectedProduct ? 'Search another product to add…' : 'Search products by name…'}
              value={props.productSearch}
              onChange={props.onProductSearchChange}
              disabled={props.isLoading}
            />
            {props.isSearching && (
              <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 4 }}>
                Searching…
              </div>
            )}
            {props.searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                zIndex: 10, maxHeight: 220, overflowY: 'auto',
                boxShadow: 'var(--shadow-sm)',
                marginTop: 4,
              }}>
                {props.searchResults.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => props.onSelectProduct(p)}
                    style={{
                      padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                  >
                    {productDisplayImage(p) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={productDisplayImage(p)!} alt={p.name} style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
                    )}
                    <div>
                      <strong>{p.name}</strong>
                      <div style={{ color: 'var(--color-fg-3)', fontSize: 11 }}>
                        Rs {p.price}{p.fabric ? ` · ${p.fabric}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      </div>

      {/* Manual product context (read-only fill, editable) */}
      <div>
        <label style={labelStyle}>
          Product Description{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (used by AI for image &amp; caption)
          </span>
        </label>
        <textarea
          className="app-textarea"
          placeholder="e.g. Black floral midi dress, chiffon fabric, off-shoulder neckline, suitable for evening events"
          value={props.productContext}
          onChange={(e) => props.setProductContext(e.target.value)}
          disabled={props.isLoading}
          rows={3}
          style={{ resize: 'none', minHeight: 72 }}
        />
      </div>

      {/* Reference photos — one per angle. Any angle without a photo is
          invented by the model, which is the main source of wrong output. */}
      {props.colorsWithReferences.length === 0 && (
        <div>
          <label style={labelStyle}>
            Garment Reference Photos{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              (upload the angles you want generated — front is the minimum)
            </span>
          </label>
          <ReferenceImagePicker
            references={props.references}
            onChange={props.setReferences}
            disabled={props.isLoading}
            requestedAngles={props.viewAngles}
          />
        </div>
      )}

      {/* Fit measurements */}
      <div>
        <label style={labelStyle}>
          Garment Fit / Length{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (optional — exact dress height, target length, sleeve length)
          </span>
        </label>
        <input
          className="app-input"
          placeholder={`e.g. dress length 92cm; on a 5'6" model it ends just above the knee; no side slit`}
          value={props.garmentFitNotes}
          onChange={(e) => props.setGarmentFitNotes(e.target.value)}
          disabled={props.isLoading}
        />
      </div>

      {/* View angles */}
      <div>
        <label style={labelStyle}>
          {colorsWithReferences.length > 0 ? 'Default View Angles' : 'View Angles'}{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            {colorsWithReferences.length > 0
              ? '(used as the starting selection for linked colour images)'
              : '(one image per selected angle — each costs a generation)'}
          </span>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {VIEW_ANGLES.map(a => {
            const active = props.viewAngles.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => !props.isLoading && props.toggleAngle(a.id)}
                disabled={props.isLoading}
                style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 600,
                  border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                  color: active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                  cursor: props.isLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {colorsWithReferences.length > 0 && (
        <div>
          <label style={labelStyle}>
            Colour Variant Angles{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              ({props.plannedGenerationCount} generation{props.plannedGenerationCount !== 1 ? 's' : ''})
            </span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {colorsWithReferences.map(color => {
              const colorRefs = props.colorReferences[color] ?? {};
              const selectedAngles = props.colorViewAngles[color] ?? props.viewAngles;
              const missing = inferredAngles(colorRefs, selectedAngles);
              const isExpanded = props.expandedColor === color;
              const thumbnail = colorRefs.front ?? Object.values(colorRefs).find(Boolean);

              return (
                <div
                  key={color}
                  style={{
                    padding: 8,
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg)',
                  }}
                >
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '44px minmax(80px, 1fr) 2fr',
                    gap: 10,
                    alignItems: 'center',
                  }}>
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnail}
                        alt={color}
                        style={{ width: 44, height: 52, objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: 'white', border: '1px solid var(--color-border-subtle)' }}
                      />
                    ) : <div />}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-fg-1)' }}>
                        {color}
                      </div>
                      <button
                        type="button"
                        onClick={() => !props.isLoading && props.setExpandedColor(isExpanded ? null : color)}
                        disabled={props.isLoading}
                        style={{
                          marginTop: 2, padding: 0, border: 'none', background: 'none',
                          fontSize: 10, fontWeight: 600, textAlign: 'left',
                          color: missing.length > 0 ? 'var(--color-warning, #b45309)' : 'var(--color-fg-3)',
                          textDecoration: 'underline',
                          cursor: props.isLoading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {missing.length > 0
                          ? `${missing.length} angle${missing.length > 1 ? 's' : ''} without a photo`
                          : 'All angles photographed'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {VIEW_ANGLES.map(angle => {
                        const active = selectedAngles.includes(angle.id);
                        const willInfer = active && missing.includes(angle.id);
                        return (
                          <button
                            key={angle.id}
                            type="button"
                            onClick={() => !props.isLoading && props.toggleColorAngle(color, angle.id)}
                            disabled={props.isLoading}
                            title={willInfer ? 'No reference photo — this angle will be invented.' : undefined}
                            style={{
                              padding: '5px 9px',
                              fontSize: 11,
                              fontWeight: 700,
                              border: willInfer
                                ? '1px dashed var(--color-warning, #b45309)'
                                : active
                                  ? '1px solid var(--color-accent)'
                                  : '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-sm)',
                              background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                              color: willInfer
                                ? 'var(--color-warning, #b45309)'
                                : active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                              cursor: props.isLoading ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {angle.label}{willInfer ? ' ⚠' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border-subtle)' }}>
                      <ReferenceImagePicker
                        references={colorRefs}
                        onChange={(next) => props.updateColorReferences(color, next)}
                        disabled={props.isLoading}
                        requestedAngles={selectedAngles}
                      />
                      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--color-fg-3)', lineHeight: 1.5 }}>
                        Photos added here are used for this post and saved with the generated
                        image. To reuse them everywhere, add them to the product record.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Output framing — Instagram crops anything narrower than 4:5 */}
      <div>
        <label style={labelStyle}>
          Image Shape{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (4:5 fills the most feed space without being cropped)
          </span>
        </label>
        <div className="grid-4-mobile2" style={{ gap: 8 }}>
          {ASPECT_RATIOS.map(option => {
            const active = props.aspectRatio === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => !props.isLoading && props.setAspectRatio(option.id)}
                disabled={props.isLoading}
                style={{
                  padding: '8px 9px',
                  border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                  color: active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                  cursor: props.isLoading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800 }}>{option.label}</div>
                <div style={{ fontSize: 9, lineHeight: 1.4, color: active ? 'var(--color-accent)' : 'var(--color-fg-3)', marginTop: 2 }}>
                  {option.help}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Generation mode */}
      <div>
        <label style={labelStyle}>Generation Mode</label>
        <div className="grid-2-mobile1" style={{ gap: 8 }}>
          {([
            { id: 'standard', label: 'Standard', help: 'Faster and cheaper for normal posts.' },
            { id: 'high_accuracy', label: 'High accuracy', help: 'Better for exact colour, stripes, hems, slits, and print placement.' },
          ] as Array<{ id: CreativeGenerationQuality; label: string; help: string }>).map(option => {
            const active = props.generationQuality === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => !props.isLoading && props.setGenerationQuality(option.id)}
                disabled={props.isLoading}
                style={{
                  padding: '9px 10px',
                  border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                  color: active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                  cursor: props.isLoading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800 }}>{option.label}</div>
                <div style={{ fontSize: 10, lineHeight: 1.4, color: active ? 'var(--color-accent)' : 'var(--color-fg-3)', marginTop: 2 }}>
                  {option.help}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Existing creatives — reuse instead of regenerate to save tokens */}
      {props.selectedProduct && props.existingCreatives.length > 0 && (
        <div>
          <label style={labelStyle}>
            Reuse Existing Creatives{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              ({props.existingCreatives.length} saved for this product — pick any, then search another product to add more items)
            </span>
          </label>
          <div className="grid-4-mobile2" style={{ gap: 8 }}>
            {props.existingCreatives.slice(0, 8).map(c => {
              const order = props.reusedCreatives.findIndex(entry => entry.id === c.id);
              const picked = order >= 0;

              return (
                <div
                  key={c.id}
                  onClick={() => !props.isLoading && props.onToggleReuseExisting(c)}
                  style={{
                    position: 'relative',
                    border: picked
                      ? '2px solid var(--color-accent)'
                      : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    background: 'var(--color-bg)',
                    cursor: props.isLoading ? 'default' : 'pointer',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/content/creatives/${c.id}/image`}
                    alt={`Creative ${c.id}`}
                    style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }}
                  />
                  {/* The number is the carousel position, not just a tick — the
                      order these are clicked is the order they are posted in. */}
                  {picked && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        minWidth: 20,
                        height: 20,
                        padding: '0 5px',
                        borderRadius: 10,
                        background: 'var(--color-accent)',
                        color: 'var(--color-bg)',
                        fontSize: 11,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {order + 1}
                    </div>
                  )}
                  <div style={{
                    padding: 4,
                    fontSize: 10,
                    textAlign: 'center',
                    background: picked ? 'var(--color-accent-subtle)' : 'transparent',
                    color: picked ? 'var(--color-accent)' : 'var(--color-fg-3)',
                  }}>
                    {c.viewAngle ?? 'front'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The post so far. This is what makes a multi-item post possible: the
          grid above only ever shows one product, so without a running list the
          items picked before switching products would be invisible and
          impossible to remove. */}
      {props.reusedCreatives.length > 0 && (
        <div>
          <label style={labelStyle}>
            In This Post{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              ({props.reusedCreatives.length} image{props.reusedCreatives.length === 1 ? '' : 's'}
              {postProductCount > 1 ? ` across ${postProductCount} items` : ''} — in carousel order)
            </span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {props.reusedCreatives.map((entry, index) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface)',
                }}
              >
                <span style={{
                  minWidth: 20, height: 20, borderRadius: 10,
                  background: 'var(--color-accent)', color: 'var(--color-bg)',
                  fontSize: 11, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {index + 1}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/content/creatives/${entry.id}/image`}
                  alt=""
                  style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--color-fg-2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {entry.productName}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-fg-3)' }}>
                    {[entry.itemCode, entry.viewAngle ?? 'front'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !props.isLoading && props.onRemoveReusedCreative(entry.id)}
                  disabled={props.isLoading}
                  aria-label={`Remove ${entry.productName} from this post`}
                  style={{
                    border: 'none', background: 'transparent',
                    color: 'var(--color-fg-3)', fontSize: 16, lineHeight: 1,
                    padding: '2px 6px',
                    cursor: props.isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10, color: 'var(--color-fg-3)', margin: '6px 0 0' }}>
            {postProductCount > 1
              ? `${postProductCount} items — each photo carries its own details, and the caption lists all of them.`
              : 'One item so far. Search another product above to add a second.'}
          </p>
          <button
            type="button"
            onClick={() => !props.isLoading && props.onUseReusedCreatives()}
            disabled={props.isLoading}
            style={{
              marginTop: 10,
              width: '100%',
              padding: '10px 12px',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent)',
              color: 'var(--color-bg)',
              fontSize: 13,
              fontWeight: 800,
              cursor: props.isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {props.reusedCreatives.length === 1
              ? 'Continue with 1 image →'
              : `Continue with ${props.reusedCreatives.length} images →`}
          </button>
        </div>
      )}

      {/* Persona */}
      <div>
        <label style={labelStyle}>Model Persona</label>
        <div className="grid-4-mobile2" style={{ gap: 10 }}>
          {personaList.map((p) => (
            <div
              key={p.id}
              onClick={() => !props.isLoading && props.setPersonaId(p.id)}
              style={{
                border: props.personaId === p.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                cursor: props.isLoading ? 'default' : 'pointer',
                opacity: props.isLoading ? 0.6 : 1,
              }}
            >
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.label} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{
                  width: '100%', aspectRatio: '1/1',
                  background: 'var(--color-surface-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: 'var(--color-fg-3)', textAlign: 'center', padding: 8,
                }}>
                  No Model
                </div>
              )}
              <div style={{
                padding: '6px', fontSize: 10, fontWeight: 600, textAlign: 'center',
                background: props.personaId === p.id ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
                color: props.personaId === p.id ? 'var(--color-accent)' : 'var(--color-fg-2)',
              }}>
                {p.label.split(' (')[0]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Step 2 — Generate ────────────────────────────────────────────────────────

interface Step2Props {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  sourceImageCount: number;
  plannedGenerationCount: number;
  primaryReferenceUrl: string;
  missingAngles: ViewAngle[];
  viewAngles: ViewAngle[];
  generationQuality: CreativeGenerationQuality;
  drafts: DraftResult[];
  selectedDraftIds: number[];
  onToggleDraftSelection: (creativeId: number) => void;
  onSelectAllDrafts: () => void;
  onClearDraftSelection: () => void;
  usedPrompt: string | null;
  isGenerating: boolean;
  isRegeneratingDraft: boolean;
  regeneratingDraftId: number | null;
  correctionTextById: Record<number, string>;
  onCorrectionTextChange: (creativeId: number, value: string) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRegenerateDraft: (creativeId: number) => void;
}

// Small overlay control. Stops propagation so opening the preview does not also
// toggle the tile's selection.
function ZoomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="View larger"
      title="View larger"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: 'absolute', top: 6, right: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 6,
        border: 'none', background: 'rgba(0,0,0,0.55)', color: 'white',
        cursor: 'zoom-in', padding: 0,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    </button>
  );
}

function Step2Generate(props: Step2Props) {
  const [zoomed, setZoomed] = useState<{ src: string; caption: string } | null>(null);
  const plannedCount = Math.max(1, props.plannedGenerationCount);
  const angleLabel = props.sourceImageCount > 1
    ? 'custom per colour'
    : props.viewAngles.length > 1
    ? `${props.viewAngles.length} angles`
    : props.viewAngles[0] ?? 'front';

  return (
    <>
      {/* Summary */}
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--color-fg-2)',
      }}>
        <div><strong>Brand:</strong> {props.brand}</div>
        <div><strong>Persona:</strong> {props.personaId === 'none' ? 'Product only' : props.personaId}</div>
        <div><strong>Angles:</strong> <span style={{ textTransform: 'capitalize' }}>{angleLabel}</span></div>
        <div><strong>Mode:</strong> {props.generationQuality === 'high_accuracy' ? 'High accuracy' : 'Standard'}</div>
        {props.sourceImageCount > 1 && <div><strong>Colour sources:</strong> {props.sourceImageCount}</div>}
        <div style={{ marginTop: 4 }}>
          <strong>Description:</strong> {props.productContext.slice(0, 180)}{props.productContext.length > 180 ? '…' : ''}
        </div>
        {props.missingAngles.length > 0 && (
          <div style={{ marginTop: 6, color: 'var(--color-warning, #b45309)' }}>
            <strong>Note:</strong> no reference photo for{' '}
            <span style={{ textTransform: 'capitalize' }}>{props.missingAngles.join(', ')}</span>
            {' '}— those views will be invented. Go back and upload them for an exact match.
          </div>
        )}
      </div>

      {props.drafts.length === 0 ? (
        <div style={{
          padding: '40px 20px',
          textAlign: 'center',
          background: 'var(--color-bg)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}>
          <div style={{ fontSize: 13, color: 'var(--color-fg-2)', marginBottom: 12 }}>
            {props.isGenerating
              ? `Generating ${plannedCount} branded marketing image${plannedCount > 1 ? 's' : ''}…`
              : `Click below to generate ${plannedCount} AI marketing image${plannedCount > 1 ? 's' : ''} using your brand style and persona.`}
          </div>
          <button
            type="button"
            onClick={props.onGenerate}
            disabled={props.isGenerating}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 20px',
              background: props.isGenerating ? 'var(--color-surface-muted)' : 'var(--color-accent-subtle)',
              border: '1px solid rgba(196,98,45,0.25)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-accent)',
              fontSize: 13, fontWeight: 700,
              cursor: props.isGenerating ? 'not-allowed' : 'pointer',
            }}
          >
            {Ic.sparkle}
            {props.isGenerating ? 'Generating…' : 'Generate Creative'}
          </button>
        </div>
      ) : (
        <>
          {props.drafts.length > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 11,
              color: 'var(--color-fg-3)',
            }}>
              <span>
                {props.selectedDraftIds.length} of {props.drafts.length} generated images selected for this post.
              </span>
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={props.onSelectAllDrafts}
                  disabled={props.isGenerating || props.isRegeneratingDraft}
                  style={{
                    padding: '4px 8px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-fg-2)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: props.isGenerating || props.isRegeneratingDraft ? 'not-allowed' : 'pointer',
                  }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={props.onClearDraftSelection}
                  disabled={props.isGenerating || props.isRegeneratingDraft}
                  style={{
                    padding: '4px 8px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-fg-2)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: props.isGenerating || props.isRegeneratingDraft ? 'not-allowed' : 'pointer',
                  }}
                >
                  Clear
                </button>
              </span>
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: props.drafts.length === 1 && props.primaryReferenceUrl.trim() ? 'repeat(2, 1fr)' : props.drafts.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {props.primaryReferenceUrl.trim() && (
              <div style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }}>
                <div style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={props.primaryReferenceUrl}
                    alt="Source product reference"
                    style={{ display: 'block', width: '100%', height: 320, objectFit: 'contain', background: 'white' }}
                  />
                  <ZoomButton onClick={() => setZoomed({ src: props.primaryReferenceUrl, caption: 'Source product' })} />
                </div>
                <div style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-fg-2)',
                  borderTop: '1px solid var(--color-border-subtle)',
                }}>
                  Source product
                </div>
              </div>
            )}
            {props.drafts.map(d => {
              const selected = props.selectedDraftIds.includes(d.creativeId);
              const tileLabel = `${d.sourceColor ? `${d.sourceColor} · ` : ''}${d.viewAngle ?? 'front'}`;
              return (
                <div
                  key={d.creativeId}
                  onClick={() => !props.isGenerating && !props.isRegeneratingDraft && props.onToggleDraftSelection(d.creativeId)}
                  style={{
                    background: 'var(--color-bg)',
                    border: selected ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    cursor: props.isGenerating || props.isRegeneratingDraft ? 'default' : 'pointer',
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.imageData}
                      alt={`Generated ${d.viewAngle ?? 'creative'}`}
                      style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain' }}
                    />
                    <ZoomButton onClick={() => setZoomed({ src: d.imageData, caption: tileLabel })} />
                  </div>
                  <div style={{
                    padding: '6px 10px',
                    fontSize: 11, fontWeight: 600,
                    color: selected ? 'var(--color-accent)' : 'var(--color-fg-2)',
                    background: selected ? 'var(--color-accent-subtle)' : 'transparent',
                    borderTop: '1px solid var(--color-border-subtle)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ textTransform: 'capitalize' }}>
                      {d.sourceColor ? `${d.sourceColor} · ` : ''}{d.viewAngle ?? 'front'}
                      {d.grounded === false && (
                        <span
                          title="No reference photo for this angle — check it against the real garment."
                          style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: 'var(--color-warning, #b45309)' }}
                        >
                          ⚠ guessed
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 10 }}>{selected ? '✓ Selected' : 'Click to include'}</span>
                  </div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      padding: 10,
                      borderTop: '1px solid var(--color-border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {(d.corrections?.length ?? 0) > 0 && (
                      <div style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--color-fg-3)' }}>
                        <strong style={{ color: 'var(--color-fg-2)' }}>Applied so far:</strong>
                        <ol style={{ margin: '3px 0 0', paddingLeft: 16 }}>
                          {d.corrections!.map((note, index) => <li key={index}>{note}</li>)}
                        </ol>
                      </div>
                    )}
                    <textarea
                      className="app-textarea"
                      placeholder="Correction, e.g. make sleeves shorter like source image"
                      value={props.correctionTextById[d.creativeId] ?? ''}
                      onChange={(e) => props.onCorrectionTextChange(d.creativeId, e.target.value)}
                      disabled={props.isGenerating || props.isRegeneratingDraft}
                      rows={2}
                      style={{ resize: 'none', minHeight: 58, fontSize: 12 }}
                    />
                    <button
                      type="button"
                      onClick={() => props.onRegenerateDraft(d.creativeId)}
                      disabled={props.isGenerating || props.isRegeneratingDraft || !(props.correctionTextById[d.creativeId]?.trim())}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '7px 12px',
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--color-fg-2)',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: props.isGenerating || props.isRegeneratingDraft || !(props.correctionTextById[d.creativeId]?.trim()) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {Ic.refresh}
                      {props.regeneratingDraftId === d.creativeId ? 'Regenerating…' : 'Regenerate this'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={props.onRegenerate}
              disabled={props.isGenerating}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-fg-2)',
                fontSize: 12, fontWeight: 600,
                cursor: props.isGenerating ? 'not-allowed' : 'pointer',
              }}
            >
              {Ic.refresh}
              {props.isGenerating ? 'Regenerating…' : 'Regenerate all'}
            </button>
          </div>

          {props.usedPrompt && (
            <details>
              <summary style={{ fontSize: 11, color: 'var(--color-fg-3)', cursor: 'pointer' }}>
                View generation prompt
              </summary>
              <p style={{
                fontSize: 11, color: 'var(--color-fg-3)', marginTop: 6,
                lineHeight: 1.5, fontStyle: 'italic',
              }}>
                {props.usedPrompt}
              </p>
            </details>
          )}
        </>
      )}

      {zoomed && (
        <ImageLightbox
          src={zoomed.src}
          alt={zoomed.caption}
          caption={zoomed.caption}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}

// ── Step 3 — Caption & Review ────────────────────────────────────────────────

interface Step3Props {
  brand: string;
  reusedCreatives: ReusedCreative[];
  channels: string[];
  toggleChannel: (ch: string) => void;
  generatedImageDataList: string[];
  imageDescription: string;
  setImageDescription: (s: string) => void;
  caption: string;
  setCaption: (s: string) => void;
  generatedCaptions: string[];
  channelCaptions: Record<string, string>;
  setChannelCaption: (channel: string, value: string) => void;
  suggestionsByChannel: Record<string, string[]>;
  isGeneratingCaptions: boolean;
  onRegenerateCaptions: () => void;
  isLoading: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

function Step3CaptionReview(props: Step3Props) {
  return (
    <>
      {/* Channels */}
      <div>
        <label style={labelStyle}>Channels</label>
        <div style={{ display: 'flex', gap: 10 }}>
          {(['facebook', 'instagram'] as const).map((ch) => {
            const checked = props.channels.includes(ch);
            return (
              <button
                key={ch}
                type="button"
                onClick={() => props.toggleChannel(ch)}
                disabled={props.isLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: checked
                    ? ch === 'instagram' ? '1.5px solid #C13584' : '1.5px solid #0866FF'
                    : '1.5px solid var(--color-border)',
                  background: checked
                    ? ch === 'instagram' ? '#FBE7F2' : '#E8F0FF'
                    : 'var(--color-bg)',
                  color: checked
                    ? ch === 'instagram' ? '#A8276E' : '#0866FF'
                    : 'var(--color-fg-2)',
                  fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {ch === 'instagram' ? Ic.ig : Ic.fb}
                {ch === 'instagram' ? 'Instagram' : 'Facebook'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Image description — one label per photo once the post covers several
          items, since a single line cannot describe three different dresses. */}
      <div>
        <label style={labelStyle}>
          Image Description{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            {props.reusedCreatives.length > 0
              ? '(one per photo, from each item)'
              : '(auto-filled — short label for this creative)'}
          </span>
        </label>
        {props.reusedCreatives.length > 0 ? (
          <div style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg)',
            padding: '8px 10px',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {props.reusedCreatives.map((entry, index) => (
              <div key={entry.id} style={{ fontSize: 11, color: 'var(--color-fg-2)' }}>
                <span style={{ color: 'var(--color-fg-3)', fontWeight: 700 }}>{index + 1}.</span>{' '}
                {entry.summary || entry.productName}
              </div>
            ))}
            <div style={{ fontSize: 10, color: 'var(--color-fg-3)', marginTop: 2 }}>
              Full item details — code, sizes, colours, price — are read from each
              product when the post publishes.
            </div>
          </div>
        ) : (
          <input
            className="app-input"
            placeholder="e.g. Breezy Summer Dress — Rayon — Rs 2,950"
            value={props.imageDescription}
            onChange={(e) => props.setImageDescription(e.target.value)}
            disabled={props.isLoading}
          />
        )}
      </div>

      {/* AI caption suggestions */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>AI Caption Suggestions</label>
          <button
            type="button"
            onClick={props.onRegenerateCaptions}
            disabled={props.isLoading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-fg-2)',
              fontSize: 11, fontWeight: 600,
              cursor: props.isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {Ic.refresh}
            {props.isGeneratingCaptions ? 'Generating…' : 'Regenerate'}
          </button>
        </div>

        {props.isGeneratingCaptions && props.generatedCaptions.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--color-fg-3)',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--color-border)',
          }}>
            Analyzing image &amp; generating captions…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {props.generatedCaptions.map((c, i) => {
              const isSelected = props.caption === c;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => props.setCaption(c)}
                  disabled={props.isLoading}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected
                      ? '1.5px solid var(--color-accent)'
                      : '1px solid var(--color-border)',
                    background: isSelected ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
                    color: 'var(--color-fg-1)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: isSelected ? 'var(--color-accent)' : 'var(--color-fg-3)',
                    display: 'block', marginBottom: 4,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    Option {i + 1}
                  </span>
                  {c}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Caption editor */}
      <div>
        <label style={labelStyle}>
          Caption{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (used for any channel you do not customise below)
          </span>
        </label>
        <textarea
          className="app-textarea"
          placeholder="Write your caption here, or pick a suggestion above…"
          value={props.caption}
          onChange={(e) => props.setCaption(e.target.value)}
          disabled={props.isLoading}
          rows={5}
          style={{ minHeight: 120 }}
        />
        <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 4, textAlign: 'right' }}>
          {props.caption.length} characters
        </div>
      </div>

      {/* Per-channel copy — Instagram wants hashtags, Facebook wants prose */}
      {props.channels.length > 0 && (
        <div>
          <label style={labelStyle}>
            Per-Channel Copy{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              (leave blank to publish the caption above)
            </span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {props.channels.map(channel => {
              const value = props.channelCaptions[channel] ?? '';
              const suggestions = props.suggestionsByChannel[channel] ?? [];
              const isInstagram = channel === 'instagram';
              return (
                <div
                  key={channel}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 10,
                    background: 'var(--color-bg)',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7,
                    fontSize: 12, fontWeight: 700,
                    color: isInstagram ? '#A8276E' : '#0866FF',
                  }}>
                    {isInstagram ? Ic.ig : Ic.fb}
                    {CHANNEL_LABEL[channel] ?? channel}
                  </div>

                  {suggestions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 7 }}>
                      {suggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => props.setChannelCaption(channel, suggestion)}
                          disabled={props.isLoading}
                          title={suggestion}
                          style={{
                            padding: '4px 9px', fontSize: 10, fontWeight: 700,
                            border: value === suggestion
                              ? '1px solid var(--color-accent)'
                              : '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            background: value === suggestion ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                            color: value === suggestion ? 'var(--color-accent)' : 'var(--color-fg-2)',
                            cursor: props.isLoading ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Option {index + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  <textarea
                    className="app-textarea"
                    placeholder={isInstagram
                      ? 'Punchy copy ending with 3-5 hashtags…'
                      : 'Longer, conversational copy…'}
                    value={value}
                    onChange={(e) => props.setChannelCaption(channel, e.target.value)}
                    disabled={props.isLoading}
                    rows={3}
                    style={{ minHeight: 76, fontSize: 12 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--color-fg-3)', marginTop: 3, textAlign: 'right' }}>
                    {value.trim()
                      ? `${value.length} characters`
                      : 'Using the shared caption'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live preview */}
      {props.caption.trim() && (
        <div>
          <label style={labelStyle}>Preview</label>
          <SocialPreview
            brand={props.brand}
            channels={props.channels}
            caption={props.caption}
            captionsByChannel={props.channelCaptions}
            imageDataList={props.generatedImageDataList}
          />
        </div>
      )}
    </>
  );
}

// ── Step 4 — Publish ─────────────────────────────────────────────────────────

interface Step4Props {
  brand: string;
  channels: string[];
  caption: string;
  imageDescription: string;
  generatedImageDataList: string[];
  isFinishing: boolean;
}

function Step4Publish(props: Step4Props) {
  return (
    <>
      <div style={{ fontSize: 13, color: 'var(--color-fg-2)', lineHeight: 1.6 }}>
        Review your post before publishing. You can save as draft to edit later, or publish now to&nbsp;
        {props.channels.map((ch, i) => (
          <span key={ch}>
            <strong>{ch === 'instagram' ? 'Instagram' : 'Facebook'}</strong>
            {i < props.channels.length - 1 ? ', ' : ''}
          </span>
        ))}
        .
      </div>

      <SocialPreview
        brand={props.brand}
        channels={props.channels}
        caption={props.caption}
        imageDataList={props.generatedImageDataList}
      />

      {props.imageDescription && (
        <div style={{
          fontSize: 11, color: 'var(--color-fg-3)',
          padding: '8px 12px',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border-subtle)',
        }}>
          <strong>Image label:</strong> {props.imageDescription}
        </div>
      )}

      {props.isFinishing && (
        <div style={{
          padding: '12px',
          background: 'var(--color-accent-subtle)',
          color: 'var(--color-accent)',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          textAlign: 'center',
        }}>
          Saving creative, creating post and publishing…
        </div>
      )}
    </>
  );
}

// ── Social media preview ─────────────────────────────────────────────────────

// Renders one card per channel once their copy diverges, so the user can see
// what each audience will actually get rather than a single blended preview.
function SocialPreview({
  brand,
  channels,
  caption,
  captionsByChannel,
  imageDataList,
}: {
  brand: string;
  channels: string[];
  caption: string;
  captionsByChannel?: Record<string, string>;
  imageDataList: string[];
}) {
  const resolved = channels.map(channel => ({
    channel,
    caption: captionsByChannel?.[channel]?.trim() || caption,
  }));
  const allSame = resolved.every(entry => entry.caption === resolved[0]?.caption);

  if (allSame || resolved.length === 0) {
    return <PreviewCard brand={brand} channels={channels} caption={caption} imageDataList={imageDataList} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {resolved.map(entry => (
        <PreviewCard
          key={entry.channel}
          brand={brand}
          channels={[entry.channel]}
          caption={entry.caption}
          imageDataList={imageDataList}
        />
      ))}
    </div>
  );
}

function PreviewCard({
  brand,
  channels,
  caption,
  imageDataList,
}: {
  brand: string;
  channels: string[];
  caption: string;
  imageDataList: string[];
}) {
  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--color-accent)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 13, fontWeight: 700,
        }}>
          {brand.charAt(0)}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-fg-1)' }}>
            {brand || 'Brand Name'}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            {channels.map((ch) => (
              <span
                key={ch}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 6px', borderRadius: 999,
                  fontSize: 9, fontWeight: 700,
                  background: ch === 'instagram' ? '#FBE7F2' : '#E8F0FF',
                  color: ch === 'instagram' ? '#A8276E' : '#0866FF',
                }}
              >
                {ch === 'instagram' ? Ic.ig : Ic.fb}
                {ch === 'instagram' ? 'Instagram' : 'Facebook'}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Images */}
      {imageDataList.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: imageDataList.length === 1 ? '1fr' : 'repeat(2, 1fr)',
          gap: 2,
          background: 'var(--color-border-subtle)',
        }}>
          {imageDataList.map((imageData, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${imageData}-${index}`}
              src={imageData}
              alt={`Post preview ${index + 1}`}
              style={{
                display: 'block',
                width: '100%',
                aspectRatio: imageDataList.length === 1 ? '4/5' : '1/1',
                maxHeight: imageDataList.length === 1 ? 360 : 260,
                objectFit: 'cover',
              }}
            />
          ))}
        </div>
      )}

      {/* Caption */}
      <p style={{
        fontSize: 13, color: 'var(--color-fg-1)',
        lineHeight: 1.6, margin: 0,
        padding: '12px 14px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {caption}
      </p>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-3)',
  marginBottom: 6,
};
