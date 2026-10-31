import { createWorker } from 'tesseract.js';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { OCRLine, OCRWord, OCRResult, OCROptions, OCRInput } from './types';
import { reconstructMarkdown } from './layout-to-md';
import { calculateTokenMetrics, determineRoutingRecommendation } from './token-metrics';
import { preprocessImage } from './preprocess';
import { redactSensitiveData } from './pii-redactor';

export type { OCRInput };

/**
 * Maps Tesseract.js hierarchical blocks -> paragraphs -> lines -> words into OCRLine[].
 */
function extractLinesFromPage(data: any): OCRLine[] {
  const resultLines: OCRLine[] = [];

  if (Array.isArray(data?.blocks)) {
    for (const block of data.blocks) {
      if (Array.isArray(block?.paragraphs)) {
        for (const paragraph of block.paragraphs) {
          if (Array.isArray(paragraph?.lines)) {
            for (const line of paragraph.lines) {
              const words: OCRWord[] = Array.isArray(line?.words)
                ? line.words.map((w: any) => ({
                    text: w?.text || '',
                    confidence: typeof w?.confidence === 'number' ? w.confidence : 100,
                    bbox: {
                      x0: w?.bbox?.x0 ?? 0,
                      y0: w?.bbox?.y0 ?? 0,
                      x1: w?.bbox?.x1 ?? 0,
                      y1: w?.bbox?.y1 ?? 0,
                    },
                  }))
                : [];

              resultLines.push({
                text: line?.text || '',
                words,
                bbox: {
                  x0: line?.bbox?.x0 ?? 0,
                  y0: line?.bbox?.y0 ?? 0,
                  x1: line?.bbox?.x1 ?? 0,
                  y1: line?.bbox?.y1 ?? 0,
                },
              });
            }
          }
        }
      }
    }
  } else if (Array.isArray(data?.lines)) {
    for (const line of data.lines) {
      const words: OCRWord[] = Array.isArray(line?.words)
        ? line.words.map((w: any) => ({
            text: w?.text || '',
            confidence: typeof w?.confidence === 'number' ? w.confidence : 100,
            bbox: {
              x0: w?.bbox?.x0 ?? 0,
              y0: w?.bbox?.y0 ?? 0,
              x1: w?.bbox?.x1 ?? 0,
              y1: w?.bbox?.y1 ?? 0,
            },
          }))
        : [];

      resultLines.push({
        text: line?.text || '',
        words,
        bbox: {
          x0: line?.bbox?.x0 ?? 0,
          y0: line?.bbox?.y0 ?? 0,
          x1: line?.bbox?.x1 ?? 0,
          y1: line?.bbox?.y1 ?? 0,
        },
      });
    }
  }

  return resultLines;
}

/**
 * Wraps extracted OCR markdown into a clean XML block ready for LLM prompt injection.
 */
export function formatForPrompt(result: OCRResult): string {
  const confidenceStr =
    typeof result.confidence === 'number'
      ? `${Math.round(result.confidence * 10) / 10}`
      : String(result.confidence);

  return `<attachment_ocr name="${result.attachmentName}" confidence="${confidenceStr}" tokens_saved="${result.estimatedVisionTokensSaved}">\n${result.markdown}\n</attachment_ocr>`;
}

/**
 * Client for executing zero-egress, client-side OCR in a cached Web Worker.
 */
export class LocalOCRClient {
  private workerPromise: Promise<TesseractWorker> | null = null;
  private currentLanguage: string = 'eng';
  private defaultOptions?: OCROptions;
  private currentProgressCallback?: (progress: number, status: string) => void;

  constructor(defaultOptions?: OCROptions) {
    this.defaultOptions = defaultOptions;
    if (defaultOptions?.language) {
      this.currentLanguage = defaultOptions.language;
    }
  }

