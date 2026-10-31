export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface OCRLine {
  text: string;
  words: OCRWord[];
  bbox: BoundingBox;
}

export interface OCRResult {
  rawText: string;
  markdown: string;
  lines: OCRLine[];
  confidence: number;
  latencyMs: number;
  estimatedVisionTokensSaved: number;
  attachmentName: string;
}

export interface OCROptions {
  language?: string;
  preserveTables?: boolean;
  confidenceThreshold?: number;
  onProgress?: (progress: number, status: string) => void;
}

export interface TokenMetrics {
  extractedTextTokens: number;
  estimatedVisionTokens: number;
  estimatedVisionTokensSaved: number;
  compressionRatio: number;
}

export type OCRInput =
  | File
  | Blob
  | HTMLImageElement
  | HTMLCanvasElement
  | string
  | Uint8Array;
