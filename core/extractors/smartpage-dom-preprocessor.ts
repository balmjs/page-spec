/**
 * DOM Preprocessor for Tencent SmartPage (blankpage), Weixin SmartPage,
 * and modern block-based rich text editors.
 *
 * Reconstructs headings, bold styles, list hierarchies, and media attachments
 * before Turndown HTML-to-Markdown conversion.
 */

import { resolveImageSource, isSignificantVisualElement } from '../../utils/dom-helpers';

export interface LiveDomCaptureResult {
  cleanup: () => void;
  canvasMap: Map<string, HTMLCanvasElement>;
}

/**
 * Mark live DOM elements with computed style metadata (bold, heading, video, subitem, visual metrics)
 * BEFORE cloning. Returns canvasMap and a cleanup function to revert attributes on the live DOM.
 */
export function markLiveDomForSmartpage(container: Element): LiveDomCaptureResult {
  const markedEls: Element[] = [];
  const canvasMap = new Map<string, HTMLCanvasElement>();

  try {
    const all = Array.from(container.querySelectorAll('*'));
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      if (!el) continue;

      // 0. Visual measurement and pre-capture on Live DOM
      if (el.tagName === 'IMG') {
        const img = el as HTMLImageElement;
        const rect = img.getBoundingClientRect();
        const w = img.naturalWidth || img.width || rect.width;
        const h = img.naturalHeight || img.height || rect.height;
        if (w > 0) el.setAttribute('data-ps-width', String(Math.round(w)));
        if (h > 0) el.setAttribute('data-ps-height', String(Math.round(h)));

        const realSrc = resolveImageSource(img);
        if (realSrc) {
          el.setAttribute('data-ps-resolved-src', realSrc);
        }

        if (!isSignificantVisualElement(el)) {
          el.setAttribute('data-ps-ignore', 'true');
        }
        markedEls.push(el);

        // Check video attachment images (<img alt="xxx.mp4"> or <img src="...mp4">)
        const alt = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        const videoMatch = (alt + ' ' + src).match(/([a-zA-Z0-9_\-\.]+\.(?:mp4|mov|webm|avi))/i);
        if (videoMatch && videoMatch[1]) {
          el.setAttribute('data-ps-video', videoMatch[1]);
          // Video preview posters must never be ignored
          el.removeAttribute('data-ps-ignore');
        }
        continue;
      }

      if (el.tagName === 'CANVAS') {
        const canvas = el as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const w = canvas.width || rect.width;
        const h = canvas.height || rect.height;
        if (w > 0) el.setAttribute('data-ps-width', String(Math.round(w)));
        if (h > 0) el.setAttribute('data-ps-height', String(Math.round(h)));

        if (isSignificantVisualElement(canvas)) {
          const cid = `canvas-${canvasMap.size + 1}`;
          el.setAttribute('data-ps-canvas-id', cid);
          canvasMap.set(cid, canvas);
        } else {
          el.setAttribute('data-ps-ignore', 'true');
        }
        markedEls.push(el);
        continue;
      }

      if (el.tagName === 'SVG' && !el.parentElement?.closest('svg')) {
        const svg = el as unknown as SVGSVGElement;
        const rect = svg.getBoundingClientRect();
        const w = svg.width?.baseVal?.value || rect.width;
        const h = svg.height?.baseVal?.value || rect.height;
        if (w > 0) el.setAttribute('data-ps-width', String(Math.round(w)));
        if (h > 0) el.setAttribute('data-ps-height', String(Math.round(h)));

        if (!isSignificantVisualElement(svg)) {
          el.setAttribute('data-ps-ignore', 'true');
        }
        markedEls.push(el);
      }

      if (!el.style) continue;

      // Read computed styles in live document context
      const cs = window.getComputedStyle(el);
      const text = el.textContent?.trim() || '';

      // 2. Check headings by text semantics or font-size
      if (text.length > 0 && text.length <= 80 && el.children.length <= 3) {
        const level = detectHeadingLevel(text);
        if (level > 0) {
          el.setAttribute('data-ps-heading', String(level));
          markedEls.push(el);
        } else {
          const fs = parseFloat(cs.fontSize) || 14;
          const fw = cs.fontWeight;
          const isBold = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600;
          if (fs >= 20 && isBold) {
            el.setAttribute('data-ps-heading', '2');
            markedEls.push(el);
          } else if (fs >= 17 && isBold) {
            el.setAttribute('data-ps-heading', '3');
            markedEls.push(el);
          }
        }
      }

      // 3. Check computed font-weight for bold text
      const fw = cs.fontWeight;
      if (fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600) {
        const textLen = text.length;
        if (textLen > 0 && textLen < 250 && el.children.length <= 2) {
          // Avoid double marking if already marked as heading
          if (!el.hasAttribute('data-ps-heading')) {
            el.setAttribute('data-ps-bold', 'true');
            markedEls.push(el);
          }
        }
      }

      // 4. Check indentation for sub-bullet items
      const pl = parseFloat(cs.paddingLeft) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;
      if ((pl >= 18 || ml >= 18) && el.tagName !== 'LI') {
        el.setAttribute('data-ps-subitem', 'true');
        markedEls.push(el);
      }

      // 5. Check blockquote / quote callouts
      if (el.tagName === 'BLOCKQUOTE') {
        el.setAttribute('data-ps-quote', 'true');
        markedEls.push(el);
      } else if (
        el.tagName !== 'TABLE' &&
        el.tagName !== 'TD' &&
        el.tagName !== 'TH' &&
        el.tagName !== 'TR' &&
        el.tagName !== 'TBODY' &&
        el.tagName !== 'THEAD'
      ) {
        const className = (el.className || '').toString().toLowerCase();
        const isQuoteClass =
          className.includes('blockquote') ||
          className.includes('callout-quote') ||
          (className.includes('quote') && !className.includes('quotation'));
        const borderLeftW = parseFloat(cs.borderLeftWidth) || 0;
        const borderLeftStyle = cs.borderLeftStyle;
        const borderTopW = parseFloat(cs.borderTopWidth) || 0;
        const borderRightW = parseFloat(cs.borderRightWidth) || 0;
        const borderBottomW = parseFloat(cs.borderBottomWidth) || 0;

        const hasLeftQuoteBorder =
          borderLeftW >= 2 &&
          borderLeftStyle === 'solid' &&
          borderTopW === 0 &&
          borderRightW === 0 &&
          borderBottomW === 0;

        if (isQuoteClass || hasLeftQuoteBorder) {
          el.setAttribute('data-ps-quote', 'true');
          markedEls.push(el);
        }
      }
    }

    // Mark top-level visual coordinates for absolute-positioned layouts (Axure canvas, wireframes)
    const isAxureCanvas = container.id === 'base' || Boolean(container.querySelector('.ax_default'));
    if (isAxureCanvas) {
      const directChildren = Array.from(container.children);
      for (const child of directChildren) {
        if (child instanceof HTMLElement) {
          const rect = child.getBoundingClientRect();
          child.setAttribute('data-ps-top', String(Math.round(rect.top + window.scrollY)));
          child.setAttribute('data-ps-left', String(Math.round(rect.left + window.scrollX)));
          markedEls.push(child);
        }
      }
    }
  } catch (err) {
    console.warn('[PageSpec] Failed to mark live DOM:', err);
  }

  // Cleanup function removes attributes from live webpage
  const cleanup = () => {
    for (const el of markedEls) {
      el.removeAttribute('data-ps-video');
      el.removeAttribute('data-ps-heading');
      el.removeAttribute('data-ps-bold');
      el.removeAttribute('data-ps-subitem');
      el.removeAttribute('data-ps-quote');
      el.removeAttribute('data-ps-width');
      el.removeAttribute('data-ps-height');
      el.removeAttribute('data-ps-top');
      el.removeAttribute('data-ps-left');
      el.removeAttribute('data-ps-resolved-src');
      el.removeAttribute('data-ps-ignore');
      el.removeAttribute('data-ps-canvas-id');
    }
  };

  return { cleanup, canvasMap };
}

