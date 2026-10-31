import { useState, useRef, useEffect, useMemo } from 'react';
import { useAttachmentOCR } from 'local-agent-ocr/react';
import { calculateTokenMetrics, createOCRTool } from 'local-agent-ocr';
import { generateReceiptFile, generateTerminalFile } from './sample-generators';
import './styles.css';

export function App() {
  // Configurable options
  const [redactPII, setRedactPII] = useState<boolean>(true);
  const [autoInvertDarkMode, setAutoInvertDarkMode] = useState<boolean>(true);
  const [preserveTables, setPreserveTables] = useState<boolean>(true);

  const {
    attachments,
    isProcessing,
    processFiles,
    handlePaste,
    getPromptContext,
    clearAttachments,
  } = useAttachmentOCR({
    redactPII,
    autoInvertDarkMode,
    preserveTables,
  });

  const [activeTab, setActiveTab] = useState<'markdown' | 'prompt' | 'tool'>('markdown');
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number }>({
    width: 600,
    height: 600,
  });
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global window paste support (Ctrl+V / Cmd+V)
  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (e.clipboardData) {
        handlePaste({
          clipboardData: e.clipboardData,
          preventDefault: () => e.preventDefault(),
        });
      }
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [handlePaste]);

  // Latest or currently selected attachment
  const currentAttachment = useMemo(() => {
    if (selectedAttachmentId) {
      return (
        attachments.find((a) => a.id === selectedAttachmentId) ||
        attachments[attachments.length - 1]
      );
    }
    return attachments[attachments.length - 1];
  }, [attachments, selectedAttachmentId]);

  // Keep preview URL synced with current attachment
  useEffect(() => {
    if (currentAttachment?.file) {
      const url = URL.createObjectURL(currentAttachment.file);
      setPreviewUrl(url);

      const img = new Image();
      img.onload = () => {
        setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = url;

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentAttachment?.file]);

  // Telemetry metrics
  const telemetry = useMemo(() => {
    if (!currentAttachment?.result) {
      return {
        latencyMs: 0,
        confidence: 0,
        visionTokens: 765,
        textTokens: 0,
        savingsPercent: 0,
        routing: null,
        redactions: 0,
      };
    }

    const res = currentAttachment.result;
    const metrics = calculateTokenMetrics(res.markdown, imageNaturalSize);

    return {
      latencyMs: res.latencyMs,
      confidence: Math.round(res.confidence * 10) / 10,
      visionTokens: metrics.estimatedVisionTokens,
      textTokens: metrics.extractedTextTokens,
      savingsPercent: metrics.compressionRatio,
      routing: res.routingRecommendation,
      redactions: res.redactionsApplied || 0,
    };
  }, [currentAttachment?.result, imageNaturalSize]);

  // Callable Tool demonstration
  const toolInstance = useMemo(() => {
    return createOCRTool({
      resolveAttachment: (id) => {
        const item = attachments.find((a) => a.id === id || a.file.name === id);
        return item?.file;
      },
      defaultOCROptions: {
        redactPII,
        autoInvertDarkMode,
        preserveTables,
      },
    });
  }, [attachments, redactPII, autoInvertDarkMode, preserveTables]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const handleLoadReceipt = async () => {
    try {
      const file = await generateReceiptFile();
      processFiles([file]);
    } catch (err) {
      console.error('Failed to generate receipt:', err);
    }
  };

  const handleLoadTerminal = async () => {
    try {
      const file = await generateTerminalFile();
      processFiles([file]);
    } catch (err) {
      console.error('Failed to generate terminal:', err);
    }
  };

  const handleCopyPrompt = () => {
    const text = getPromptContext();
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="workbench-container">
      {/* Header */}
      <header className="workbench-header">
        <div className="brand">
          <span className="brand-logo">⚡</span>
          <span className="brand-title">OCR.it</span>
          <span className="brand-badge">Developer Workbench</span>
        </div>
        <div className="header-status-pill">
          <span className="status-dot"></span>
          ZERO-EGRESS WASM WORKER
        </div>
      </header>

      {/* Top Telemetry Strip */}
      <section className="telemetry-strip">
        <div className="telemetry-item">
          <span className="telemetry-label">Latency</span>
          <span className="telemetry-value">
            {telemetry.latencyMs > 0 ? `${telemetry.latencyMs} ms` : '—'}
          </span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">Confidence</span>
          <span className="telemetry-value highlight-cyan">
            {telemetry.confidence > 0 ? `${telemetry.confidence}%` : '—'}
          </span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">Vision vs OCR Tokens</span>
          <span className="telemetry-value">
            {telemetry.textTokens > 0
              ? `${telemetry.visionTokens} ➔ ${telemetry.textTokens}`
              : `${telemetry.visionTokens} est.`}
          </span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">Token Savings</span>
          <span className="telemetry-value highlight-green">
            {telemetry.savingsPercent > 0 ? `-${telemetry.savingsPercent}%` : '0.0%'}
          </span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">Autonomous Routing</span>
          <span className="telemetry-value">
            {telemetry.routing === 'use_local_markdown' && (
              <span className="telemetry-badge badge-green">LOCAL MARKDOWN</span>
            )}
            {telemetry.routing === 'fallback_to_vision_llm' && (
              <span className="telemetry-badge badge-amber">VISION FALLBACK</span>
            )}
            {!telemetry.routing && <span style={{ color: '#64748b' }}>STANDBY</span>}
            {telemetry.redactions > 0 && (
              <span className="telemetry-badge badge-redacted">
                {telemetry.redactions} REDACTED
              </span>
            )}
          </span>
        </div>
      </section>

      {/* Toolbar Toggles Strip */}
      <section className="toolbar-strip">
        <div className="toggles-group">
          <button
            className={`toggle-pill ${redactPII ? 'active green' : ''}`}
            onClick={() => setRedactPII((prev) => !prev)}
          >
            <span>{redactPII ? '✓' : '○'}</span>
            <span>Redact PII &amp; Secrets</span>
          </button>
          <button
            className={`toggle-pill ${autoInvertDarkMode ? 'active' : ''}`}
            onClick={() => setAutoInvertDarkMode((prev) => !prev)}
          >
            <span>{autoInvertDarkMode ? '✓' : '○'}</span>
            <span>Auto-Invert Dark Mode</span>
          </button>
          <button
            className={`toggle-pill ${preserveTables ? 'active' : ''}`}
            onClick={() => setPreserveTables((prev) => !prev)}
          >
            <span>{preserveTables ? '✓' : '○'}</span>
            <span>Preserve Tables</span>
          </button>
        </div>
        <span className="paste-hint">Tip: Paste screenshot with Ctrl+V / Cmd+V anywhere</span>
      </section>

      {/* Workbench Two-Pane Grid */}
      <main className="workbench-body">
        {/* Left Pane: Input & Spatial Bounding Box Overlay */}
        <section className="pane pane-left">
          <div className="section-title">
            <span>Attachment Input &amp; Spatial Visualizer</span>
            {attachments.length > 0 && (
              <button className="btn btn-sm" onClick={clearAttachments}>
                Clear
              </button>
            )}
          </div>

          <div className="action-bar">
            <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
              Upload Image
            </button>
            <button className="btn" onClick={handleLoadReceipt} disabled={isProcessing}>
              Load Sample Receipt
            </button>
            <button className="btn" onClick={handleLoadTerminal} disabled={isProcessing}>
              Load Terminal Stacktrace
            </button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden-input"
              accept="image/*"
              onChange={handleFileUpload}
            />
          </div>

          {/* Active progress */}
          {currentAttachment && currentAttachment.status === 'processing' && (
            <div className="progress-container">
              <div className="progress-header">
                <span>{currentAttachment.file.name}</span>
                <span>{currentAttachment.progress}%</span>
              </div>
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${currentAttachment.progress}%` }}
                ></div>
              </div>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                Status: {currentAttachment.statusText}
              </span>
            </div>
          )}

          {/* Image & Bounding Box Canvas */}
          <div className="preview-card">
            <div className="canvas-wrapper">
              {previewUrl ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={previewUrl} alt="Preview" className="preview-image" />
                  {currentAttachment?.result?.lines && (
                    <svg
                      className="spatial-svg-overlay"
                      viewBox={`0 0 ${imageNaturalSize.width} ${imageNaturalSize.height}`}
                      preserveAspectRatio="none"
                    >
                      {currentAttachment.result.lines.flatMap((line, lineIdx) =>
                        line.words.map((w, wIdx) => {
                          const width = Math.max(2, w.bbox.x1 - w.bbox.x0);
                          const height = Math.max(2, w.bbox.y1 - w.bbox.y0);
                          return (
                            <rect
                              key={`${lineIdx}-${wIdx}`}
                              className="bbox-rect"
                              x={w.bbox.x0}
                              y={w.bbox.y0}
                              width={width}
                              height={height}
                            >
                              <title>
                                {w.text} ({Math.round(w.confidence)}%)
                              </title>
                            </rect>
                          );
                        })
                      )}
                    </svg>
                  )}
                </div>
              ) : (
                <div
                  className="dropzone"
                  style={{ width: '100%', minHeight: 280, justifyContent: 'center' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="dropzone-icon">📁</span>
                  <span style={{ fontWeight: 600 }}>Drop or Paste (Cmd+V) an Image</span>
                  <span className="dropzone-text">
                    Receipts, invoices, tables, code snippets, or logs
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right Pane: Multi-Tab Output & Agent Inspector */}
        <section className="pane pane-right">
          <div className="tabs-bar">
            <button
              className={`tab-btn ${activeTab === 'markdown' ? 'active' : ''}`}
              onClick={() => setActiveTab('markdown')}
            >
              Spatial Markdown
            </button>
            <button
              className={`tab-btn ${activeTab === 'prompt' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompt')}
            >
              LLM Prompt Context
            </button>
            <button
              className={`tab-btn ${activeTab === 'tool' ? 'active' : ''}`}
              onClick={() => setActiveTab('tool')}
            >
              Callable Tool Schema
            </button>
          </div>

          {activeTab === 'markdown' && (
            <div className="code-container">
              {currentAttachment?.result?.markdown ? (
                currentAttachment.result.markdown
              ) : (
                <span style={{ color: '#64748b' }}>
                  /* Extracted Spatial Markdown will render here once an image is processed */
                </span>
              )}
            </div>
          )}

          {activeTab === 'prompt' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-sm"
                  onClick={handleCopyPrompt}
                  disabled={!currentAttachment?.result}
                >
                  {copied ? '✓ Copied' : 'Copy XML Block'}
                </button>
              </div>
              <div className="code-container">
                {getPromptContext() ? (
                  getPromptContext()
                ) : (
                  <span style={{ color: '#64748b' }}>
                    /* Complete XML payload for chat LLM prompt injection */
                  </span>
                )}
              </div>
            </div>
          )}

          {activeTab === 'tool' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
              <span className="section-title">OpenAI / Gemini / MCP Tool Declaration</span>
              <div className="code-container" style={{ maxHeight: 220 }}>
                {JSON.stringify(
                  {
                    name: toolInstance.name,
                    description: toolInstance.description,
                    parameters: toolInstance.jsonSchema,
                  },
                  null,
                  2
                )}
              </div>

              <span className="section-title">Live Tool Execution Output</span>
              <div className="code-container">
                {currentAttachment?.result ? (
                  JSON.stringify(
                    {
                      attachmentId: currentAttachment.file.name,
                      markdown: currentAttachment.result.markdown,
                      confidence: currentAttachment.result.confidence,
                      latencyMs: currentAttachment.result.latencyMs,
                      estimatedVisionTokensSaved: currentAttachment.result.estimatedVisionTokensSaved,
                      routingRecommendation: currentAttachment.result.routingRecommendation,
                      redactionsApplied: currentAttachment.result.redactionsApplied,
                    },
                    null,
                    2
                  )
                ) : (
                  <span style={{ color: '#64748b' }}>
                    /* Tool return payload will be displayed here */
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
