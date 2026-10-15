/**
 * Evaluates the content density and PRD characteristics of a document/iframe context.
 */

export interface FrameContentScore {
  score: number;
  wordCount: number;
  imageCount: number;
  headingsCount: number;
  title: string;
  url: string;
  isTopFrame: boolean;
  platformBadge?: string;
}

const DOCUMENT_CONTAINER_SELECTORS = [
  // Feishu / Lark
  { selector: '.docx-page, .bear-web-document, .suite-cloud-document, .lark-editor-content', name: 'Feishu/Lark Doc' },
  // Confluence
  { selector: '#main-content, .wiki-content, [data-testid="page-content"]', name: 'Confluence' },
  // Yuque
  { selector: '.ne-viewer-body, .lake-content, #article-body', name: 'Yuque' },
  // Notion
  { selector: '.notion-page-content, main.notion-frame', name: 'Notion' },
  // Axure RP HTML
  { selector: '#base, #mainFrame, .ax_default', name: 'Axure' },
  // Generic standard containers
  { selector: 'article, [role="main"], main, #main, #content, .post-content, .markdown-body', name: 'Standard Doc' },
];

import { isTencentDoc } from './tencent-doc-extractor';

export function evaluateCurrentFrameContent(): FrameContentScore {
  const isTopFrame = window === window.top;
  const url = window.location.href;
  const rawTitle = document.title?.trim() || '';

  // 0. Directly identify Tencent Docs / WeChat Docs
  if (isTencentDoc(url)) {
    return {
      score: 9999,
      wordCount: 1500,
      imageCount: 1,
      headingsCount: 1,
      title: rawTitle || '腾讯文档',
      url,
      isTopFrame,
      platformBadge: '腾讯文档 (Canvas/API)',
    };
  }

  // Get raw body text
  const bodyText = document.body ? (document.body.innerText || document.body.textContent || '').trim() : '';
  const wordCount = bodyText.length;

  // Headings
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const headingsCount = headings.length;

  // Visual assets
  const images = Array.from(document.querySelectorAll('img, canvas, svg')).filter((el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width >= 32 && rect.height >= 32;
    } catch {
      return false;
    }
  });
  const imageCount = images.length;

  // Navigation / Menu penalty (high link density)
  const links = document.querySelectorAll('a');
  const linkCount = links.length;
  const linkRatio = wordCount > 0 ? (linkCount * 25) / wordCount : 1;

  // Detect platform-specific document container
  let platformBadge: string | undefined;
  let containerBonus = 0;

  for (const item of DOCUMENT_CONTAINER_SELECTORS) {
    try {
      const found = document.querySelector(item.selector);
      if (found && (found.textContent?.trim().length || 0) > 30) {
        platformBadge = item.name;
        containerBonus = 200;
        break;
      }
    } catch {
      // ignore selector errors
    }
  }

  // Pure shell penalty: if body contains iframes and very little text, it's just an outer wrapper
  const childIframes = document.querySelectorAll('iframe');
  const isWrapperShell = childIframes.length > 0 && wordCount < 300;

  let baseScore = wordCount * 0.4 + headingsCount * 20 + imageCount * 30 + containerBonus;

  if (isWrapperShell) {
    baseScore *= 0.1; // heavily penalize outer wrapper shells
  } else if (linkRatio > 0.6 && wordCount < 500) {
    baseScore *= 0.2; // penalize sidebar menus with mostly links
  }

  const finalScore = Math.max(0, Math.round(baseScore));

  return {
    score: finalScore,
    wordCount,
    imageCount,
    headingsCount,
    title: rawTitle || (headings[0]?.textContent?.trim() || 'Untitled PRD'),
    url,
    isTopFrame,
    platformBadge,
  };
}
