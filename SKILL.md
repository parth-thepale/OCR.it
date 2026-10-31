---
name: local-agent-ocr
description: Zero-egress client-side OCR library and Agent Skill for chat applications. Extracts spatial layout, tables, receipts, and LLM-ready GFM Markdown from image attachments inside Web Workers without sending image pixels to servers. Use when building chat interfaces with image upload, screenshot analysis, receipt/invoice scanning, or saving up to 98% in LLM vision token costs.
---

# Local Agent OCR (OCR.it)

Zero-egress client-side OCR library that extracts spatial layout, receipts, and tables into LLM-ready GFM Markdown inside Web Workers.

## Step 1: Install Package

```bash
npm install local-agent-ocr
```

## Step 2: Integration Pattern Decision Matrix

| Metric / Need | Pattern A: Client-Side Pre-Processor | Pattern B: On-Demand Agent Tool |
| :--- | :--- | :--- |
| **Import Subpath** | `local-agent-ocr/react` | `local-agent-ocr/tools` |
| **Best For** | Chat attachment dropzones & inputs | Agentic reasoning & tool calling |
| **Vision Token Cost**| 0 vision tokens (100% saved) | 0 vision tokens when tool invoked |
| **User Latency** | Instant parallel scan during upload | Scanned only when agent decides |
| **Integration Point**| React form / chat state hook | Vercel AI SDK / LangChain / Gemini |

## Step 3: Copy-Paste Code Templates

### Pattern A: React Chat Attachment Interception

```tsx
import { useAttachmentOCR } from 'local-agent-ocr/react';

export function ChatInput({ onSendMessage }: { onSendMessage: (msg: string) => void }) {
  const { attachments, isProcessing, processFiles, getPromptContext } = useAttachmentOCR();

  const handleSend = (userText: string) => {
    const ocrContext = getPromptContext();
    const payload = ocrContext ? `${ocrContext}\n\n${userText}` : userText;
    onSendMessage(payload);
  };

  return (
    <div>
      <input type="file" multiple accept="image/*" onChange={(e) => e.target.files && processFiles(e.target.files)} />
      {isProcessing && <span>Extracting text locally...</span>}
      {attachments.map((a) => <div key={a.id}>{a.file.name}: {a.statusText} ({a.progress}%)</div>)}
    </div>
  );
}
```

### Pattern B: LLM Tool Calling

```ts
import { createOCRTool } from 'local-agent-ocr/tools';

const sessionUploads = new Map<string, File>();

export const ocrTool = createOCRTool({
  resolveAttachment: (id) => sessionUploads.get(id),
});

// Pass `ocrTool.parameters` to Vercel AI SDK `tool()` or `ocrTool.jsonSchema` to OpenAI / Gemini functions.
```

## Step 4: Bundler & CSP Guardrails

1. **Vite (`vite.config.ts`)**: Prevent bundling pre-compiled worker blobs:
   ```ts
   export default defineConfig({
     optimizeDeps: { exclude: ['local-agent-ocr'] },
   });
   ```
2. **Content Security Policy (CSP)**: Allow worker WASM instantiation:
   ```http
   Content-Security-Policy: worker-src 'self' blob:; script-src 'self' 'unsafe-eval' blob:;
   ```
3. **Verify Environment**: Run the diagnostic CLI:
   ```bash
   node scripts/verify-setup.mjs
   ```
