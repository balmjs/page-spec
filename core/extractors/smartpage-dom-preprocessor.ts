/**
 * DOM Preprocessor for Tencent SmartPage (blankpage), Weixin SmartPage,
 * and modern block-based rich text editors.
 *
 * Reconstructs headings, bold styles, list hierarchies, and media attachments
 * before Turndown HTML-to-Markdown conversion.
 */

export function preprocessSmartpageDom(container: HTMLElement): void {
  if (!container) return;

  // 1. Clean zero-width and invisible characters
  cleanZeroWidthChars(container);

  // 2. Identify & normalize Video Attachments (prevent poster image from becoming fake prototype image)
  normalizeVideoAttachments(container);

  // 3. Normalize Bold formatting (convert style="font-weight: 600/700/bold" to <strong>)
  normalizeBoldElements(container);

  // 4. Identify & convert Headings (Level 2: 一、..., Level 3: ✅..., 4.1、...)
  normalizeHeadings(container);

  // 5. Reconstruct List Items (merge separate marker spans/divs with content into standard <ol>/<ul>/<li>)
  normalizeListStructures(container);
}

/**
 * Remove zero-width non-joiners (\u200c), zero-width spaces (\u200b), etc.
 */
function cleanZeroWidthChars(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const toClean: Text[] = [];
  while (walker.nextNode()) {
    toClean.push(walker.currentNode as Text);
  }
  for (const node of toClean) {
    if (/[\u200b\u200c\u200d\u200e\u200f\ufeff]/.test(node.nodeValue || '')) {
      node.nodeValue = (node.nodeValue || '').replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '');
    }
  }
}

/**
 * Normalize video attachment blocks
 * In Tencent SmartPage, video files (e.g. 6bd6a81e3bfa9bfab192948c8f259449.mp4)
 * render with a video player UI, poster thumbnail, and duration badge (00:28).
 * We clean up the duration badge and poster image, and output the clean filename.
 */
function normalizeVideoAttachments(root: HTMLElement): void {
  const videoRegex = /([a-zA-Z0-9_\-\.]+\.(?:mp4|mov|webm|avi))/i;

  // Find all elements containing video filename
  const allElements = Array.from(root.querySelectorAll('*'));
  for (const el of allElements) {
    // Check if this element directly contains a video filename
    const text = el.textContent?.trim() || '';
    const match = text.match(videoRegex);
    if (!match) continue;

    const videoFilename = match[1];
    if (!videoFilename) continue;

    // Find the enclosing video player wrapper or block
    let wrapper: HTMLElement = el as HTMLElement;
    while (
      wrapper.parentElement &&
      wrapper.parentElement !== root &&
      (wrapper.parentElement.querySelectorAll('img, video, canvas').length > 0 ||
        /\d{2}:\d{2}/.test(wrapper.parentElement.textContent || ''))
    ) {
      wrapper = wrapper.parentElement;
    }

    // Remove duration badges (e.g. "00:28", "00:18") inside or adjacent
    const badges = wrapper.querySelectorAll('*');
    badges.forEach((b) => {
      if (/^\s*\d{2}:\d{2}(?::\d{2})?\s*$/.test(b.textContent || '')) {
        b.remove();
      }
    });

    // Remove video poster images inside wrapper so they don't get saved as fake prototypes
    const posterImgs = wrapper.querySelectorAll('img, canvas');
    posterImgs.forEach((img) => img.remove());

    // Replace wrapper content with clean video paragraph
    const p = document.createElement('p');
    p.textContent = videoFilename;
    wrapper.replaceWith(p);
  }
}

/**
 * Normalize elements with bold styles into <strong>
 */
