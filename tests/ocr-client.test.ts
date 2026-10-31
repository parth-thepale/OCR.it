import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  extractAttachmentOCR,
  formatForPrompt,
  LocalOCRClient,
  createOCRClient,
} from '../src/ocr-client';

const mockWorker = {
  recognize: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
  reinitialize: vi.fn().mockResolvedValue(undefined),
};

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockImplementation(() => Promise.resolve(mockWorker)),
}));

describe('Off-Main-Thread OCR Worker Client', () => {
  const mockBlocksData = {
    text: 'STORE RECEIPT\nItem Qty Price\nLatte 1 $4.50\nMuffin 2 $6.00',
    confidence: 96.5,
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'STORE RECEIPT',
                confidence: 98,
                bbox: { x0: 20, y0: 10, x1: 200, y1: 45 },
                words: [
                  { text: 'STORE', confidence: 98, bbox: { x0: 20, y0: 10, x1: 90, y1: 45 } },
                  { text: 'RECEIPT', confidence: 98, bbox: { x0: 100, y0: 10, x1: 200, y1: 45 } },
                ],
              },
              {
                text: 'Item Qty Price',
                confidence: 97,
                bbox: { x0: 10, y0: 60, x1: 300, y1: 80 },
                words: [
                  { text: 'Item', confidence: 97, bbox: { x0: 10, y0: 60, x1: 45, y1: 80 } },
                  { text: 'Qty', confidence: 97, bbox: { x0: 150, y0: 60, x1: 175, y1: 80 } },
                  { text: 'Price', confidence: 97, bbox: { x0: 250, y0: 60, x1: 295, y1: 80 } },
                ],
              },
              {
                text: 'Latte 1 $4.50',
                confidence: 96,
                bbox: { x0: 10, y0: 90, x1: 300, y1: 110 },
                words: [
                  { text: 'Latte', confidence: 96, bbox: { x0: 10, y0: 90, x1: 50, y1: 110 } },
                  { text: '1', confidence: 96, bbox: { x0: 150, y0: 90, x1: 160, y1: 110 } },
                  { text: '$4.50', confidence: 96, bbox: { x0: 250, y0: 90, x1: 295, y1: 110 } },
                ],
              },
              {
                text: 'Muffin 2 $6.00',
                confidence: 95,
                bbox: { x0: 10, y0: 120, x1: 300, y1: 140 },
                words: [
                  { text: 'Muffin', confidence: 95, bbox: { x0: 10, y0: 120, x1: 60, y1: 140 } },
                  { text: '2', confidence: 95, bbox: { x0: 150, y0: 120, x1: 160, y1: 140 } },
                  { text: '$6.00', confidence: 95, bbox: { x0: 250, y0: 120, x1: 295, y1: 140 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorker.recognize.mockResolvedValue({ data: mockBlocksData });
  });

  it('parses hierarchical blocks, calls reconstructMarkdown, and calculates metrics', async () => {
    const mockFile = new File(['dummy-content'], 'receipt.png', { type: 'image/png' });

    const result = await extractAttachmentOCR(mockFile);

    expect(mockWorker.recognize).toHaveBeenCalledWith(
      mockFile,
      {},
      { text: true, blocks: true }
    );

    expect(result.attachmentName).toBe('receipt.png');
    expect(result.confidence).toBe(96.5);
    expect(result.lines).toHaveLength(4);
    expect(result.rawText).toBe(mockBlocksData.text);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.estimatedVisionTokensSaved).toBeGreaterThan(0);

    // Verify reconstructMarkdown extracted heading and GFM table
    expect(result.markdown).toContain('## STORE RECEIPT');
    expect(result.markdown).toContain('| Item | Qty | Price |');
    expect(result.markdown).toContain('| Latte | 1 | $4.50 |');
    expect(result.markdown).toContain('| Muffin | 2 | $6.00 |');
  });

  it('wraps extracted OCR result into an LLM-ready XML block via formatForPrompt', async () => {
    const mockFile = new File(['dummy-content'], 'invoice-july.pdf', { type: 'application/pdf' });
    const result = await extractAttachmentOCR(mockFile);

    const xml = formatForPrompt(result);

    expect(xml).toContain('<attachment_ocr name="invoice-july.pdf" confidence="96.5" tokens_saved=');
    expect(xml).toContain('## STORE RECEIPT');
    expect(xml).toContain('</attachment_ocr>');
  });

  it('reuses cached worker and supports termination via LocalOCRClient', async () => {
    const client = createOCRClient();
    const mockFile1 = new File(['data1'], 'file1.jpg', { type: 'image/jpeg' });
    const mockFile2 = new File(['data2'], 'file2.jpg', { type: 'image/jpeg' });

    await client.recognize(mockFile1);
    await client.recognize(mockFile2);

    expect(mockWorker.recognize).toHaveBeenCalledTimes(2);

    await client.terminate();
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });
});
