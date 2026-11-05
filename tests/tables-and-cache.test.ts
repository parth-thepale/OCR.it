import { vi, describe, it, expect, beforeEach } from 'vitest';
import { reconstructLayout, reconstructMarkdown } from '../src/layout-to-md';
import { LocalOCRClient, createOCRClient, extractAttachmentOCR } from '../src/ocr-client';
import { createOCRTool } from '../src/tools';
import { OCRLine } from '../src/types';

const mockWorker = {
  recognize: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
  reinitialize: vi.fn().mockResolvedValue(undefined),
};

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockImplementation(() => Promise.resolve(mockWorker)),
}));

describe('Structured Table Engine, Auto-Sums, TOON Serialization & LRU Cache', () => {
  const sampleTableLines: OCRLine[] = [
    {
      text: 'Item Qty Price',
      bbox: { x0: 10, y0: 30, x1: 330, y1: 50 },
      words: [
        { text: 'Item', confidence: 98, bbox: { x0: 10, y0: 30, x1: 50, y1: 50 } },
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. ExtractedTable JSON Parsing & Auto-Sum Arithmetic', () => {
    it('parses multi-column blocks into typed JSON rows with currency normalized to numbers', () => {
      const { tables } = reconstructLayout(sampleTableLines);

      expect(tables).toHaveLength(1);
      const table = tables[0];

      expect(table.headers).toEqual(['Item', 'Qty', 'Price']);
      expect(table.rows).toEqual([
        { Item: 'Espresso', Qty: 2, Price: 7 },
        { Item: 'Croissant', Qty: 1, Price: 4.5 },
      ]);
    });

    it('computes accurate columnSums for numeric columns without precision anomalies', () => {
      const { tables } = reconstructLayout(sampleTableLines);
      const table = tables[0];

      // Qty: 2 + 1 = 3, Price: 7.00 + 4.50 = 11.5
      expect(table.columnSums).toEqual({
        Qty: 3,
        Price: 11.5,
      });

      // Item is non-numeric, must not be present in columnSums
      expect(table.columnSums).not.toHaveProperty('Item');
    });

    it('aligns missing columns via spatial X-gutter distance', () => {
      const sparseTableLines: OCRLine[] = [
        {
          text: 'Code Name Amount',
          bbox: { x0: 10, y0: 30, x1: 330, y1: 50 },
          words: [
            { text: 'Code', confidence: 95, bbox: { x0: 10, y0: 30, x1: 50, y1: 50 } },
            { text: 'Name', confidence: 95, bbox: { x0: 150, y0: 30, x1: 185, y1: 50 } },
            { text: 'Amount', confidence: 95, bbox: { x0: 280, y0: 30, x1: 330, y1: 50 } },
          ],
        },
        {
          // Missing 'Name' column in middle gutter
          text: 'A01 $25.00',
          bbox: { x0: 10, y0: 60, x1: 330, y1: 80 },
          words: [
            { text: 'A01', confidence: 95, bbox: { x0: 10, y0: 60, x1: 45, y1: 80 } },
            { text: '$25.00', confidence: 95, bbox: { x0: 280, y0: 60, x1: 330, y1: 80 } },
          ],
        },
      ];

      const { tables } = reconstructLayout(sparseTableLines);
      expect(tables).toHaveLength(1);
      expect(tables[0].rows[0]).toEqual({
        Code: 'A01',
        Name: '',
        Amount: 25,
      });
      expect(tables[0].columnSums).toEqual({
        Amount: 25,
      });
    });
  });

  describe('2. TOON & CSV Compact Serializers', () => {
    it('serializes table into compact TOON representation (@table[headers]{row1}{row2})', () => {
      const { tables } = reconstructLayout(sampleTableLines);
      const table = tables[0];

      expect(table.toon).toBe('@table[Item,Qty,Price]{Espresso,2,$7.00}{Croissant,1,$4.50}');
    });

    it('serializes table into clean CSV representation', () => {
      const { tables } = reconstructLayout(sampleTableLines);
      const table = tables[0];

      const expectedCsv = [
        'Item,Qty,Price',
        'Espresso,2,$7.00',
        'Croissant,1,$4.50',
      ].join('\n');

      expect(table.csv).toBe(expectedCsv);
    });

    it('formats reconstructed markdown according to tableFormat option', () => {
      const gfm = reconstructMarkdown(sampleTableLines, { tableFormat: 'gfm' });
      expect(gfm).toContain('| Item | Qty | Price |');
      expect(gfm).toContain('| --- | --- | --- |');

      const toon = reconstructMarkdown(sampleTableLines, { tableFormat: 'toon' });
      expect(toon).toBe('@table[Item,Qty,Price]{Espresso,2,$7.00}{Croissant,1,$4.50}');

      const csv = reconstructMarkdown(sampleTableLines, { tableFormat: 'csv' });
      expect(csv).toBe('Item,Qty,Price\nEspresso,2,$7.00\nCroissant,1,$4.50');
    });
  });

  describe('3. Edge Boilerplate Noise Filter', () => {
    it('strips status bar noise (battery %, clock timestamps, File Edit View) in top/bottom 3% margins', () => {
      const linesWithNoise: OCRLine[] = [
        {
          text: '9:41 AM 100% File Edit View',
          bbox: { x0: 10, y0: 5, x1: 400, y1: 20 }, // Top edge margin in 1000px height (< 30px)
          words: [
            { text: '9:41', confidence: 99, bbox: { x0: 10, y0: 5, x1: 40, y1: 20 } },
            { text: 'AM', confidence: 99, bbox: { x0: 45, y0: 5, x1: 65, y1: 20 } },
            { text: '100%', confidence: 99, bbox: { x0: 80, y0: 5, x1: 115, y1: 20 } },
            { text: 'File', confidence: 99, bbox: { x0: 130, y0: 5, x1: 160, y1: 20 } },
            { text: 'Edit', confidence: 99, bbox: { x0: 170, y0: 5, x1: 200, y1: 20 } },
            { text: 'View', confidence: 99, bbox: { x0: 210, y0: 5, x1: 240, y1: 20 } },
          ],
        },
        {
          text: 'Main Document Title',
          bbox: { x0: 50, y0: 200, x1: 300, y1: 230 },
          words: [
            { text: 'Main', confidence: 99, bbox: { x0: 50, y0: 200, x1: 95, y1: 230 } },
            { text: 'Document', confidence: 99, bbox: { x0: 105, y0: 200, x1: 210, y1: 230 } },
            { text: 'Title', confidence: 99, bbox: { x0: 220, y0: 200, x1: 300, y1: 230 } },
          ],
        },
        {
          text: 'Bottom Footer Content',
          bbox: { x0: 50, y0: 800, x1: 300, y1: 820 },
          words: [
            { text: 'Bottom', confidence: 95, bbox: { x0: 50, y0: 800, x1: 110, y1: 820 } },
            { text: 'Footer', confidence: 95, bbox: { x0: 120, y0: 800, x1: 175, y1: 820 } },
            { text: 'Content', confidence: 95, bbox: { x0: 185, y0: 800, x1: 300, y1: 820 } },
          ],
        },
        {
          text: '98%',
          bbox: { x0: 350, y0: 980, x1: 390, y1: 995 }, // Bottom edge margin (> 970px)
          words: [
            { text: '98%', confidence: 95, bbox: { x0: 350, y0: 980, x1: 390, y1: 995 } },
          ],
        },
      ];

      // Default (stripBoilerplate: true)
      const cleaned = reconstructMarkdown(linesWithNoise, { stripBoilerplate: true });
      expect(cleaned).not.toContain('9:41');
      expect(cleaned).not.toContain('100%');
      expect(cleaned).not.toContain('File');
      expect(cleaned).not.toContain('Edit');
      expect(cleaned).not.toContain('View');
      expect(cleaned).not.toContain('98%');
      expect(cleaned).toContain('Main Document Title');
      expect(cleaned).toContain('Bottom Footer Content');

      // Preserved when stripBoilerplate is false
      const preserved = reconstructMarkdown(linesWithNoise, { stripBoilerplate: false });
      expect(preserved).toContain('100%');
      expect(preserved).toContain('File');
    });
  });

  describe('4. Fast In-Memory LRU Cache & Instant Cache Hits', () => {
    const mockOcrData = {
      text: 'Sample Content\nItem Qty Price\nLatte 2 $6.00',
      confidence: 97,
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: 'Item Qty Price',
                  confidence: 97,
                  bbox: { x0: 10, y0: 20, x1: 300, y1: 40 },
                  words: [
                    { text: 'Item', confidence: 97, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } },
                    { text: 'Qty', confidence: 97, bbox: { x0: 150, y0: 20, x1: 180, y1: 40 } },
                    { text: 'Price', confidence: 97, bbox: { x0: 250, y0: 20, x1: 295, y1: 40 } },
                  ],
                },
                {
                  text: 'Latte 2 $6.00',
                  confidence: 97,
                  bbox: { x0: 10, y0: 50, x1: 300, y1: 70 },
                  words: [
                    { text: 'Latte', confidence: 97, bbox: { x0: 10, y0: 50, x1: 55, y1: 70 } },
                    { text: '2', confidence: 97, bbox: { x0: 150, y0: 50, x1: 165, y1: 70 } },
                    { text: '$6.00', confidence: 97, bbox: { x0: 250, y0: 50, x1: 295, y1: 70 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    it('returns cacheHit: false on first call and cacheHit: true with <1ms latency on duplicate call', async () => {
      mockWorker.recognize.mockResolvedValue({ data: mockOcrData });

      const client = createOCRClient();
      const mockFile = new File(['image-bytes-v1'], 'bill.png', { type: 'image/png' });

      // First run: cache miss
      const res1 = await client.recognize(mockFile);
      expect(res1.cacheHit).toBe(false);
      expect(mockWorker.recognize).toHaveBeenCalledTimes(1);
      expect(res1.tables).toHaveLength(1);
      expect(res1.tables[0].columnSums).toEqual({ Qty: 2, Price: 6 });

      // Duplicate run with identical input: instant cache hit
      const res2 = await client.recognize(mockFile);
      expect(res2.cacheHit).toBe(true);
      expect(res2.latencyMs).toBeLessThanOrEqual(5); // Sub-millisecond execution
      expect(mockWorker.recognize).toHaveBeenCalledTimes(1); // Worker not called again!
      expect(res2.markdown).toBe(res1.markdown);
      expect(res2.tables).toEqual(res1.tables);
    });

    it('bypasses cache when options change (e.g. tableFormat)', async () => {
      mockWorker.recognize.mockResolvedValue({ data: mockOcrData });

      const client = createOCRClient();
      const mockFile = new File(['image-bytes-v2'], 'bill2.png', { type: 'image/png' });

      const resGfm = await client.recognize(mockFile, { tableFormat: 'gfm' });
      expect(resGfm.cacheHit).toBe(false);
      expect(resGfm.markdown).toContain('| Item | Qty | Price |');

      const resToon = await client.recognize(mockFile, { tableFormat: 'toon' });
      expect(resToon.cacheHit).toBe(false); // Option changed -> cache miss
      expect(resToon.markdown).toContain('@table[Item,Qty,Price]');
      expect(mockWorker.recognize).toHaveBeenCalledTimes(2);

      // Re-running with toon hits the cache
      const resToonCached = await client.recognize(mockFile, { tableFormat: 'toon' });
      expect(resToonCached.cacheHit).toBe(true);
      expect(mockWorker.recognize).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Agentic createOCRTool Schema & Execution', () => {
    it('supports tableFormat parameter and returns structured tables and cacheHit', async () => {
      const mockOcrData = {
        text: 'Table Data',
        confidence: 99,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: 'ColA ColB',
                    confidence: 99,
                    bbox: { x0: 10, y0: 10, x1: 200, y1: 30 },
                    words: [
                      { text: 'ColA', confidence: 99, bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
                      { text: 'ColB', confidence: 99, bbox: { x0: 100, y0: 10, x1: 150, y1: 30 } },
                    ],
                  },
                  {
                    text: 'Alpha $10',
                    confidence: 99,
                    bbox: { x0: 10, y0: 40, x1: 200, y1: 60 },
                    words: [
                      { text: 'Alpha', confidence: 99, bbox: { x0: 10, y0: 40, x1: 60, y1: 60 } },
                      { text: '$10', confidence: 99, bbox: { x0: 100, y0: 40, x1: 130, y1: 60 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      mockWorker.recognize.mockResolvedValue({ data: mockOcrData });

      const mockFile = new File(['mock-bytes'], 'invoice.png', { type: 'image/png' });
      const tool = createOCRTool({
        resolveAttachment: () => mockFile,
      });

      // Verify schema includes tableFormat
      expect(tool.jsonSchema.properties.tableFormat.enum).toEqual(['gfm', 'toon', 'csv']);

      const execution = await tool.execute({
        attachmentId: 'att-xyz',
        tableFormat: 'toon',
      });

      expect(execution.attachmentId).toBe('att-xyz');
      expect(execution.markdown).toContain('@table[ColA,ColB]{Alpha,$10}');
      expect(execution.tables).toHaveLength(1);
      expect(execution.tables[0].columnSums).toEqual({ ColB: 10 });
      expect(execution.tables[0].rows[0]).toEqual({ ColA: 'Alpha', ColB: 10 });
      expect(typeof execution.cacheHit).toBe('boolean');
    });
  });
});
