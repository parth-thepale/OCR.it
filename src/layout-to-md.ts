import { OCRLine, BoundingBox, ExtractedTable } from './types';

export interface LayoutToMarkdownOptions {
  preserveTables?: boolean;
  confidenceThreshold?: number;
  tableFormat?: 'gfm' | 'csv' | 'toon';
  stripBoilerplate?: boolean;
}

export interface ReconstructedLayoutResult {
  markdown: string;
  tables: ExtractedTable[];
}

const STATUS_NOISE_PATTERNS = [
  /^\d{1,3}%$/,
  /^\d{1,2}:\d{2}(?::\d{2})?(\s*(am|pm|AM|PM))?$/,
  /^(am|pm)$/i,
  /^(file|edit|view|window|help|history|bookmarks|tabs?)$/i,
  /^(wifi|lte|5g|4g|bluetooth)$/i,
];

function isBoilerplateNoise(text: string): boolean {
  const trimmed = text.trim();
  return STATUS_NOISE_PATTERNS.some((p) => p.test(trimmed));
}

function parseNumericValue(text: string): { isNumeric: boolean; value: number } {
  const trimmed = text.trim();
  if (!trimmed) return { isNumeric: false, value: 0 };

  // Strip currency symbols and handle accounting parens
  let cleaned = trimmed.replace(/[$€£¥₹]/g, '').trim();
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/,/g, '');

  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    if (!isNaN(num) && isFinite(num)) {
      return { isNumeric: true, value: num };
    }
  }
  return { isNumeric: false, value: 0 };
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function cleanToonCell(val: string | number): string {
  return String(val ?? '').replace(/[{}]/g, '').trim();
}

interface InternalWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  yCenter: number;
}

interface ColumnCluster {
  text: string;
  bbox: BoundingBox;
}

