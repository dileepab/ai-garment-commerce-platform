// Browser-only canvas resize. Keeps aspect ratio; downscales only.
// Used before uploading product photos so iPhone shots don't bloat storage.
//
// 2048px / q=0.85 preserves every detail Gemini uses for try-on (print, color,
// fabric texture). Larger sources are wasted bytes — Gemini caps inputs at
// ~3072px and resamples internally.

export interface ResizeOptions {
  maxEdge?: number;   // longest edge in pixels (default 2048)
  quality?: number;   // 0..1 JPEG quality (default 0.85)
  mimeType?: string;  // 'image/jpeg' | 'image/webp' (default 'image/jpeg')
}

export async function resizeImageFile(
  file: File,
  options: ResizeOptions = {},
): Promise<File> {
  const { maxEdge = 2048, quality = 0.85, mimeType = 'image/jpeg' } = options;

  if (typeof window === 'undefined') {
    throw new Error('resizeImageFile must run in the browser.');
  }

  const bitmap = await createImageBitmap(file).catch(async () => {
    // Fallback for browsers without createImageBitmap support for the file type
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      return img as unknown as ImageBitmap;
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  const srcW = (bitmap as ImageBitmap).width || (bitmap as unknown as HTMLImageElement).naturalWidth;
  const srcH = (bitmap as ImageBitmap).height || (bitmap as unknown as HTMLImageElement).naturalHeight;

  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D canvas context.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, dstW, dstH);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null.'))),
      mimeType,
      quality,
    );
  });

  // If resize made it larger (rare, e.g. tiny PNG), keep original
  if (blob.size >= file.size && scale === 1) return file;

  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${baseName}.${ext}`, { type: mimeType });
}
