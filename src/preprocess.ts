import { OCRInput } from './types';

export interface PreprocessOptions {
  autoInvertDarkMode?: boolean;
  contrastBoost?: boolean;
}

const MAX_DIMENSION = 1800;
const MIN_HEIGHT_UPSCALE = 450;

/**
 * Fast 32-bit FNV-1a hash function returning an 8-character hex string.
 */
function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes a fast perceptual fingerprint/hash for OCR input using pixel samples,
 * byte length, name, and timestamps to power <1ms instant LRU caching.
 */
export async function computeInputHash(input: OCRInput): Promise<string> {
  if (typeof input === 'string') {
    if (input.startsWith('data:') || input.length > 512) {
      const sample = `${input.slice(0, 128)}_${input.slice(-128)}_${input.length}`;
      return 'str_' + fnv1aHex(sample);
    }
    return 'str_' + fnv1aHex(input);
  }

  if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
    let pixelSample = '';
    const ctx = input.getContext('2d');
    if (ctx && input.width > 0 && input.height > 0) {
      const sampleCanvas = ctx.getImageData(
        0,
        0,
        Math.min(input.width, 32),
        Math.min(input.height, 32)
      ).data;
      pixelSample = `${sampleCanvas[0]}_${sampleCanvas[Math.floor(sampleCanvas.length / 2)]}_${sampleCanvas[sampleCanvas.length - 1]}`;
    }
    return `cvs_${input.width}x${input.height}_` + fnv1aHex(pixelSample);
  }

  if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
    const srcKey = input.src ? input.src.slice(0, 100) : '';
    return `img_${input.naturalWidth || input.width}x${input.naturalHeight || input.height}_` + fnv1aHex(srcKey);
  }

  if (input instanceof Uint8Array) {
    const len = input.length;
    const sample = `${len}_${input[0] ?? 0}_${input[Math.floor(len / 2)] ?? 0}_${input[len - 1] ?? 0}`;
    return 'u8_' + fnv1aHex(sample);
  }

  if (
    typeof Blob !== 'undefined' &&
    (input instanceof Blob || (typeof File !== 'undefined' && input instanceof File))
  ) {
    const name = input instanceof File ? input.name : 'blob';
    const lastMod = input instanceof File ? input.lastModified : 0;
    const size = input.size;
    const type = input.type || '';
    let sliceSample = '';

    if (typeof input.slice === 'function') {
      try {
        const slice = input.slice(0, Math.min(size, 2048));
        const buf = await slice.arrayBuffer();
        const u8 = new Uint8Array(buf);
        sliceSample = `${u8[0] ?? 0}_${u8[Math.floor(u8.length / 2)] ?? 0}_${u8[u8.length - 1] ?? 0}`;
      } catch {
        // Fallback to metadata
      }
    }
    return `file_${fnv1aHex(`${name}_${size}_${lastMod}_${type}_${sliceSample}`)}`;
  }

  return 'obj_' + fnv1aHex(String(input));
}

function calculateTargetDimensions(
  origW: number,
  origH: number
): { width: number; height: number } {
  let width = origW;
  let height = origH;

  const maxDim = Math.max(width, height);
  if (maxDim > MAX_DIMENSION) {
    // 1. Resolution capping: downscale huge 4K screenshots for 3x faster WASM execution
    const scale = MAX_DIMENSION / maxDim;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  } else if (height < MIN_HEIGHT_UPSCALE && width > 0 && height > 0) {
    // 2. 2x upscaling when image height < 450px to boost small-font IDE/table accuracy
    const scale = 2;
    if (width * scale <= MAX_DIMENSION && height * scale <= MAX_DIMENSION) {
      width = width * scale;
      height = height * scale;
    }
  }

  return { width, height };
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
      const { width: targetW, height: targetH } = calculateTargetDimensions(
        input.width,
        input.height
      );
      let workingCanvas = input;
      if (targetW !== input.width || targetH !== input.height) {
        const scaled = document.createElement('canvas');
        scaled.width = targetW;
        scaled.height = targetH;
        const sCtx = scaled.getContext('2d');
        if (sCtx) {
          sCtx.imageSmoothingEnabled = true;
          sCtx.imageSmoothingQuality = 'high';
          sCtx.drawImage(input, 0, 0, targetW, targetH);
          workingCanvas = scaled;
        }
      }
      return processCanvas(workingCanvas, autoInvert, contrastBoost);
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

    const origW = imgElement.naturalWidth || imgElement.width || 600;
    const origH = imgElement.naturalHeight || imgElement.height || 600;
    const { width: targetW, height: targetH } = calculateTargetDimensions(origW, origH);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return input;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgElement, 0, 0, targetW, targetH);

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
  const shouldInvert = isDarkMode && autoInvert;

  // 2. Local adaptive background estimation (32x32 block grid for shadow suppression)
  const blockSize = 32;
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const bgGrid = new Float32Array(cols * rows);

  for (let y = 0; y < height; y += 4) {
    const by = Math.floor(y / blockSize);
    for (let x = 0; x < width; x += 4) {
      const bx = Math.floor(x / blockSize);
      const idx = (y * width + x) * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];
      if (shouldInvert) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const gridIdx = by * cols + bx;
      if (lum > bgGrid[gridIdx]) {
        bgGrid[gridIdx] = lum;
      }
    }
  }

  // 3. Contrast adjustment factor
  const contrast = contrastBoost ? 18 : 6;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / blockSize);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];

      if (shouldInvert) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      // Local background shadow suppression
      const bx = Math.floor(x / blockSize);
      const localBg = Math.max(bgGrid[by * cols + bx] || 128, 40);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum > localBg * 0.85) {
        r = Math.min(255, r * (255 / localBg));
        g = Math.min(255, g * (255 / localBg));
        b = Math.min(255, b * (255 / localBg));
      }

      if (contrastBoost) {
        r = Math.min(255, Math.max(0, factor * (r - 128) + 128));
        g = Math.min(255, Math.max(0, factor * (g - 128) + 128));
        b = Math.min(255, Math.max(0, factor * (b - 128) + 128));
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