interface ProcessedRow {
  words: InternalWord[];
  clusters: ColumnCluster[];
  yCenter: number;
  y0: number;
  y1: number;
  height: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Deterministically reconstructs spatial OCR layout bounding boxes into clean, LLM-ready GFM Markdown
 * alongside structured tables, JSON rows, and compact serialization formats.
 */
export function reconstructLayout(
  lines: OCRLine[],
  options?: LayoutToMarkdownOptions
): ReconstructedLayoutResult {
  if (!lines || lines.length === 0) return { markdown: '', tables: [] };

  const threshold = options?.confidenceThreshold ?? 30;
  const preserveTables = options?.preserveTables !== false;
  const tableFormat = options?.tableFormat ?? 'gfm';

  const lineHeights: number[] = [];
  const rawWords: InternalWord[] = [];

  for (const line of lines) {
    const lineConf = (line as { confidence?: number }).confidence;
    if (typeof lineConf === 'number' && lineConf < threshold) {
      continue;
    }

    const lineHeight = line.bbox ? line.bbox.y1 - line.bbox.y0 : 0;
    if (lineHeight > 0) {
      lineHeights.push(lineHeight);
    }

    if (line.words && line.words.length > 0) {
      for (const w of line.words) {
        if ((w.confidence ?? 100) >= threshold && w.text && w.text.trim().length > 0) {
          rawWords.push({
            text: w.text.trim(),
            confidence: w.confidence ?? 100,
            bbox: w.bbox,
            yCenter: (w.bbox.y0 + w.bbox.y1) / 2,
          });
        }
      }
    } else if (line.text && line.text.trim().length > 0) {
      rawWords.push({
        text: line.text.trim(),
        confidence: 100,
        bbox: line.bbox,
        yCenter: (line.bbox.y0 + line.bbox.y1) / 2,
      });
    }
  }

  if (rawWords.length === 0) return { markdown: '', tables: [] };

  // Edge Boilerplate Filter: strip status bar noise in top/bottom 3% vertical margins
  let words = rawWords;
  if (options?.stripBoilerplate !== false && rawWords.length > 0) {
    const allY0 = rawWords.map((w) => w.bbox.y0);
    const allY1 = rawWords.map((w) => w.bbox.y1);
    const minY = Math.min(...allY0);
    const maxY = Math.max(...allY1);
    const totalHeight = maxY - minY;

    if (totalHeight >= 100) {
      const topMargin = minY + totalHeight * 0.03;
      const bottomMargin = maxY - totalHeight * 0.03;
      words = rawWords.filter((w) => {
        const isAtMargin = w.yCenter <= topMargin || w.yCenter >= bottomMargin;
        return !(isAtMargin && isBoilerplateNoise(w.text));
      });
    }
  }

  if (words.length === 0) return { markdown: '', tables: [] };

  const wordHeights = words.map((w) => w.bbox.y1 - w.bbox.y0).filter((h) => h > 0);
  const medianLineHeight =
    wordHeights.length > 0
      ? median(wordHeights)
      : lineHeights.length > 0
        ? median(lineHeights)
        : 16;

  // Median character width
  const charWidths = words
    .filter((w) => w.text.length > 0 && w.bbox.x1 > w.bbox.x0)
    .map((w) => (w.bbox.x1 - w.bbox.x0) / w.text.length);
  const medianCharWidth = charWidths.length > 0 ? median(charWidths) : medianLineHeight * 0.5;

  // Sort words top-to-bottom by yCenter, then left-to-right by bbox.x0
  words.sort((a, b) => {
    if (Math.abs(a.yCenter - b.yCenter) > 0.001) {
      return a.yCenter - b.yCenter;
    }
    return a.bbox.x0 - b.bbox.x0;
  });

  // Group words into visual rows when vertical centers are within 0.6 * medianLineHeight
  const rowThreshold = 0.6 * Math.max(1, medianLineHeight);
  const rows: { words: InternalWord[]; yCenter: number; y0: number; y1: number }[] = [];

  for (const word of words) {
    let bestRowIndex = -1;
    let minDiff = Infinity;

    for (let idx = 0; idx < rows.length; idx++) {
      const diff = Math.abs(word.yCenter - rows[idx].yCenter);
      if (diff <= rowThreshold && diff < minDiff) {
        minDiff = diff;
        bestRowIndex = idx;
      }
    }

    if (bestRowIndex !== -1) {
      const row = rows[bestRowIndex];
      row.words.push(word);
      row.y0 = Math.min(row.y0, word.bbox.y0);
      row.y1 = Math.max(row.y1, word.bbox.y1);
      const totalY = row.words.reduce((sum, w) => sum + w.yCenter, 0);
      row.yCenter = totalY / row.words.length;
    } else {
      rows.push({
        words: [word],
        yCenter: word.yCenter,
        y0: word.bbox.y0,
        y1: word.bbox.y1,
      });
    }
  }

  // Sort rows top-to-bottom
  rows.sort((a, b) => a.yCenter - b.yCenter);

  // Sort words within each row left-to-right and form column clusters
  const processedRows: ProcessedRow[] = [];
  const columnGapThreshold = 3.5 * medianCharWidth;

  for (const r of rows) {
    r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);

    const clusters: ColumnCluster[] = [];
    let currentClusterWords: InternalWord[] = [];

    for (let idx = 0; idx < r.words.length; idx++) {
      const currentWord = r.words[idx];
      if (currentClusterWords.length === 0) {
        currentClusterWords.push(currentWord);
      } else {
        const prevWord = currentClusterWords[currentClusterWords.length - 1];
        const gap = currentWord.bbox.x0 - prevWord.bbox.x1;

        if (gap > columnGapThreshold) {
          clusters.push({
            text: currentClusterWords.map((w) => w.text).join(' '),
            bbox: {
              x0: currentClusterWords[0].bbox.x0,
              y0: Math.min(...currentClusterWords.map((w) => w.bbox.y0)),
              x1: prevWord.bbox.x1,
              y1: Math.max(...currentClusterWords.map((w) => w.bbox.y1)),
            },
          });
          currentClusterWords = [currentWord];
        } else {
          currentClusterWords.push(currentWord);
        }
      }
    }

    if (currentClusterWords.length > 0) {
      clusters.push({
        text: currentClusterWords.map((w) => w.text).join(' '),
        bbox: {
          x0: currentClusterWords[0].bbox.x0,
          y0: Math.min(...currentClusterWords.map((w) => w.bbox.y0)),
          x1: currentClusterWords[currentClusterWords.length - 1].bbox.x1,
          y1: Math.max(...currentClusterWords.map((w) => w.bbox.y1)),
        },
      });
    }

    const maxHeight = Math.max(
      r.y1 - r.y0,
      ...r.words.map((w) => w.bbox.y1 - w.bbox.y0)
    );

    processedRows.push({
      words: r.words,
      clusters,
      yCenter: r.yCenter,
      y0: r.y0,
      y1: r.y1,
      height: maxHeight,
    });
  }