/**
 * Preprocess the cloned DOM using marked metadata and structural transformations
 */
export function preprocessSmartpageDom(container: HTMLElement): void {
  if (!container) return;

  // 0. Normalize Axure Canvas layout and clean Axure technical noise
  normalizeAxureLayout(container);

  // 1. Clean zero-width and invisible characters
  cleanZeroWidthChars(container);

  // 2. Normalize video attachments
  normalizeVideoAttachments(container);

  // 3. Normalize Headings
  normalizeHeadings(container);

  // 4. Normalize Quotes
  normalizeQuotes(container);

  // 5. Normalize Bold elements
  normalizeBoldElements(container);

  // 6. Normalize sub-items and lists
  normalizeListStructures(container);
}

/**
 * Normalize Axure RP canvas layout: remove empty technical divs and sort widgets by reading order
 */
function normalizeAxureLayout(root: HTMLElement): void {
  // 1. Clean empty Axure shape backgrounds (#u*_div)
  const axureDivs = Array.from(root.querySelectorAll('[id$="_div"]'));
  for (const div of axureDivs) {
    if (!div.textContent?.trim() && !div.querySelector('img, svg, canvas')) {
      div.remove();
    }
  }

  // 2. Clean Axure hidden empty text layers
  const hiddenTexts = Array.from(root.querySelectorAll('[id$="_text"]'));
  for (const el of hiddenTexts) {
    const style = (el.getAttribute('style') || '').toLowerCase();
    if ((style.includes('visibility: hidden') || style.includes('display: none')) && !el.textContent?.trim()) {
      el.remove();
    }
  }

  // 3. Sort positioned elements by natural reading order (top-to-bottom, left-to-right)
  const childrenWithPos = Array.from(root.children).filter(
    (c) => c instanceof HTMLElement && c.hasAttribute('data-ps-top')
  ) as HTMLElement[];

  if (childrenWithPos.length > 1) {
    childrenWithPos.sort((a, b) => {
      const topA = parseFloat(a.getAttribute('data-ps-top') || '0');
      const topB = parseFloat(b.getAttribute('data-ps-top') || '0');
      const leftA = parseFloat(a.getAttribute('data-ps-left') || '0');
      const leftB = parseFloat(b.getAttribute('data-ps-left') || '0');

      // 15px line tolerance: if vertical distance is small, read left-to-right
      if (Math.abs(topA - topB) <= 15) {
        return leftA - leftB;
      }
      return topA - topB;
    });

    for (const child of childrenWithPos) {
      root.appendChild(child);
    }
  }
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
 * Normalize video attachment blocks: preserve preview poster images while cleaning player controls
 */
function normalizeVideoAttachments(root: HTMLElement): void {
  // Elements marked with data-ps-video
  const videoEls = Array.from(root.querySelectorAll('[data-ps-video]'));
  for (const el of videoEls) {
    const filename = el.getAttribute('data-ps-video');
    if (!filename) continue;

    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement;
      if (!img.getAttribute('alt') || img.getAttribute('alt') === filename) {
        img.setAttribute('alt', filename);
      }
    }

    // Clean up duration badges (e.g. "00:28") and control icons in wrapper without removing image
    const wrapper = el.parentElement;
    if (wrapper && wrapper !== root && wrapper.children.length <= 5) {
      const badges = Array.from(wrapper.querySelectorAll('*'));
      for (const b of badges) {
        if (b !== el && b.children.length === 0 && /^\s*\d{2}:\d{2}(?::\d{2})?\s*$/.test(b.textContent || '')) {
          b.remove();
        }
      }
    }
  }

  // Also clean up any lingering player duration badges (e.g. "00:28") strictly on leaf elements
  const all = Array.from(root.querySelectorAll('*'));
  for (const el of all) {
    if (el.children.length === 0 && /^\s*\d{2}:\d{2}(?::\d{2})?\s*$/.test(el.textContent || '')) {
      el.remove();
    }
  }
}