  private async getWorker(
    language: string = 'eng',
    onProgress?: (progress: number, status: string) => void
  ): Promise<TesseractWorker> {
    this.currentProgressCallback = onProgress;

    if (!this.workerPromise) {
      this.currentLanguage = language;
      this.workerPromise = createWorker(language, 1, {
        logger: (m: { status?: string; progress?: number }) => {
          const prog = typeof m?.progress === 'number' ? Math.round(m.progress * 100) : 0;
          const status = m?.status || 'processing';
          if (this.currentProgressCallback) {
            this.currentProgressCallback(prog, status);
          } else if (this.defaultOptions?.onProgress) {
            this.defaultOptions.onProgress(prog, status);
          }
        },
      });
    } else if (this.currentLanguage !== language) {
      const worker = await this.workerPromise;
      if (typeof (worker as any).reinitialize === 'function') {
        await (worker as any).reinitialize(language);
        this.currentLanguage = language;
      } else {
        await worker.terminate?.();
        this.currentLanguage = language;
        this.workerPromise = createWorker(language, 1, {
          logger: (m: { status?: string; progress?: number }) => {
            const prog = typeof m?.progress === 'number' ? Math.round(m.progress * 100) : 0;
            const status = m?.status || 'processing';
            if (this.currentProgressCallback) {
              this.currentProgressCallback(prog, status);
            } else if (this.defaultOptions?.onProgress) {
              this.defaultOptions.onProgress(prog, status);
            }
          },
        });
      }
    }

    return this.workerPromise;
  }

  async recognize(input: OCRInput, options?: OCROptions): Promise<OCRResult> {
    const startTime = performance.now();
    const effectiveOptions: OCROptions = {
      ...this.defaultOptions,
      ...options,
    };

    // 1. Preprocess image (auto-inversion for dark-mode screenshots, contrast boost)
    let processedInput = input;
    if (effectiveOptions.autoInvertDarkMode !== false || effectiveOptions.contrastBoost) {
      processedInput = await preprocessImage(input, {
        autoInvertDarkMode: effectiveOptions.autoInvertDarkMode,
        contrastBoost: effectiveOptions.contrastBoost,
      });
    }

    const language = effectiveOptions.language || this.currentLanguage || 'eng';
    const worker = await this.getWorker(language, effectiveOptions.onProgress);

    // Critical: { blocks: true } in Tesseract.js v7 populates hierarchical block and bbox data
    const response = await worker.recognize(
      processedInput as any,
      {},
      { text: true, blocks: true } as any
    );

    const lines = extractLinesFromPage(response?.data);
    let markdown = reconstructMarkdown(lines, effectiveOptions);
    let rawText = response?.data?.text || '';

    // 2. Client-side PII and Secret Redaction
    let redactionsApplied = 0;
    if (effectiveOptions.redactPII !== false) {
      const piiMarkdown = redactSensitiveData(markdown, effectiveOptions.piiOptions);
      markdown = piiMarkdown.sanitizedText;
      const piiRaw = redactSensitiveData(rawText, effectiveOptions.piiOptions);
      rawText = piiRaw.sanitizedText;
      redactionsApplied = piiMarkdown.redactionCount;
    }

    const metrics = calculateTokenMetrics(markdown);

    let attachmentName = 'attachment';
    if (typeof File !== 'undefined' && input instanceof File) {
      attachmentName = input.name;
    } else if (
      typeof input === 'object' &&
      input !== null &&
      'name' in input &&
      typeof (input as { name?: string }).name === 'string'
    ) {
      attachmentName = (input as { name: string }).name;
    }

    const latencyMs = Math.round(performance.now() - startTime);
    const confidence =
      typeof response?.data?.confidence === 'number'
        ? Math.round(response.data.confidence * 10) / 10
        : 100;

    // 3. Smart Vision Router Heuristic
    const totalWords = lines.reduce((acc, l) => acc + (l.words?.length || 0), 0);
    const routingRecommendation = determineRoutingRecommendation(confidence, totalWords);

    return {
      rawText,
      markdown,
      lines,
      confidence,
      latencyMs,
      estimatedVisionTokensSaved: metrics.estimatedVisionTokensSaved,
      attachmentName,
      routingRecommendation,
      redactionsApplied,
    };
  }

  async terminate(): Promise<void> {
    if (this.workerPromise) {
      try {
        const worker = await this.workerPromise;
        if (typeof worker?.terminate === 'function') {
          await worker.terminate();
        }
      } finally {
        this.workerPromise = null;
      }
    }
  }
}

let sharedClient: LocalOCRClient | null = null;

/**
 * Standalone convenience helper for processing an attachment with a shared cached OCR worker.
 */
export async function extractAttachmentOCR(
  input: OCRInput,
  options?: OCROptions
): Promise<OCRResult> {
  if (!sharedClient) {
    sharedClient = new LocalOCRClient(options);
  }
  return sharedClient.recognize(input, options);
}

/**
 * Factory for creating an isolated LocalOCRClient instance.
 */
export function createOCRClient(defaultOptions?: OCROptions): LocalOCRClient {
  return new LocalOCRClient(defaultOptions);
}
