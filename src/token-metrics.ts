import { TokenMetrics } from './types';

/**
 * Calculates token efficiency metrics comparing extracted Markdown vs vision tokens for LLM ingestion.
 */
export function calculateTokenMetrics(
  markdown: string,
  imageDimensions?: { width: number; height: number }
): TokenMetrics {
  const extractedTextTokens = Math.ceil((markdown || '').length / 4);

  let estimatedVisionTokens = 765; // default 1024x1024 tiles
  if (
    imageDimensions &&
    typeof imageDimensions.width === 'number' &&
    typeof imageDimensions.height === 'number' &&
    imageDimensions.width > 0 &&
    imageDimensions.height > 0
  ) {
    const tilesX = Math.ceil(imageDimensions.width / 512);
    const tilesY = Math.ceil(imageDimensions.height / 512);
    estimatedVisionTokens = 85 + 170 * tilesX * tilesY;
  }

  const estimatedVisionTokensSaved = Math.max(0, estimatedVisionTokens - extractedTextTokens);

  const compressionRatio =
    estimatedVisionTokens > 0
      ? Math.round(((estimatedVisionTokensSaved / estimatedVisionTokens) * 100) * 10) / 10
      : 0;

  return {
    extractedTextTokens,
    estimatedVisionTokens,
    estimatedVisionTokensSaved,
    compressionRatio,
  };
}

/**
 * Smart Vision Router heuristic: determines whether local OCR Markdown is sufficiently reliable
 * to inject into the user prompt or whether a fallback to cloud multimodal Vision LLM is warranted.
 */
export function determineRoutingRecommendation(
  confidence: number,
  wordCount: number
): 'use_local_markdown' | 'fallback_to_vision_llm' {
  if (confidence >= 55 && wordCount >= 5) {
    return 'use_local_markdown';
  }
  return 'fallback_to_vision_llm';
}