  interface OutputBlock {
    text: string;
    y0: number;
    y1: number;
    isTable?: boolean;
  }

  const blocks: OutputBlock[] = [];
  const extractedTables: ExtractedTable[] = [];
  let i = 0;

  while (i < processedRows.length) {
    const row = processedRows[i];

    // Table & Receipt Detection: 2+ consecutive multi-column rows
    if (preserveTables && row.clusters.length >= 2) {
      const tableRows: ProcessedRow[] = [row];
      let j = i + 1;
      while (j < processedRows.length && processedRows[j].clusters.length >= 2) {
        tableRows.push(processedRows[j]);
        j++;
      }

      if (tableRows.length >= 2) {
        const headerClusters = tableRows[0].clusters;
        const rawHeaders = headerClusters.map((c, idx) => c.text.trim() || `Col_${idx + 1}`);

        // Ensure unique header column keys for JSON record mapping
        const seenHeaders = new Set<string>();
        const headers = rawHeaders.map((h, idx) => {
          let name = h || `Col_${idx + 1}`;
          let uniqueName = name;
          let counter = 2;
          while (seenHeaders.has(uniqueName)) {
            uniqueName = `${name}_${counter++}`;
          }
          seenHeaders.add(uniqueName);
          return uniqueName;
        });

        const headerCenters = headerClusters.map((c) => (c.bbox.x0 + c.bbox.x1) / 2);
        const parsedRows: Record<string, string | number>[] = [];
        const allBodyRowCells: string[][] = [];

        for (let trIdx = 1; trIdx < tableRows.length; trIdx++) {
          const tr = tableRows[trIdx];
          let rowCells: string[];

          if (tr.clusters.length === headers.length) {
            rowCells = tr.clusters.map((c) => c.text.trim());
          } else {
            // Align by vertical gutter center
            rowCells = new Array(headers.length).fill('');
            for (const cluster of tr.clusters) {
              const clusterCenter = (cluster.bbox.x0 + cluster.bbox.x1) / 2;
              let bestCol = 0;
              let minDist = Infinity;
              for (let cIdx = 0; cIdx < headerCenters.length; cIdx++) {
                const dist = Math.abs(clusterCenter - headerCenters[cIdx]);
                if (dist < minDist) {
                  minDist = dist;
                  bestCol = cIdx;
                }
              }
              rowCells[bestCol] = rowCells[bestCol]
                ? `${rowCells[bestCol]} ${cluster.text.trim()}`
                : cluster.text.trim();
            }
          }

          allBodyRowCells.push(rowCells);

          const rowRecord: Record<string, string | number> = {};
          for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            const cellText = rowCells[colIdx] ?? '';
            const { isNumeric, value } = parseNumericValue(cellText);
            rowRecord[headers[colIdx]] = isNumeric ? value : cellText;
          }
          parsedRows.push(rowRecord);
        }

        // Deterministic column sum computation for numeric columns
        const columnSums: Record<string, number> = {};
        for (const h of headers) {
          let sum = 0;
          let numericCount = 0;
          let hasNonNumeric = false;
          for (const pr of parsedRows) {
            const val = pr[h];
            if (typeof val === 'number') {
              numericCount++;
              sum += val;
            } else if (typeof val === 'string' && val.trim() !== '') {
              hasNonNumeric = true;
            }
          }
          if (numericCount > 0 && !hasNonNumeric) {
            columnSums[h] = Math.round(sum * 10000) / 10000;
          }
        }

        // CSV serialization
        const csvLines: string[] = [headers.map(escapeCsvCell).join(',')];
        for (const bCells of allBodyRowCells) {
          csvLines.push(bCells.map(escapeCsvCell).join(','));
        }
        const csv = csvLines.join('\n');

        // TOON compact serialization: @table[Col1,Col2]{val1,val2}{val3,val4}
        const toonBody = allBodyRowCells
          .map((bCells) => `{${bCells.map(cleanToonCell).join(',')}}`)
          .join('');
        const toon = `@table[${headers.map(cleanToonCell).join(',')}]${toonBody}`;

        extractedTables.push({
          headers,
          rows: parsedRows,
          csv,
          toon,
          columnSums,
        });

        // Determine output block string according to requested tableFormat
        let tableBlockText: string;
        if (tableFormat === 'toon') {
          tableBlockText = toon;
        } else if (tableFormat === 'csv') {
          tableBlockText = csv;
        } else {
          // Standard GFM table
          const maxCols = Math.max(...tableRows.map((tr) => tr.clusters.length), headers.length);
          const tableLines: string[] = [];
          const headerCells = headers.map((h) => h.replace(/\|/g, '\\|'));
          while (headerCells.length < maxCols) headerCells.push('');
          tableLines.push(`| ${headerCells.join(' | ')} |`);

          const separatorCells = new Array(maxCols).fill('---');
          tableLines.push(`| ${separatorCells.join(' | ')} |`);

          for (const bCells of allBodyRowCells) {
            const formattedCells = bCells.map((c) => c.replace(/\|/g, '\\|'));
            while (formattedCells.length < maxCols) formattedCells.push('');
            tableLines.push(`| ${formattedCells.join(' | ')} |`);
          }
          tableBlockText = tableLines.join('\n');
        }

        blocks.push({
          text: tableBlockText,
          y0: tableRows[0].y0,
          y1: tableRows[tableRows.length - 1].y1,
          isTable: true,
        });

        i = j;
        continue;
      }
    }