function normalizeBoldElements(root: HTMLElement): void {
  const candidates = Array.from(root.querySelectorAll('span, div, p, b, strong'));
  for (const el of candidates) {
    const htmlEl = el as HTMLElement;
    const fw = htmlEl.style?.fontWeight || '';
    const isBoldStyle =
      fw === 'bold' ||
      fw === 'bolder' ||
      parseInt(fw, 10) >= 600 ||
      htmlEl.classList.contains('bold') ||
      htmlEl.classList.contains('text-bold');

    if (isBoldStyle && htmlEl.tagName !== 'STRONG' && htmlEl.tagName !== 'B') {
      const text = htmlEl.textContent?.trim();
      // Only wrap if it contains actual non-empty text and isn't a whole section container
      if (text && text.length > 0 && text.length < 300) {
        const strong = document.createElement('strong');
        strong.innerHTML = htmlEl.innerHTML;
        htmlEl.replaceWith(strong);
      }
    }
  }
}

/**
 * Detect Section and Sub-section Headings and convert to <h2> / <h3>
 */
function normalizeHeadings(root: HTMLElement): void {
  // Elements that could be heading blocks
  const candidates = Array.from(
    root.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"]')
  );

  for (const el of candidates) {
    const htmlEl = el as HTMLElement;
    // Skip if it contains other block children
    if (htmlEl.children.length > 4) continue;

    const text = htmlEl.textContent?.trim() || '';
    if (!text || text.length > 60) continue;

    const level = detectHeadingLevel(text);
    if (level === 2 && htmlEl.tagName !== 'H2') {
      const h2 = document.createElement('h2');
      h2.textContent = text.replace(/^\*\*|\*\*$/g, '').trim();
      htmlEl.replaceWith(h2);
    } else if (level === 3 && htmlEl.tagName !== 'H3') {
      const h3 = document.createElement('h3');
      h3.textContent = text.replace(/^\*\*|\*\*$/g, '').trim();
      htmlEl.replaceWith(h3);
    }
  }
}

/**
 * Smart detection of heading level based on text semantics
 */
export function detectHeadingLevel(text: string): number {
  const t = text.trim();
  if (!t) return 0;

  // Level 2: "一、原创推荐模块", "二、今日头条模块", "三、问题总结", "四、需求描述"
  if (/^[一二三四五六七八九十]+[、.]\s*[^。；;!！?？\n]{1,35}$/.test(t)) {
    return 2;
  }

  // Level 3: Emoji Callouts ("✅ 正常点", "❌ 问题", "✅ 现状", "🎯 期望改动 + ❌ 原有问题", "📌 说明", "⚠️ 注意")
  if (
    /^(?:[✅✔️☑️🎯❌⚡️💡📌⚠️🔍🚀🔥🌟⭐️✨❓🚩🏷️])\s*[^。；;!！?？\n]{1,35}$/u.test(t) ||
    /^(?:🎯\s*期望改动|❌\s*原有问题|✅\s*正常点|✅\s*现状)/.test(t)
  ) {
    return 3;
  }

  // Level 3: Subsections ("4.1、预览场景", "4.2、投稿详情场景", "4.3、列表行交互优化：", "(1) 交互逻辑")
  if (
    /^(?:\*\*\s*)?[1-9]\.[1-9]\d?[.、:]\s*[^。；;!！?？\n]{1,35}(?:\*\*)?$/.test(t) ||
    /^(?:\*\*\s*)?[（(][1-9一二三四五六七八九十]+[)）]\s*[^。；;!！?？\n]{1,35}(?:\*\*)?$/.test(t)
  ) {
    return 3;
  }

  return 0;
}

/**
 * Reconstruct list items where numbers/letters ("1.", "2.", "a.", "b.")
 * are separated into standalone elements or preceding paragraphs.
 */
