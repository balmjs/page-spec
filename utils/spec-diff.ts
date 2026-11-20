/**
 * Local Incremental Spec Diff Engine for PageSpec
 * Computes section-level and line-level semantic diffs when updating an existing local Markdown spec.
 */

export interface SpecDiffResult {
  hasChanges: boolean;
  addedSections: number;
  modifiedSections: number;
  removedSections: number;
  addedLines: number;
  removedLines: number;
  diffMarkdown: string;
}

interface DiffChunk {
  heading: string;
  body: string;
}

/**
 * Strip YAML frontmatter (especially volatile extracted_at timestamps) before comparing content.
 */
function stripFrontmatter(md: string): string {
  const normalized = md.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized.trim();
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) return normalized.trim();
  return normalized.slice(endIdx + 5).trim();
}

/**
 * Split body Markdown into keyed chunks by H2/H3 headings (respecting fenced code blocks).
 */
function splitIntoChunks(bodyMd: string): DiffChunk[] {
  const lines = bodyMd.split('\n');
  const chunks: DiffChunk[] = [];
  let inCode = false;
  let currentHeading = '(文档头部与摘要 / Header & Intro)';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      currentLines.push(line);
      continue;
    }
    if (!inCode && /^#{2,3}\s+/.test(line)) {
      const prevBody = currentLines.join('\n').trim();
      if (prevBody) {
        chunks.push({ heading: currentHeading, body: prevBody });
      }
      currentHeading = line.trim();
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }

  const tailBody = currentLines.join('\n').trim();
  if (tailBody) {
    chunks.push({ heading: currentHeading, body: tailBody });
  }

  return chunks;
}

interface LineDiffOp {
  type: 'equal' | 'add' | 'remove';
  line: string;
}

/**
 * Compute line-level diff via LCS (with fast-path fallback for huge blocks > 500 lines).
 */
function diffLines(oldText: string, newText: string): LineDiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  // Guard DP memory for very large chunks
  if (a.length * b.length > 250000) {
    const aSet = new Set(a);
    const bSet = new Set(b);
    const ops: LineDiffOp[] = [];
    for (const line of a) {
      if (!bSet.has(line)) ops.push({ type: 'remove', line });
    }
    for (const line of b) {
      if (!aSet.has(line)) ops.push({ type: 'add', line });
    }
    return ops;
  }

  const m = a.length;
  const n = b.length;
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'remove', line: a[i]! });
      i++;
    } else {
      ops.push({ type: 'add', line: b[j]! });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: 'remove', line: a[i++]! });
  }
  while (j < n) {
    ops.push({ type: 'add', line: b[j++]! });
  }
  return ops;
}

/**
 * Format compact diff hunks (with 1 line of surrounding context) for AI Coding Agents.
 */
function formatCompactDiff(ops: LineDiffOp[]): { text: string; added: number; removed: number } {
  let added = 0;
  let removed = 0;
  const changedIndices = new Set<number>();

  ops.forEach((op, idx) => {
    if (op.type === 'add') {
      added++;
      changedIndices.add(idx);
      if (idx > 0) changedIndices.add(idx - 1);
      if (idx + 1 < ops.length) changedIndices.add(idx + 1);
    } else if (op.type === 'remove') {
      removed++;
      changedIndices.add(idx);
      if (idx > 0) changedIndices.add(idx - 1);
      if (idx + 1 < ops.length) changedIndices.add(idx + 1);
    }
  });

  const outLines: string[] = [];
  let lastShown = -1;
  ops.forEach((op, idx) => {
    if (!changedIndices.has(idx)) return;
    if (lastShown !== -1 && idx > lastShown + 1) {
      outLines.push('  ...');
    }
    const prefix = op.type === 'add' ? '+ ' : op.type === 'remove' ? '- ' : '  ';
    outLines.push(`${prefix}${op.line}`);
    lastShown = idx;
  });

  return { text: outLines.join('\n'), added, removed };
}

/**
 * Compare an existing local Markdown spec against a newly extracted Markdown spec.
 */