/**
 * Normalize elements with bold styles into <strong>
 */
function normalizeBoldElements(root: HTMLElement): void {
  const boldEls = Array.from(root.querySelectorAll('[data-ps-bold="true"]'));
  for (const el of boldEls) {
    const htmlEl = el as HTMLElement;
    if (htmlEl.tagName === 'P' || htmlEl.tagName === 'DIV' || htmlEl.tagName === 'LI') {
      const strong = document.createElement('strong');
      strong.innerHTML = htmlEl.innerHTML;
      htmlEl.innerHTML = '';
      htmlEl.appendChild(strong);
    } else if (htmlEl.tagName !== 'STRONG' && htmlEl.tagName !== 'B') {
      const strong = document.createElement('strong');
      strong.innerHTML = htmlEl.innerHTML;
      htmlEl.replaceWith(strong);
    }
  }

  // Also check inline style or bold classes
  const candidates = Array.from(root.querySelectorAll('span, div, p, b, strong'));
  for (const el of candidates) {
    const htmlEl = el as HTMLElement;
    const fw = htmlEl.style?.fontWeight || '';
    const className = (htmlEl.className || '').toString().toLowerCase();
    const isBold =
      fw === 'bold' ||
      fw === 'bolder' ||
      parseInt(fw, 10) >= 550 ||
      className.includes('bold') ||
      className.includes('heavy');

    if (isBold && htmlEl.tagName !== 'STRONG' && htmlEl.tagName !== 'B') {
      const text = htmlEl.textContent?.trim();
      if (text && text.length > 0 && text.length < 250) {
        if (htmlEl.tagName === 'P' || htmlEl.tagName === 'DIV' || htmlEl.tagName === 'LI') {
          const strong = document.createElement('strong');
          strong.innerHTML = htmlEl.innerHTML;
          htmlEl.innerHTML = '';
          htmlEl.appendChild(strong);
        } else {
          const strong = document.createElement('strong');
          strong.innerHTML = htmlEl.innerHTML;
          htmlEl.replaceWith(strong);
        }
      }
    }
  }
}

