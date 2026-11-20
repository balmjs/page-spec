/**
 * Markdown Section Parser & Trimmer for PageSpec
 * Allows auto-filtering noisy sections (e.g. Revision History) and interactive section pruning.
 */

export interface MarkdownSectionItem {
  id: string;
  level: number;
  heading: string;
  charCount: number;
  isNoisy: boolean;
  checked: boolean;
}

interface ParsedMarkdownBlocks {
  preamble: string;
  sections: Array<MarkdownSectionItem & { rawBlock: string }>;
}

const NOISY_SECTION_PATTERN =
  /^(?:\d+(?:\.\d+)*[\s.、)）]*)?(?:修订历史|修改历史|修改记录|变更记录|变更历史|版本历史|版本记录|更新日志|更新记录|文档修订|文档历史|非本期(?:需求|范围)?|历史版本|Revision\s+History|Change\s*log|Version\s+History|Document\s+History|Out\s+of\s+Scope)$/i;

export function isNoisySectionHeading(heading: string): boolean {
  const normalized = heading
    .replace(/[*_`~]/g, '')
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+/u, '')
    .trim();
  return NOISY_SECTION_PATTERN.test(normalized);
}

/**
 * Split a Markdown document into preamble (Frontmatter + H1 + intro) and H2/H3 sections.
 * Respects fenced code blocks so '#' inside code blocks are never mistaken for headings.
 */
function parseMarkdownBlocks(markdown: string): ParsedMarkdownBlocks {
  const lines = markdown.split('\n');
  let inFrontmatter = false;
  let inCodeBlock = false;
  let frontmatterClosed = false;

  const preambleLines: string[] = [];
  const rawSections: Array<{ level: number; heading: string; lines: string[] }> = [];
  let currentSection: { level: number; heading: string; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Detect YAML Frontmatter at start of document
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      preambleLines.push(line);
      continue;
    }
    if (inFrontmatter) {
      preambleLines.push(line);
      if (line.trim() === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }

    // Track fenced code blocks
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      if (currentSection) {
        currentSection.lines.push(line);
      } else {
        preambleLines.push(line);
      }
      continue;
    }

    if (!inCodeBlock) {
      // Split on H2 or H3 headings (keep H1 in preamble so doc title is preserved)
      const headingMatch = line.match(/^(#{2,3})\s+(.+?)\s*$/);
      if (headingMatch) {
        if (currentSection) {
          rawSections.push(currentSection);
        }
        currentSection = {
          level: headingMatch[1]!.length,
          heading: headingMatch[2]!.trim(),
          lines: [line],
        };
        continue;
      }
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (currentSection) {
    rawSections.push(currentSection);
  }

  // Fallback: if no H2/H3 found, try splitting on H1 headings after frontmatter
  if (rawSections.length === 0 && (frontmatterClosed || lines.length > 0)) {
    return {
      preamble: markdown,
      sections: [],
    };
  }

  const sections = rawSections.map((sec, idx) => {
    const rawBlock = sec.lines.join('\n');
    const noisy = isNoisySectionHeading(sec.heading);
    return {
      id: `sec-${idx + 1}`,
      level: sec.level,
      heading: sec.heading,
      charCount: rawBlock.trim().length,
      isNoisy: noisy,
      checked: !noisy,
      rawBlock,
    };
  });

  return {
    preamble: preambleLines.join('\n'),
    sections,
  };
}

/**
 * Extract selectable section metadata from Markdown for UI trimming tree.
 */
export function parseMarkdownSections(markdown: string): MarkdownSectionItem[] {
  const { sections } = parseMarkdownBlocks(markdown);
  return sections.map(({ id, level, heading, charCount, isNoisy, checked }) => ({
    id,
    level,
    heading,
    charCount,
    isNoisy,
    checked,
  }));
}

/**
 * Reconstruct Markdown excluding sections whose IDs are in `excludedIds`.
 */
export function trimMarkdownBySections(markdown: string, excludedIds: Set<string> | string[]): string {
  const excludedSet = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  if (excludedSet.size === 0) return markdown;

  const { preamble, sections } = parseMarkdownBlocks(markdown);
  if (sections.length === 0) return markdown;

  const keptBlocks = sections.filter((s) => !excludedSet.has(s.id)).map((s) => s.rawBlock.trimEnd());

  const cleanPreamble = preamble.trimEnd();
  if (keptBlocks.length === 0) {
    return `${cleanPreamble}\n`;
  }

  return `${cleanPreamble}\n\n${keptBlocks.join('\n\n')}\n`;
}

/**
 * Automatically remove sections matching common noisy headings (e.g. Revision History).
 */
export function autoTrimNoisySections(markdown: string): {
  markdown: string;
  removedHeadings: string[];
} {
  const sections = parseMarkdownSections(markdown);
  const noisy = sections.filter((s) => s.isNoisy);
  if (noisy.length === 0) {
    return { markdown, removedHeadings: [] };
  }
  const excludedIds = new Set(noisy.map((s) => s.id));
  return {
    markdown: trimMarkdownBySections(markdown, excludedIds),
    removedHeadings: noisy.map((s) => s.heading),
  };
}
