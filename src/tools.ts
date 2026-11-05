import { z } from 'zod';
import { OCRInput, OCROptions, ExtractedTable } from './types';
import { extractAttachmentOCR, formatForPrompt } from './ocr-client';

export * from './types';

/**
 * Zod schema for the attachment OCR extraction tool parameters.
 */
export const extractAttachmentTextParamsSchema = z.object({
  attachmentId: z
    .string()
    .describe(
      'Unique ID, filename, or URL/data-URI of the attached image or screenshot in the chat session'
    ),
  language: z
    .string()
    .optional()
    .default('eng')
    .describe("ISO 639-2 OCR language code, e.g., 'eng'"),
  preserveTables: z
    .boolean()
    .optional()
    .default(true)
    .describe('Reconstruct multi-column receipts, invoices, and tables into GFM Markdown tables'),
  confidenceThreshold: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .default(30)
    .describe('Minimum word confidence threshold (0-100)'),
  redactPII: z
    .boolean()
    .optional()
    .default(true)
    .describe('Scrub sensitive API keys, emails, cards, and phone numbers before returning'),
  autoInvertDarkMode: z
    .boolean()
    .optional()
    .default(true)
    .describe('Automatically invert colors for dark-mode IDE/terminal screenshots'),
  tableFormat: z
    .enum(['gfm', 'toon', 'csv'])
    .optional()
    .default('gfm')
    .describe(
      'Format for extracted tables: standard Markdown (gfm), compact TOON (@table[]{}), or raw CSV'
    ),
});

export type ExtractAttachmentTextParams = z.infer<typeof extractAttachmentTextParamsSchema>;

/**
 * Resolves an attachment ID from session storage or state into an OCRInput.
 */
export type AttachmentResolver = (
  attachmentId: string
) => Promise<OCRInput | undefined> | OCRInput | undefined;

export interface CreateOCRToolOptions {
  resolveAttachment: AttachmentResolver;
  defaultOCROptions?: OCROptions;
}

export interface OCRToolExecutionResult {
  attachmentId: string;
  markdown: string;
  rawText: string;
  confidence: number;
  latencyMs: number;
  estimatedVisionTokensSaved: number;
  routingRecommendation: 'use_local_markdown' | 'fallback_to_vision_llm';
  redactionsApplied: number;
  promptXml: string;
  tables: ExtractedTable[];
  cacheHit: boolean;
}

/**
 * Creates an LLM-callable tool definition for on-demand zero-egress OCR.
 */
export function createOCRTool(options: CreateOCRToolOptions) {
  const jsonSchema = {
    type: 'object',
    properties: {
      attachmentId: {
        type: 'string',
        description:
          'Unique ID, filename, or URL/data-URI of the attached image or screenshot in the chat session',
      },
      language: {
        type: 'string',
        description: "ISO 639-2 OCR language code, e.g., 'eng'",
        default: 'eng',
      },
      preserveTables: {
        type: 'boolean',
        description:
          'Reconstruct multi-column receipts, invoices, and tables into GFM Markdown tables',
        default: true,
      },
      confidenceThreshold: {
        type: 'number',
        description: 'Minimum word confidence threshold (0-100)',
        minimum: 0,
        maximum: 100,
        default: 30,
      },
      redactPII: {
        type: 'boolean',
        description:
          'Scrub sensitive API keys, emails, cards, and phone numbers before returning',
        default: true,
      },
      autoInvertDarkMode: {
        type: 'boolean',
        description:
          'Automatically invert colors for dark-mode IDE/terminal screenshots',
        default: true,
      },
      tableFormat: {
        type: 'string',
        enum: ['gfm', 'toon', 'csv'],
        description:
          'Format for extracted tables: standard Markdown (gfm), compact TOON (@table[]{}), or raw CSV',
        default: 'gfm',
      },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  } as const;

  return {
    name: 'extract_attachment_text' as const,
    description:
      'Extracts structured Markdown, tables, and text from an image or screenshot attached by the user in the chat using zero-egress local OCR.',
    parameters: extractAttachmentTextParamsSchema,
    jsonSchema,
    async execute(
      args: z.infer<typeof extractAttachmentTextParamsSchema>
    ): Promise<OCRToolExecutionResult> {
      const parsedArgs = extractAttachmentTextParamsSchema.parse(args);
      const input = await options.resolveAttachment(parsedArgs.attachmentId);

      if (!input) {
        throw new Error(
          `Attachment with ID "${parsedArgs.attachmentId}" not found or could not be resolved.`
        );
      }

      const ocrOptions: OCROptions = {
        ...options.defaultOCROptions,
        language: parsedArgs.language,
        preserveTables: parsedArgs.preserveTables,
        confidenceThreshold: parsedArgs.confidenceThreshold,
        redactPII: parsedArgs.redactPII,
        autoInvertDarkMode: parsedArgs.autoInvertDarkMode,
        tableFormat: parsedArgs.tableFormat,
      };

      const result = await extractAttachmentOCR(input, ocrOptions);

      return {
        attachmentId: parsedArgs.attachmentId,
        markdown: result.markdown,
        rawText: result.rawText,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
        estimatedVisionTokensSaved: result.estimatedVisionTokensSaved,
        routingRecommendation: result.routingRecommendation,
        redactionsApplied: result.redactionsApplied,
        promptXml: formatForPrompt(result),
        tables: result.tables,
        cacheHit: result.cacheHit,
      };
    },
  };
}
