'use client';

import React, { useState, useTransition } from 'react';
import { PERSONAS_BY_BRAND, type PersonaId } from '@/lib/persona-data';
import type { ViewAngle } from '@/lib/creative-generator';
import {
  generateCreativeBatchAction,
  regenerateCreativeAction,
  saveGeneratedCreative,
  discardCreativeDraft,
  searchProductsForContent,
  generatePostCaptions,
  createSocialPost,
  publishSocialPost,
  getCreativesForProduct,
} from './actions';

const VIEW_ANGLES: { id: ViewAngle; label: string }[] = [
  { id: 'front',   label: 'Front' },
  { id: 'side',    label: 'Side' },
  { id: 'back',    label: 'Back' },
  { id: 'closeup', label: 'Close-up' },
];

interface DraftResult {
  creativeId: number;
  imageData: string;
  prompt: string;
  viewAngle?: ViewAngle;
}

interface ExistingCreative {
  id: number;
  viewAngle: string | null;
  personaStyle: string | null;
  createdAt: string | Date;
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
  name: string;
  brand: string;
  style: string | null;
  price: number;
  fabric: string | null;
  colors: string | null;
  sizes: string | null;
  imageUrl: string | null;
}

interface CreatePostWizardModalProps {
  availableBrands: string[] | null;
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
  const defaultBrands = availableBrands ?? ['Happyby', 'Cleopatra', 'Modabella'];

  const [step, setStep] = useState<Step>(1);

