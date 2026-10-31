import { describe, it, expect } from 'vitest';
import { reconstructMarkdown } from '../src/layout-to-md';
import { calculateTokenMetrics } from '../src/token-metrics';
import { OCRLine } from '../src/types';

describe('Spatial Bounding-Box-to-Markdown Engine', () => {
  it('Test 1: Reconstructs a prominent tall title line as a ## Markdown heading', () => {
    const lines: OCRLine[] = [
      {
        text: 'ACME STORE RECEIPT',
        bbox: { x0: 20, y0: 10, x1: 250, y1: 45 }, // height = 35 (>= 1.4 * 20 = 28)
        words: [
          { text: 'ACME', confidence: 95, bbox: { x0: 20, y0: 10, x1: 80, y1: 45 } },
          { text: 'STORE', confidence: 95, bbox: { x0: 90, y0: 10, x1: 150, y1: 45 } },
          { text: 'RECEIPT', confidence: 95, bbox: { x0: 160, y0: 10, x1: 250, y1: 45 } },
        ],
      },
      {
        text: 'Thank you for shopping with us today.',
        bbox: { x0: 20, y0: 80, x1: 300, y1: 100 }, // height = 20 (standard median)
        words: [
          { text: 'Thank', confidence: 90, bbox: { x0: 20, y0: 80, x1: 60, y1: 100 } },
          { text: 'you', confidence: 90, bbox: { x0: 65, y0: 80, x1: 90, y1: 100 } },
          { text: 'for', confidence: 90, bbox: { x0: 95, y0: 80, x1: 115, y1: 100 } },
          { text: 'shopping', confidence: 90, bbox: { x0: 120, y0: 80, x1: 180, y1: 100 } },
          { text: 'with', confidence: 90, bbox: { x0: 185, y0: 80, x1: 215, y1: 100 } },
          { text: 'us', confidence: 90, bbox: { x0: 220, y0: 80, x1: 240, y1: 100 } },
          { text: 'today.', confidence: 90, bbox: { x0: 245, y0: 80, x1: 300, y1: 100 } },
        ],
      },
    ];

    const markdown = reconstructMarkdown(lines);

    expect(markdown).toContain('## ACME STORE RECEIPT');
    expect(markdown).toMatch(/## ACME STORE RECEIPT\s*\n\nThank you for shopping with us today\./);
  });

  it('Test 2: Reconstructs aligned multi-column receipt/invoice bounding boxes into a valid Markdown table (| Item | Qty | Price |)', () => {
    // Median character width around 8px. Column gaps > 3.5 * 8 = 28px
    const lines: OCRLine[] = [
      {
        text: 'Item Qty Price',
        bbox: { x0: 10, y0: 30, x1: 330, y1: 50 },
        words: [
          { text: 'Item', confidence: 98, bbox: { x0: 10, y0: 30, x1: 45, y1: 50 } },
          { text: 'Qty', confidence: 98, bbox: { x0: 150, y0: 30, x1: 175, y1: 50 } },
          { text: 'Price', confidence: 98, bbox: { x0: 280, y0: 30, x1: 325, y1: 50 } },
        ],
      },
      {
        text: 'Espresso 2 $7.00',
        bbox: { x0: 10, y0: 60, x1: 330, y1: 80 },
        words: [
          { text: 'Espresso', confidence: 96, bbox: { x0: 10, y0: 60, x1: 75, y1: 80 } },
          { text: '2', confidence: 96, bbox: { x0: 150, y0: 60, x1: 160, y1: 80 } },
          { text: '$7.00', confidence: 96, bbox: { x0: 280, y0: 60, x1: 325, y1: 80 } },
        ],
      },
      {
        text: 'Croissant 1 $4.50',
        bbox: { x0: 10, y0: 90, x1: 330, y1: 110 },
        words: [
          { text: 'Croissant', confidence: 94, bbox: { x0: 10, y0: 90, x1: 85, y1: 110 } },
          { text: '1', confidence: 94, bbox: { x0: 150, y0: 90, x1: 160, y1: 110 } },
          { text: '$4.50', confidence: 94, bbox: { x0: 280, y0: 90, x1: 325, y1: 110 } },
        ],
      },
    ];

    const markdown = reconstructMarkdown(lines);

    const expectedTable = [
      '| Item | Qty | Price |',
      '| --- | --- | --- |',
      '| Espresso | 2 | $7.00 |',
      '| Croissant | 1 | $4.50 |',
    ].join('\n');

    expect(markdown).toBe(expectedTable);
  });

  it('Test 3: Filters out low-confidence OCR noise words below confidenceThreshold', () => {
    const lines: OCRLine[] = [
      {
        text: 'Subtotal $11.50 ~#%',
        bbox: { x0: 10, y0: 20, x1: 300, y1: 40 },
        words: [
          { text: 'Subtotal', confidence: 92, bbox: { x0: 10, y0: 20, x1: 75, y1: 40 } },
          { text: '$11.50', confidence: 88, bbox: { x0: 200, y0: 20, x1: 250, y1: 40 } },
          { text: '~#%', confidence: 18, bbox: { x0: 270, y0: 20, x1: 295, y1: 40 } }, // Noise below default 30
        ],
      },
    ];

    // Default threshold is 30 -> drops '~#%'
    const markdown = reconstructMarkdown(lines);
    expect(markdown).not.toContain('~#%');
    expect(markdown).toContain('Subtotal');
    expect(markdown).toContain('$11.50');

    // Strict threshold 95 -> drops all
    const strictMarkdown = reconstructMarkdown(lines, { confidenceThreshold: 95 });
    expect(strictMarkdown).toBe('');
  });

  it('Test 4: Verifies calculateTokenMetrics returns accurate token savings and compression ratios', () => {
    // 1. Default dimensions (1024x1024 -> 765 tokens)
    const sampleMarkdown = '| Item | Qty |\n| --- | --- |\n| Coffee | 1 |'; // 44 chars -> Math.ceil(44/4) = 11 tokens
    const metrics = calculateTokenMetrics(sampleMarkdown);

    const expectedTokens = Math.ceil(sampleMarkdown.length / 4); // 11
    expect(metrics.extractedTextTokens).toBe(expectedTokens);
    expect(metrics.estimatedVisionTokens).toBe(765);
    expect(metrics.estimatedVisionTokensSaved).toBe(765 - expectedTokens); // 754
    expect(metrics.compressionRatio).toBe(Math.round(((754 / 765) * 100) * 10) / 10); // 98.6%

    // 2. Custom dimensions 512x512 (1 tile -> 85 + 170 = 255 tokens)
    const metrics512 = calculateTokenMetrics(sampleMarkdown, { width: 512, height: 512 });
    expect(metrics512.estimatedVisionTokens).toBe(255);
    expect(metrics512.estimatedVisionTokensSaved).toBe(255 - expectedTokens); // 244
    expect(metrics512.compressionRatio).toBe(Math.round(((244 / 255) * 100) * 10) / 10); // 95.7%

    // 3. Very large markdown exceeding vision tokens
    const longMarkdown = 'A'.repeat(4000); // 1000 tokens
    const metricsCapped = calculateTokenMetrics(longMarkdown, { width: 512, height: 512 });
    expect(metricsCapped.extractedTextTokens).toBe(1000);
    expect(metricsCapped.estimatedVisionTokensSaved).toBe(0);
    expect(metricsCapped.compressionRatio).toBe(0);
  });
});
