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
  { selector: '.docx-page, .bear-web-document, .suite-cloud-document, .lark-editor-content', name: 'Feishu/Lark Doc', bonus: 3000 },
  // Confluence
  { selector: '#main-content, .wiki-content, [data-testid="page-content"]', name: 'Confluence', bonus: 3000 },
  // Yuque
  { selector: '.ne-viewer-body, .lake-content, #article-body', name: 'Yuque', bonus: 3000 },
  // Notion
  { selector: '.notion-page-content, main.notion-frame', name: 'Notion', bonus: 3000 },
  // Axure RP HTML exports
  { selector: '#base, #mainFrame, .ax_default, [class*="ax_default"]', name: 'Axure', bonus: 3500 },
  // Generic standard containers
  { selector: 'article, [role="main"], main, #main, #content, .post-content, .markdown-body', name: 'Standard Doc', bonus: 500 },
];

import { isTencentDoc } from './tencent-doc-extractor';

export function evaluateCurrentFrameContent(): FrameContentScore {
  const isTopFrame = window === window.top;
  const url = window.location.href;
  let rawTitle = document.title?.trim() || '';

  // 0. Directly identify Tencent Docs / WeChat Docs
  if (isTencentDoc(url)) {
    const hasDocEditor = Boolean(
      document.querySelector('#pages, .blankpage-editor, .smartpage-editor, .dui-editor, #weworkContainer, canvas')
    );
    const urlHasDocId = /[?&](?:id|p)=[^&]+/.test(url) || /\/(?:doc|page|sheet|slide)\/[a-zA-Z0-9_-]+/.test(url);
    const score = (isTopFrame ? 5000 : 3000) + (hasDocEditor ? 4000 : 0) + (urlHasDocId ? 999 : 0);
    return {
      score,
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
      if (found && (item.name === 'Axure' || (found.textContent?.trim().length || 0) > 30)) {
        platformBadge = item.name;
        containerBonus = item.bonus;
        break;
      }
    } catch {
      // ignore selector errors
    }
  }

  // Additional Axure heuristics (URL, globals, widgets)
  const isAxure =
    platformBadge === 'Axure' ||
    Boolean(
      document.querySelector('#base, #mainFrame, .ax_default, [class*="ax_default"]') ||
        url.includes('axure') ||
        typeof (window as any).$axure !== 'undefined'
    );

  if (isAxure) {
    platformBadge = 'Axure';
    containerBonus = Math.max(containerBonus, 3500);

    // Axure specific title detection
    if (!rawTitle || rawTitle === 'Untitled' || rawTitle === 'Page 1' || rawTitle === 'Axure RP Page') {
      try {
        const axPageName = (window as any).$axure?.page?.pageName || (window as any).DATA?.pageName;
        if (typeof axPageName === 'string' && axPageName.trim()) {
          rawTitle = axPageName.trim();
        }
      } catch {}

      if (!rawTitle || rawTitle === 'Untitled' || rawTitle === 'Page 1' || rawTitle === 'Axure RP Page') {
        const axHeading = document.querySelector(
          '.ax_default[class*="heading"], [class*="heading_1"], [class*="heading_2"], [data-label]'
        );
        if (axHeading && axHeading.textContent?.trim()) {
          rawTitle = axHeading.textContent.trim();
        }
      }
    }
  }

  // Pure shell penalty: if body contains iframes or is a known workbench shell like Lanhu
  const childIframes = Array.from(document.querySelectorAll('iframe'));
  const hasSubstantialChildIframe = childIframes.some((ifr) => {
    try {
      const rect = ifr.getBoundingClientRect();
      return rect.width >= 350 && rect.height >= 250;
    } catch {
      return false;
    }
  });

  const isLanhuShell = isTopFrame && (url.includes('lanhuapp.com') || url.includes('mastergo.com') || url.includes('modao.cc'));
  const isWrapperShell = (childIframes.length > 0 && wordCount < 300) || hasSubstantialChildIframe || isLanhuShell;

  // Sniff active menu in Lanhu top window to give meaningful title to the shell
  if (isLanhuShell) {
    try {
      const activeMenuItem = document.querySelector(
        '[class*="tree"] [class*="active"], [class*="menu"] [class*="active"], [class*="item"][class*="active"], [class*="selected"], [class*="current"]'
      );
      if (activeMenuItem && activeMenuItem.textContent?.trim()) {
        const menuText = activeMenuItem.textContent.trim().split('\n')[0]?.trim();
        if (menuText && menuText.length < 50) {
          rawTitle = `${menuText} (蓝湖外壳)`;
        }
      }
    } catch {}
  }

  let baseScore = wordCount * 0.4 + headingsCount * 20 + imageCount * 30 + containerBonus;

  if (isLanhuShell) {
    baseScore = 30; // Lanhu outer shell is strictly an auxiliary container, never the PRD body
  } else if (isWrapperShell) {
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
