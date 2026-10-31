import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createOCRTool, extractAttachmentTextParamsSchema } from '../src/tools';

const mockWorker = {
  recognize: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
  reinitialize: vi.fn().mockResolvedValue(undefined),
};

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockImplementation(() => Promise.resolve(mockWorker)),
}));

describe('Universal AI Tool Schemas (createOCRTool)', () => {
  const mockBlocksData = {
    text: 'INVOICE #999\nAmount $150.00',
    confidence: 99,
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'INVOICE #999',
                confidence: 99,
                bbox: { x0: 10, y0: 10, x1: 200, y1: 40 },
                words: [
                  { text: 'INVOICE', confidence: 99, bbox: { x0: 10, y0: 10, x1: 100, y1: 40 } },
                  { text: '#999', confidence: 99, bbox: { x0: 110, y0: 10, x1: 200, y1: 40 } },
                ],
              },
              {
                text: 'Amount $150.00',
                confidence: 99,
                bbox: { x0: 10, y0: 60, x1: 200, y1: 80 },
                words: [
                  { text: 'Amount', confidence: 99, bbox: { x0: 10, y0: 60, x1: 80, y1: 80 } },
                  { text: '$150.00', confidence: 99, bbox: { x0: 140, y0: 60, x1: 200, y1: 80 } },
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

  it('exposes valid name, description, parameters, and jsonSchema properties', () => {
    const tool = createOCRTool({
      resolveAttachment: () => undefined,
    });

    expect(tool.name).toBe('extract_attachment_text');
    expect(tool.description).toContain('zero-egress local OCR');
    expect(tool.parameters).toBe(extractAttachmentTextParamsSchema);

    // Verify plain JSON Schema structure
    expect(tool.jsonSchema.type).toBe('object');
    expect(tool.jsonSchema.properties.attachmentId.type).toBe('string');
    expect(tool.jsonSchema.properties.language.default).toBe('eng');
    expect(tool.jsonSchema.properties.preserveTables.default).toBe(true);
    expect(tool.jsonSchema.properties.confidenceThreshold.default).toBe(30);
    expect(tool.jsonSchema.required).toEqual(['attachmentId']);
  });

  it('validates parameter constraints and applies defaults', () => {
    const valid = extractAttachmentTextParamsSchema.parse({
      attachmentId: 'receipt-123.jpg',
    });

    expect(valid.attachmentId).toBe('receipt-123.jpg');
    expect(valid.language).toBe('eng');
    expect(valid.preserveTables).toBe(true);
    expect(valid.confidenceThreshold).toBe(30);

    // Missing attachmentId should fail
    expect(() => extractAttachmentTextParamsSchema.parse({})).toThrow();

    // Out-of-bounds confidence threshold should fail
    expect(() =>
      extractAttachmentTextParamsSchema.parse({
        attachmentId: 'img.png',
        confidenceThreshold: 150,
      })
    ).toThrow();
  });

  it('successfully resolves an attachment and executes OCR returning promptXml', async () => {
    const mockFile = new File(['mock-img-data'], 'bill.png', { type: 'image/png' });
    const store = new Map<string, File>([['att-1', mockFile]]);

    const tool = createOCRTool({
      resolveAttachment: (id) => store.get(id),
    });

    const execution = await tool.execute({
      attachmentId: 'att-1',
    });

    expect(execution.attachmentId).toBe('att-1');
    expect(execution.confidence).toBe(99);
    expect(execution.rawText).toBe(mockBlocksData.text);
    expect(execution.latencyMs).toBeGreaterThanOrEqual(0);
    expect(execution.estimatedVisionTokensSaved).toBeGreaterThan(0);
    expect(execution.promptXml).toContain('<attachment_ocr name="bill.png" confidence="99" tokens_saved=');
    expect(execution.promptXml).toContain('INVOICE #999');
  });

  it('throws descriptive error if attachment cannot be resolved', async () => {
    const tool = createOCRTool({
      resolveAttachment: () => undefined,
    });

    await expect(tool.execute({ attachmentId: 'missing-file' })).rejects.toThrow(
      'Attachment with ID "missing-file" not found or could not be resolved.'
    );
  });
});