export function computeMarkdownSpecDiff(
  oldMarkdown: string,
  newMarkdown: string,
  title: string,
  targetFilename: string
): SpecDiffResult {
  const oldBody = stripFrontmatter(oldMarkdown);
  const newBody = stripFrontmatter(newMarkdown);

  if (oldBody === newBody) {
    return {
      hasChanges: false,
      addedSections: 0,
      modifiedSections: 0,
      removedSections: 0,
      addedLines: 0,
      removedLines: 0,
      diffMarkdown: '',
    };
  }

  const oldChunks = splitIntoChunks(oldBody);
  const newChunks = splitIntoChunks(newBody);

  // Deduplicate identical heading keys with index suffix if repeated
  const buildMap = (chunks: DiffChunk[]) => {
    const map = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const c of chunks) {
      const n = (counts.get(c.heading) || 0) + 1;
      counts.set(c.heading, n);
      const key = n === 1 ? c.heading : `${c.heading} (#${n})`;
      map.set(key, c.body);
    }
    return map;
  };

  const oldMap = buildMap(oldChunks);
  const newMap = buildMap(newChunks);

  const addedBlocks: Array<{ heading: string; body: string }> = [];
  const modifiedBlocks: Array<{ heading: string; diffText: string; added: number; removed: number }> = [];
  const removedBlocks: Array<{ heading: string; body: string }> = [];

  let totalAddedLines = 0;
  let totalRemovedLines = 0;

  for (const [heading, newChunkBody] of newMap.entries()) {
    if (!oldMap.has(heading)) {
      const lineCount = newChunkBody.split('\n').length;
      totalAddedLines += lineCount;
      addedBlocks.push({ heading, body: newChunkBody });
    } else {
      const oldChunkBody = oldMap.get(heading)!;
      if (oldChunkBody !== newChunkBody) {
        const ops = diffLines(oldChunkBody, newChunkBody);
        const formatted = formatCompactDiff(ops);
        totalAddedLines += formatted.added;
        totalRemovedLines += formatted.removed;
        modifiedBlocks.push({
          heading,
          diffText: formatted.text,
          added: formatted.added,
          removed: formatted.removed,
        });
      }
    }
  }

  for (const [heading, oldChunkBody] of oldMap.entries()) {
    if (!newMap.has(heading)) {
      const lineCount = oldChunkBody.split('\n').length;
      totalRemovedLines += lineCount;
      removedBlocks.push({ heading, body: oldChunkBody });
    }
  }

  const hasChanges = addedBlocks.length > 0 || modifiedBlocks.length > 0 || removedBlocks.length > 0;
  if (!hasChanges) {
    return {
      hasChanges: false,
      addedSections: 0,
      modifiedSections: 0,
      removedSections: 0,
      addedLines: 0,
      removedLines: 0,
      diffMarkdown: '',
    };
  }

  const lines: string[] = [
    '---',
    `title: "${title.replace(/"/g, '\\"')} (Incremental Diff)"`,
    `target_spec: "./${targetFilename}"`,
    `generated_at: "${new Date().toISOString()}"`,
    `added_sections: ${addedBlocks.length}`,
    `modified_sections: ${modifiedBlocks.length}`,
    `removed_sections: ${removedBlocks.length}`,
    `added_lines: ${totalAddedLines}`,
    `removed_lines: ${totalRemovedLines}`,
    '---',
    '',
    `# Incremental Spec Diff: ${title}`,
    '',
    `> Target file: \`./${targetFilename}\`  `,
    `> Summary: **+${addedBlocks.length} added sections**, **~${modifiedBlocks.length} modified sections**, **-${removedBlocks.length} removed sections** (\`+${totalAddedLines}\` / \`-${totalRemovedLines}\` lines).`,
    '',
  ];

  if (addedBlocks.length > 0) {
    lines.push('## Added Sections', '');
    for (const blk of addedBlocks) {
      lines.push(`### ${blk.heading.replace(/^#+\s*/, '')}`, '');
      lines.push(blk.body, '');
    }
  }

  if (modifiedBlocks.length > 0) {
    lines.push('## Modified Sections', '');
    for (const blk of modifiedBlocks) {
      lines.push(`### ${blk.heading.replace(/^#+\s*/, '')} (\`+${blk.added}\` / \`-${blk.removed}\`)`, '');
      lines.push('```diff');
      lines.push(blk.diffText);
      lines.push('```', '');
    }
  }

  if (removedBlocks.length > 0) {
    lines.push('## Removed Sections', '');
    for (const blk of removedBlocks) {
      lines.push(`### ${blk.heading.replace(/^#+\s*/, '')}`, '');
      lines.push('```diff');
      lines.push(
        blk.body
          .split('\n')
          .map((l) => `- ${l}`)
          .join('\n')
      );
      lines.push('```', '');
    }
  }

  return {
    hasChanges: true,
    addedSections: addedBlocks.length,
    modifiedSections: modifiedBlocks.length,
    removedSections: removedBlocks.length,
    addedLines: totalAddedLines,
    removedLines: totalRemovedLines,
    diffMarkdown: lines.join('\n'),
  };
}