    // Single or non-table row
    const rowText = row.clusters.map((c) => c.text).join('  ');

    // Heading Detection: single-cluster row with height >= 1.4x medianLineHeight and < 80 chars
    if (
      row.clusters.length === 1 &&
      row.height >= 1.4 * medianLineHeight &&
      rowText.length < 80 &&
      !rowText.startsWith('#')
    ) {
      blocks.push({
        text: `## ${rowText}`,
        y0: row.y0,
        y1: row.y1,
      });
    } else {
      blocks.push({
        text: rowText,
        y0: row.y0,
        y1: row.y1,
      });
    }

    i++;
  }

  if (blocks.length === 0) return { markdown: '', tables: extractedTables };

  let markdown = blocks[0].text;
  for (let k = 1; k < blocks.length; k++) {
    const prevBlock = blocks[k - 1];
    const currBlock = blocks[k];
    const verticalGap = currBlock.y0 - prevBlock.y1;

    // Blank line if vertical gap exceeds 1.5x median line height, or around tables
    if (verticalGap > 1.5 * medianLineHeight || prevBlock.isTable || currBlock.isTable) {
      markdown += '\n\n' + currBlock.text;
    } else {
      markdown += '\n' + currBlock.text;
    }
  }

  return {
    markdown: markdown.trim(),
    tables: extractedTables,
  };
}

/**
 * Convenience helper returning Markdown string directly.
 */
export function reconstructMarkdown(
  lines: OCRLine[],
  options?: LayoutToMarkdownOptions
): string {
  return reconstructLayout(lines, options).markdown;
}
