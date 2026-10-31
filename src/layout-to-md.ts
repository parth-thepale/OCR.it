import { OCRLine, BoundingBox } from './types';

export interface LayoutToMarkdownOptions {
  preserveTables?: boolean;
  confidenceThreshold?: number;
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
 * Deterministically reconstructs spatial OCR layout bounding boxes into clean, LLM-ready GFM Markdown.
 */
export function reconstructMarkdown(
  lines: OCRLine[],
  options?: LayoutToMarkdownOptions
): string {
  if (!lines || lines.length === 0) return '';

  const threshold = options?.confidenceThreshold ?? 30;
  const preserveTables = options?.preserveTables !== false;

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

  if (rawWords.length === 0) return '';

  const wordHeights = rawWords.map((w) => w.bbox.y1 - w.bbox.y0).filter((h) => h > 0);
  const medianLineHeight =
    wordHeights.length > 0
      ? median(wordHeights)
      : lineHeights.length > 0
        ? median(lineHeights)
        : 16;

  // Median character width
  const charWidths = rawWords
    .filter((w) => w.text.length > 0 && w.bbox.x1 > w.bbox.x0)
    .map((w) => (w.bbox.x1 - w.bbox.x0) / w.text.length);
  const medianCharWidth = charWidths.length > 0 ? median(charWidths) : medianLineHeight * 0.5;

  // Sort words top-to-bottom by yCenter, then left-to-right by bbox.x0
  rawWords.sort((a, b) => {
    if (Math.abs(a.yCenter - b.yCenter) > 0.001) {
      return a.yCenter - b.yCenter;
    }
    return a.bbox.x0 - b.bbox.x0;
  });

  // Group words into visual rows when vertical centers are within 0.6 * medianLineHeight
  const rowThreshold = 0.6 * Math.max(1, medianLineHeight);
  const rows: { words: InternalWord[]; yCenter: number; y0: number; y1: number }[] = [];

  for (const word of rawWords) {
    let bestRowIndex = -1;
    let minDiff = Infinity;

    for (let i = 0; i < rows.length; i++) {
      const diff = Math.abs(word.yCenter - rows[i].yCenter);
      if (diff <= rowThreshold && diff < minDiff) {
        minDiff = diff;
        bestRowIndex = i;
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

    for (let i = 0; i < r.words.length; i++) {
      const currentWord = r.words[i];
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
        const maxCols = Math.max(...tableRows.map((tr) => tr.clusters.length));
        const tableLines: string[] = [];

        // Header row
        const headerCells = tableRows[0].clusters.map((c) => c.text.replace(/\|/g, '\\|'));
        while (headerCells.length < maxCols) headerCells.push('');
        tableLines.push(`| ${headerCells.join(' | ')} |`);

        // Header separator
        const separatorCells = new Array(maxCols).fill('---');
        tableLines.push(`| ${separatorCells.join(' | ')} |`);

        // Body rows
        for (let trIdx = 1; trIdx < tableRows.length; trIdx++) {
          const bodyCells = tableRows[trIdx].clusters.map((c) => c.text.replace(/\|/g, '\\|'));
          while (bodyCells.length < maxCols) bodyCells.push('');
          tableLines.push(`| ${bodyCells.join(' | ')} |`);
        }

        blocks.push({
          text: tableLines.join('\n'),
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

  if (blocks.length === 0) return '';

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

  return markdown.trim();
}
