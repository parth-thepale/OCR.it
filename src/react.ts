import { useState, useRef, useEffect, useCallback } from 'react';
import { LocalOCRClient, formatForPrompt } from './ocr-client';
import { OCRResult, OCROptions } from './types';

export * from './types';

export interface AttachmentOCRItem {
  id: string;
  file: File;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  statusText: string;
  result?: OCRResult;
  error?: string;
}

export interface UseAttachmentOCRReturn {
  attachments: AttachmentOCRItem[];
  isProcessing: boolean;
  processFiles: (files: FileList | File[]) => Promise<OCRResult[]>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  getPromptContext: () => string;
}

/**
 * React hook for managing zero-egress chat attachment OCR processing with live progress states.
 */
export function useAttachmentOCR(options?: OCROptions): UseAttachmentOCRReturn {
  const [attachments, setAttachments] = useState<AttachmentOCRItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const clientRef = useRef<LocalOCRClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new LocalOCRClient(options);
  }

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.terminate();
        clientRef.current = null;
      }
    };
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const getPromptContext = useCallback((): string => {
    return attachments
      .filter((item) => item.status === 'done' && item.result)
      .map((item) => formatForPrompt(item.result!))
      .join('\n\n');
  }, [attachments]);

  const processFiles = useCallback(
    async (files: FileList | File[]): Promise<OCRResult[]> => {
      const fileList: File[] = Array.from(files);
      if (fileList.length === 0) return [];

      const newItems: AttachmentOCRItem[] = fileList.map((file, idx) => ({
        id: `${file.name}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: 'queued',
        progress: 0,
        statusText: 'Queued',
      }));

      setAttachments((prev) => [...prev, ...newItems]);
      setIsProcessing(true);

      const results: OCRResult[] = [];
      const client = clientRef.current ?? new LocalOCRClient(options);
      clientRef.current = client;

      for (const item of newItems) {
        setAttachments((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: 'processing', progress: 0, statusText: 'Initializing...' }
              : it
          )
        );

        try {
          const res = await client.recognize(item.file, {
            ...options,
            onProgress: (progress: number, status: string) => {
              setAttachments((prev) =>
                prev.map((it) =>
                  it.id === item.id
                    ? { ...it, progress, statusText: status }
                    : it
                )
              );
            },
          });

          results.push(res);
          setAttachments((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: 'done', progress: 100, statusText: 'Completed', result: res }
                : it
            )
          );
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          setAttachments((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: 'error', progress: 0, statusText: 'Failed', error: errMsg }
                : it
            )
          );
        }
      }

      setIsProcessing(false);
      return results;
    },
    [options]
  );

  return {
    attachments,
    isProcessing,
    processFiles,
    removeAttachment,
    clearAttachments,
    getPromptContext,
  };
}