function normalizeListStructures(root: HTMLElement): void {
  // Pass 1: Find adjacent blocks where block A is JUST a marker (e.g. "1.", "a.")
  // and block B is the content. Merge them into a single <li>.
  const children = Array.from(root.children);
  for (let i = 0; i < children.length - 1; i++) {
    const cur = children[i] as HTMLElement;
    const next = children[i + 1] as HTMLElement;
    if (!cur || !next) continue;

    const curText = cur.textContent?.trim() || '';
    const markerMatch = curText.match(/^([0-9]+[.)、]|[a-zA-Z][.)、]|[·•-])$/);
    if (markerMatch && markerMatch[1]) {
      const marker = markerMatch[1];
      const isSubList = /^[a-zA-Z][.)、]$/.test(marker);

      const li = document.createElement('li');
      li.innerHTML = next.innerHTML;
      // Mark as sub-list or ordered
      if (isSubList) {
        li.setAttribute('data-sublist', 'true');
      }

      // Replace cur with an ol/ul container wrapping li, remove next
      const listEl = document.createElement(/^[0-9a-zA-Z]/.test(marker) ? 'ol' : 'ul');
      if (isSubList) {
        listEl.setAttribute('data-indent', '1');
      }
      listEl.appendChild(li);

      cur.replaceWith(listEl);
      next.remove();
    }
  }

  // Pass 2: Clean up elements that contain inline separated marker spans
  const blocksWithMarker = Array.from(root.querySelectorAll('div, p'));
  for (const block of blocksWithMarker) {
    const firstSpan = block.firstElementChild as HTMLElement;
    if (firstSpan && firstSpan !== block) {
      const markerText = firstSpan.textContent?.trim() || '';
      if (/^[0-9]+[.)、]$/.test(markerText) || /^[a-zA-Z][.)、]$/.test(markerText)) {
        // Already within one block; ensure a trailing space after marker
        firstSpan.textContent = `${markerText} `;
      }
    }
  }
}

/**
 * Post-process Turndown Markdown output to fix list indentation,
 * zero-width lines, and heading spacing.
 */
export function postprocessMarkdown(markdown: string): string {
  let res = markdown;

  // 1. Remove zero-width characters
  res = res.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '');

  // 2. Remove orphan video duration lines (e.g. "\n00:28\n")
  res = res.replace(/\n\s*\d{2}:\d{2}(?::\d{2})?\s*\n/g, '\n');

  // 3. Fix headings:
  // Level 2: "## 一、..."
  res = res.replace(/\n(?:\*\*\s*)?([一二三四五六七八九十]+[、.][^\n]+?)(?:\s*\*\*)?\n/g, (match, title) => {
    return `\n\n## ${title.trim()}\n\n`;
  });

  // Level 3 Callout Headings: "### ✅ 正常点", "### ❌ 问题", etc.
  res = res.replace(
    /\n(?:\*\*\s*)?([✅✔️☑️🎯❌⚡️💡📌⚠️🔍🚀🔥🌟⭐️✨❓🚩🏷️][^\n]+?)(?:\s*\*\*)?\n/gu,
    (match, title) => {
      const clean = title.replace(/^\*\*|\*\*$/g, '').trim();
      return `\n\n### ${clean}\n\n`;
    }
  );

  // Subsections: "4.1、预览场景", "4.2、投稿详情场景", "4.3、列表行交互优化："
  // Match " 4.1、预览场景" or "**4.1、预览场景**"
  res = res.replace(
    /\n\s*(?:\*\*\s*)?([1-9]\.[1-9]\d?[.、:][^\n]+?)(?:\s*\*\*)?\n/g,
    (match, title) => {
      const clean = title.replace(/^\*\*|\*\*$/g, '').trim();
      return `\n\n**${clean}**\n\n`;
    }
  );

  // 4. Merge split list numbers: "1.\n\n预览效果弹窗" -> "1. 预览效果弹窗"
  res = res.replace(/\n([0-9]+|[a-zA-Z])\.\s*\n\s*\n([^\n]+)/g, '\n$1. $2');

  // 5. Indent sub-lists ("a.", "b.") under parent ordered lists
  res = res.replace(/\n([a-zA-Z])\.\s+([^\n]+)/g, '\n    1. $2');

  // 6. Fix bold format with colon: "**预览效果弹窗** ：" -> "**预览效果弹窗**："
  res = res.replace(/\*\*\s+：/g, '**：');

  // 7. Clean up excessive consecutive blank lines (more than 2 -> 2)
  res = res.replace(/\n{3,}/g, '\n\n');

  return res.trim();
}