  // Step 1 — Setup
  const [brand, setBrand] = useState(defaultBrands[0]);
  const [personaId, setPersonaId] = useState<PersonaId>(
    PERSONAS_BY_BRAND[defaultBrands[0]]?.[0]?.id ?? 'none',
  );
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null);
  const [productContext, setProductContext] = useState('');
  const [sourceImageUrl, setSourceImageUrl] = useState('');

  // Step 1 cont. — view angles + existing creatives (per linked product)
  const [viewAngles, setViewAngles] = useState<ViewAngle[]>(['front']);
  const [existingCreatives, setExistingCreatives] = useState<ExistingCreative[]>([]);

  // Step 2 — Generate (drafts is the batch; selectedDraftIds are carried into Step 3/4)
  const [drafts, setDrafts] = useState<DraftResult[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<number[]>([]);
  const [reusedExistingId, setReusedExistingId] = useState<number | null>(null);
  const [correctionTextById, setCorrectionTextById] = useState<Record<number, string>>({});
  const [regeneratingDraftId, setRegeneratingDraftId] = useState<number | null>(null);

  // Convenience: selected creative images (fresh drafts or one reused existing creative).
  const selectedDrafts = selectedDraftIds
    .map(id => drafts.find(d => d.creativeId === id))
    .filter((d): d is DraftResult => Boolean(d));
  const selectedDraft = selectedDrafts[0] ?? null;
  const generatedImageData = selectedDrafts[0]?.imageData
    ?? (reusedExistingId !== null ? `/api/content/creatives/${reusedExistingId}/image` : null);
  const generatedImageDataList = selectedDrafts.length > 0
    ? selectedDrafts.map(d => d.imageData)
    : (reusedExistingId !== null ? [`/api/content/creatives/${reusedExistingId}/image`] : []);
  const usedPrompt = selectedDraft?.prompt ?? null;
  const selectedCreativeIds = reusedExistingId !== null ? [reusedExistingId] : selectedDraftIds;

  // Step 3 — Caption & Review
  const [channels, setChannels] = useState<string[]>(['facebook', 'instagram']);
  const [generatedCaptions, setGeneratedCaptions] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [imageDescription, setImageDescription] = useState('');

  // Step 4 — Publish (no extra state — uses prior fields)

  const [formError, setFormError] = useState<string | null>(null);

  const [isSearching, startSearching] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [isRegeneratingDraft, startRegeneratingDraft] = useTransition();
  const [isGeneratingCaptions, startGeneratingCaptions] = useTransition();
  const [isFinishing, startFinishing] = useTransition();

  const isLoading = isGenerating || isRegeneratingDraft || isGeneratingCaptions || isFinishing;

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
    setProductContext(context);
    setProductSearch(product.name);
    setSearchResults([]);
    if (product.imageUrl) setSourceImageUrl(product.imageUrl);
    // Load existing saved creatives for this product so the user can reuse them.
    getCreativesForProduct(product.id).then(res => {
      if (res.success && 'creatives' in res && res.creatives) {
        setExistingCreatives(res.creatives as unknown as ExistingCreative[]);
      } else {
        setExistingCreatives([]);
      }
    }).catch(() => setExistingCreatives([]));
  }

  function handleClearProduct() {
    setSelectedProduct(null);
    setProductContext('');
    setProductSearch('');
    setSourceImageUrl('');
    setExistingCreatives([]);
    setReusedExistingId(null);
  }

  function toggleAngle(angle: ViewAngle) {
    setViewAngles(prev =>
      prev.includes(angle) ? prev.filter(a => a !== angle) : [...prev, angle],
    );
  }

  function handleReuseExisting(id: number) {
    // Reusing a saved creative skips Step 2 entirely — no Gemini call, no draft cleanup.
    discardAllUnsavedDrafts().catch(() => {});
    setDrafts([]);
    setSelectedDraftIds([]);
    setReusedExistingId(id);
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
    if (viewAngles.length === 0) {
      setFormError('Select at least one view angle.');
      return;
    }

    startGenerating(async () => {
      // Discard ALL prior drafts (including any previously selected one) before regenerating.
      const allOldIds = drafts.map(d => d.creativeId);
      await Promise.all(allOldIds.map(id => discardCreativeDraft(id).catch(() => {})));
      setDrafts([]);
      setCorrectionTextById({});
      setSelectedDraftIds([]);
      setReusedExistingId(null);

      const result = await generateCreativeBatchAction({
        brand: brand.trim(),
        personaId,
        productContext,
        sourceImageUrl: sourceImageUrl.trim() || undefined,
        productId: selectedProduct?.id,
        viewAngles,
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
      const result = await regenerateCreativeAction(creativeId, correctionText);
      setRegeneratingDraftId(null);

      if (result.success && result.imageData) {
        setDrafts(prev => prev.map(d => (
          d.creativeId === creativeId
            ? {
                ...d,
                imageData: result.imageData!,
                prompt: result.prompt ?? d.prompt,
                viewAngle: result.viewAngle ?? d.viewAngle,
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
      const result = await generatePostCaptions({
        brand: brand.trim(),
        channels,
        productContext: productContext.trim() || undefined,
        imageBase64: generatedImageData ?? undefined,
      });
      if (result.success && result.captions) {
        setGeneratedCaptions(result.captions);
        if (!caption.trim() && result.captions.length > 0) {
          setCaption(result.captions[0]);
        }
      } else {
        setFormError(result.error ?? 'Caption generation failed.');
      }
    });
  }

  function buildAutoDescription(): string {
    if (selectedProduct) {
      const parts = [selectedProduct.name];
      if (selectedProduct.fabric) parts.push(selectedProduct.fabric);
      parts.push(`Rs ${selectedProduct.price}`);
      return parts.join(' — ');
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
    // Seed image description from product data if empty
    if (!imageDescription.trim()) {
      setImageDescription(buildAutoDescription());
    }
    setStep(3);
    // Auto-trigger caption generation if not already populated
    if (generatedCaptions.length === 0) {
      generateCaptionsForImage();
    }
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
      if (reusedExistingId === null) {
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
        generatedCaptions: generatedCaptions.length > 0 ? generatedCaptions : undefined,
        productContext: productContext.trim() || undefined,
        status: 'draft',
        postCreatives: selectedCreativeIds.map((creativeId, index) => ({
          creativeId,
          description: imageDescription.trim() || undefined,
          displayOrder: index,
        })),
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
      if (reusedExistingId === null) {
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
        generatedCaptions: generatedCaptions.length > 0 ? generatedCaptions : undefined,
        productContext: productContext.trim() || undefined,
        status: 'ready',
        postCreatives: selectedCreativeIds.map((creativeId, index) => ({
          creativeId,
          description: imageDescription.trim() || undefined,
          displayOrder: index,
        })),
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
              sourceImageUrl={sourceImageUrl}
              setSourceImageUrl={setSourceImageUrl}
              viewAngles={viewAngles}
              toggleAngle={toggleAngle}
              existingCreatives={existingCreatives}
              onReuseExisting={handleReuseExisting}
              isLoading={isLoading}
            />
          )}

          {step === 2 && (
            <Step2Generate
              brand={brand}
              personaId={personaId}
              productContext={productContext}
              sourceImageUrl={sourceImageUrl}
              viewAngles={viewAngles}
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
              imageDescription={imageDescription}
              setImageDescription={setImageDescription}
              caption={caption}
              setCaption={setCaption}
              generatedCaptions={generatedCaptions}
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
  sourceImageUrl: string;
  setSourceImageUrl: (s: string) => void;
  viewAngles: ViewAngle[];
  toggleAngle: (a: ViewAngle) => void;
  existingCreatives: ExistingCreative[];
  onReuseExisting: (creativeId: number) => void;
  isLoading: boolean;
}

function Step1Setup(props: Step1Props) {
  const personaList = [
    { id: 'none', label: 'Product only', imageUrl: null as string | null },
    ...(PERSONAS_BY_BRAND[props.brand] || []).map((p) => ({ id: p.id, label: p.label, imageUrl: p.imageUrl })),
  ];

  return (
    <>
      {/* Brand */}
      <div>
        <label style={labelStyle}>Brand</label>
        <select
          className="app-input"
          value={props.brand}
          onChange={(e) => props.setBrand(e.target.value)}
          disabled={props.isLoading}
        >
          {props.defaultBrands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Product picker */}
      <div style={{ position: 'relative' }}>
        <label style={labelStyle}>
          Product{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (search to auto-fill description &amp; image)
          </span>
        </label>
        {props.selectedProduct ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: props.selectedProduct.imageUrl ? '96px 1fr auto' : '1fr auto',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            {props.selectedProduct.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.selectedProduct.imageUrl}
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
        ) : (
          <>
            <input
              className="app-input"
              placeholder="Search products by name…"
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
                    {p.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
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
        )}
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

      {/* Source image — auto-filled from linked product, otherwise URL field */}
      {props.selectedProduct ? null : (
        <div>
          <label style={labelStyle}>
            Source Image URL{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              (optional — or link a product above to auto-fill)
            </span>
          </label>
          <input
            className="app-input"
            placeholder="https://example.com/product-photo.jpg"
            value={props.sourceImageUrl}
            onChange={(e) => props.setSourceImageUrl(e.target.value)}
            disabled={props.isLoading}
          />
          {props.sourceImageUrl.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.sourceImageUrl}
              alt="Source product"
              style={{
                marginTop: 8,
                maxHeight: 180,
                maxWidth: '100%',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                objectFit: 'contain',
                background: 'white',
              }}
            />
          )}
        </div>
      )}

      {/* View angles */}
      <div>
        <label style={labelStyle}>
          View Angles{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (one image per selected angle — each costs a generation)
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

      {/* Existing creatives — reuse instead of regenerate to save tokens */}
      {props.selectedProduct && props.existingCreatives.length > 0 && (
        <div>
          <label style={labelStyle}>
            Reuse Existing Creative{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
              ({props.existingCreatives.length} saved for this product — click to skip generation)
            </span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {props.existingCreatives.slice(0, 8).map(c => (
              <div
                key={c.id}
                onClick={() => !props.isLoading && props.onReuseExisting(c.id)}
                style={{
                  border: '1px solid var(--color-border)',
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
                <div style={{ padding: 4, fontSize: 10, textAlign: 'center', color: 'var(--color-fg-3)' }}>
                  {c.viewAngle ?? 'front'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Persona */}
      <div>
        <label style={labelStyle}>Model Persona</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
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
  sourceImageUrl: string;
  viewAngles: ViewAngle[];
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

function Step2Generate(props: Step2Props) {
  const angleLabel = props.viewAngles.length > 1
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
        <div style={{ marginTop: 4 }}>
          <strong>Description:</strong> {props.productContext.slice(0, 180)}{props.productContext.length > 180 ? '…' : ''}
        </div>
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
              ? `Generating ${props.viewAngles.length} branded marketing image${props.viewAngles.length > 1 ? 's' : ''}…`
              : `Click below to generate ${props.viewAngles.length} AI marketing image${props.viewAngles.length > 1 ? 's' : ''} using your brand style and persona.`}
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
            gridTemplateColumns: props.drafts.length === 1 && props.sourceImageUrl.trim() ? 'repeat(2, 1fr)' : props.drafts.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {props.sourceImageUrl.trim() && (
              <div style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={props.sourceImageUrl}
                  alt="Source product reference"
                  style={{ display: 'block', width: '100%', height: 320, objectFit: 'contain', background: 'white' }}
                />
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={d.imageData}
                    alt={`Generated ${d.viewAngle ?? 'creative'}`}
                    style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain' }}
                  />
                  <div style={{
                    padding: '6px 10px',
                    fontSize: 11, fontWeight: 600,
                    color: selected ? 'var(--color-accent)' : 'var(--color-fg-2)',
                    background: selected ? 'var(--color-accent-subtle)' : 'transparent',
                    borderTop: '1px solid var(--color-border-subtle)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ textTransform: 'capitalize' }}>{d.viewAngle ?? 'front'}</span>
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
    </>
  );
}

// ── Step 3 — Caption & Review ────────────────────────────────────────────────

interface Step3Props {
  brand: string;
  channels: string[];
  toggleChannel: (ch: string) => void;
  generatedImageDataList: string[];
  imageDescription: string;
  setImageDescription: (s: string) => void;
  caption: string;
  setCaption: (s: string) => void;
  generatedCaptions: string[];
  isGeneratingCaptions: boolean;
  onRegenerateCaptions: () => void;
  isLoading: boolean;
}

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

      {/* Image description */}
      <div>
        <label style={labelStyle}>
          Image Description{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
            (auto-filled — short label for this creative)
          </span>
        </label>
        <input
          className="app-input"
          placeholder="e.g. Breezy Summer Dress — Rayon — Rs 2,950"
          value={props.imageDescription}
          onChange={(e) => props.setImageDescription(e.target.value)}
          disabled={props.isLoading}
        />
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
        <label style={labelStyle}>Caption</label>
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

      {/* Live preview */}
      {props.caption.trim() && (
        <div>
          <label style={labelStyle}>Preview</label>
          <SocialPreview
            brand={props.brand}
            channels={props.channels}
            caption={props.caption}
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

function SocialPreview({
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
                aspectRatio: imageDataList.length === 1 ? '4/3' : '1/1',
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
