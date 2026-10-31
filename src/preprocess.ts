import { OCRInput } from './types';

export interface PreprocessOptions {
  autoInvertDarkMode?: boolean;
  contrastBoost?: boolean;
}

/**
 * Preprocesses and normalizes images on an offscreen canvas in browser environments.
 * Automatically samples luminance to detect dark-mode screenshots (e.g. IDEs, terminals)
 * and inverts colors + adjusts contrast to maximize OCR character recognition rates.
 * Gracefully returns the original input unchanged in Node.js or headless environments.
 */
export async function preprocessImage(
  input: OCRInput,
  options?: PreprocessOptions
): Promise<OCRInput> {
  // If not running in a browser DOM environment, gracefully no-op
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return input;
  }

  const autoInvert = options?.autoInvertDarkMode !== false;
  const contrastBoost = options?.contrastBoost !== false;

  if (!autoInvert && !contrastBoost) {
    return input;
  }

  try {
    let imgElement: HTMLImageElement | null = null;
    let objectUrlToRevoke: string | null = null;

    if (input instanceof HTMLImageElement && input.complete && input.naturalWidth > 0) {
      imgElement = input;
    } else if (input instanceof HTMLCanvasElement) {
      // Direct canvas input
      return processCanvas(input, autoInvert, contrastBoost);
    } else {
      let src = '';
      if (typeof input === 'string') {
        src = input;
      } else if (input instanceof Blob || input instanceof File) {
        src = URL.createObjectURL(input);
        objectUrlToRevoke = src;
      } else if (input instanceof Uint8Array) {
        const blob = new Blob([input as unknown as BlobPart], { type: 'image/png' });
        src = URL.createObjectURL(blob);
        objectUrlToRevoke = src;
      }

      if (!src) return input;

      imgElement = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width || 600;
    canvas.height = imgElement.naturalHeight || imgElement.height || 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return input;

    ctx.drawImage(imgElement, 0, 0);

    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }

    const processedCanvas = processCanvas(canvas, autoInvert, contrastBoost);

    // If original input was a File, preserve file identity and name
    if (input instanceof File) {
      return new Promise<OCRInput>((resolve) => {
        processedCanvas.toBlob((blob) => {
          if (!blob) return resolve(processedCanvas);
          resolve(new File([blob], input.name, { type: input.type || 'image/png' }));
        }, input.type || 'image/png');
      });
    }

    return processedCanvas;
  } catch (err) {
    // If any error occurs during canvas operations (e.g. CORS), gracefully fallback to input
    return input;
  }
}

function processCanvas(
  canvas: HTMLCanvasElement,
  autoInvert: boolean,
  contrastBoost: boolean
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 1. Sample luminance across pixels
  let totalLuminance = 0;
  let sampleCount = 0;
  const step = 4; // Sample every 4th pixel for speed

  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
    sampleCount++;
  }

  const avgLuminance = sampleCount > 0 ? totalLuminance / sampleCount : 128;
  const isDarkMode = avgLuminance < 65; // Low background luminance indicates dark mode

  // 2. Invert if dark mode detected and auto-inversion requested
  const shouldInvert = isDarkMode && autoInvert;

  if (shouldInvert || contrastBoost) {
    // Contrast adjustment factor (subtle +15 boost)
    const contrast = contrastBoost ? 15 : 0;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (shouldInvert) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      if (contrastBoost) {
        r = Math.min(255, Math.max(0, factor * (r - 128) + 128));
        g = Math.min(255, Math.max(0, factor * (g - 128) + 128));
        b = Math.min(255, Math.max(0, factor * (b - 128) + 128));
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }

    ctx.putImageData(imgData, 0, 0);
  }

  return canvas;
}