/**
 * Detect Section and Sub-section Headings and convert to <h2> / <h3>
 */
function normalizeHeadings(root: HTMLElement): void {
  // Elements marked by live DOM
  const markedHeadings = Array.from(root.querySelectorAll('[data-ps-heading]'));
  for (const el of markedHeadings) {
    const level = parseInt(el.getAttribute('data-ps-heading') || '0', 10);
    const text = el.textContent?.trim() || '';
    if (text && level === 2 && el.tagName !== 'H2') {
      const h2 = document.createElement('h2');
      h2.textContent = text.replace(/^\*\*|\*\*$/g, '').trim();
      el.replaceWith(h2);
    } else if (text && level === 3 && el.tagName !== 'H3') {
      const h3 = document.createElement('h3');
      h3.textContent = text.replace(/^\*\*|\*\*$/g, '').trim();
      el.replaceWith(h3);
    }
  }

  // Also scan all text blocks for heading semantic patterns
  const candidates = Array.from(
    root.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"]')
  );

  for (const el of candidates) {
    const htmlEl = el as HTMLElement;
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
 * Normalize Blockquote elements (<blockquote data-ps-quote="true">)
 */
function normalizeQuotes(root: HTMLElement): void {
  const markedQuotes = Array.from(root.querySelectorAll('[data-ps-quote]'));
  for (const el of markedQuotes) {
    if (!el.isConnected && !root.contains(el)) continue;
    if (el.parentElement?.closest('blockquote')) continue;
    if (el.tagName !== 'BLOCKQUOTE') {
      const bq = document.createElement('blockquote');
      bq.setAttribute('data-ps-quote', 'true');
      bq.innerHTML = el.innerHTML;
      el.replaceWith(bq);
    }
  }
}

/**
 * Smart detection of heading level based on text semantics
 */
export function detectHeadingLevel(text: string): number {
  const t = text.trim();
  if (!t) return 0;

  // Level 2: "一、原创推荐模块", "二、今日头条模块"
  if (/^[一二三四五六七八九十]+[、.]\s*[^。；;!！?？\n]{1,35}$/.test(t)) {
    return 2;
  }

  // Level 2 PRD Section Keywords ("需求背景", "原型附件", "需求详情", "附：...")
  if (/^(?:附[录件]?[:：]|需求背景|原型附件|需求详情|业务背景|前台功能清单|验收标准)[:：]?\s*[^。；;!！?？\n]{0,25}$/.test(t)) {
    return 2;
  }

  // Level 3: Emoji Callouts ("✅ 正常点", "❌ 问题", "✅ 现状", "🎯 期望改动", "📌 说明", "⚠️ 注意")
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
  // Pass 0: Handle sub-items marked by live DOM indentation
  const subItems = Array.from(root.querySelectorAll('[data-ps-subitem="true"]'));
  for (const item of subItems) {
    if (item.tagName !== 'LI' && !item.closest('li')) {
      const cleanText = item.textContent?.trim() || '';
      if (cleanText && !cleanText.startsWith('-') && !cleanText.startsWith('•') && !cleanText.startsWith('*')) {
        const p = document.createElement('p');
        p.textContent = `  - ${cleanText}`;
        item.replaceWith(p);
      }
    }
  }

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
      if (isSubList) {
        li.setAttribute('data-sublist', 'true');
      }

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
  res = res.replace(
    /\n(?:\*\*\s*)?([一二三四五六七八九十]+[、.][^\n。；;!！]{1,35})(?:\s*\*\*)?\n/g,
    (match, title) => {
      return `\n\n## ${title.trim()}\n\n`;
    }
  );

  // Level 3 Callout Headings: "### ✅ 正常点", "### ❌ 问题", etc.
  res = res.replace(
    /\n(?:\*\*\s*)?([✅✔️☑️🎯❌⚡️💡📌⚠️🔍🚀🔥🌟⭐️✨❓🚩🏷️][^\n]+?)(?:\s*\*\*)?\n/gu,
    (match, title) => {
      const clean = title.replace(/^\*\*|\*\*$/g, '').trim();
      return `\n\n### ${clean}\n\n`;
    }
  );

  // Subsections: "4.1、预览场景", "4.2、投稿详情场景", "4.3、列表行交互优化："
  res = res.replace(
    /\n\s*(?:\*\*\s*)?([1-9]\.[1-9]\d?[.、:][^\n]+?)(?:\s*\*\*)?\n/g,
    (match, title) => {
      const clean = title.replace(/^\*\*|\*\*$/g, '').trim();
      return `\n\n### ${clean}\n\n`;
    }
  );

  // 4. Merge split list numbers: "1.\n\n预览效果弹窗" -> "1. 预览效果弹窗"
  res = res.replace(/\n([0-9]+|[a-zA-Z])\.\s*\n\s*\n([^\n]+)/g, '\n$1. $2');

  // 5. Indent sub-lists ("a.", "b.") under parent ordered lists while preserving lettering
  res = res.replace(/\n([a-zA-Z])\.\s+([^\n]+)/g, '\n    $1. $2');

  // 5.1 Normalize Chinese quote marks: "》 提示" -> "> 提示"
  res = res.replace(/^[ \t]*》[ \t]*/gm, '> ');
  res = res.replace(/^>[ \t]+$/gm, '>');

  // 6. Ensure bold on key labels before colon in list items (including within quotes):
  // "1. 预览逻辑：..." -> "1. **预览逻辑**：..."
  res = res.replace(
    /^(\s*(?:(?:>\s*)*)(?:\d+\.|[a-zA-Z]\.|-|\*)\s+)(?!\*\*)([^\n：:]{2,25})([：:])(?!\*\*)/gm,
    (match, prefix, label, colon) => {
      if (/https?|www|\[|\]|\(|\)/i.test(label)) return match;
      return `${prefix}**${label.trim()}**${colon}`;
    }
  );

  // 7. Fix bold format with colon: "**预览效果弹窗** ：" -> "**预览效果弹窗**："
  res = res.replace(/\*\*\s+：/g, '**：');

  // 8. Clean up excessive consecutive blank lines (more than 2 -> 2)
  res = res.replace(/\n{3,}/g, '\n\n');

  return res.trim();
}
