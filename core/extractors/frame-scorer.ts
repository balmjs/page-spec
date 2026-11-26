/**
 * Evaluates the content density, PRD/prototype characteristics, and platform identity
 * of a document/iframe context (v1.3 multi-platform edition).
 */

import { isTencentDoc } from './tencent-doc-extractor';
import { detectPrototypePrdPlatform, type PrototypePlatform } from './prototype-prd-extractor';
import { detectDesignPlatform, type DesignPlatform } from './design-extractor';
import { cleanPlatformTitleSuffix } from '../../utils/dom-helpers';

export interface FrameContentScore {
  score: number;
  wordCount: number;
  imageCount: number;
  headingsCount: number;
  title: string;
  url: string;
  isTopFrame: boolean;
  platformBadge?: string;
  isPrototypeShell?: boolean;
  isPrototypeCanvas?: boolean;
  prototypePlatform?: PrototypePlatform;
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
  { selector: '#base, .ax_default, [class*="ax_default"]', name: 'Axure', bonus: 3500 },
  // Generic standard containers
  { selector: 'article, [role="main"], main, #main, #content, .post-content, .markdown-body', name: 'Standard Doc', bonus: 500 },
];

const PROTOTYPE_PLATFORM_LABELS: Record<PrototypePlatform, string> = {
  'axure-cloud': 'Axure Cloud',
  'axure-local': 'Axure RP',
  modao: '墨刀 (Modao)',
  pixso: 'Pixso',
  'mockplus-rp': 'Mockplus RP',
};

const DESIGN_PLATFORM_LABELS: Partial<Record<DesignPlatform, string>> = {
  figma: 'Figma',
  zeplin: 'Zeplin',
  sketch: 'Sketch',
  lanhu: '蓝湖 (Lanhu)',
  mockplus: 'Mockplus',
  mastergo: 'MasterGo',
  pixso: 'Pixso',
  modao: '墨刀 (Modao)',
  axure: 'Axure',
};

export function evaluateCurrentFrameContent(): FrameContentScore {
  const isTopFrame = window === window.top;
  const url = window.location.href;
  let rawTitle = cleanPlatformTitleSuffix(document.title?.trim() || '');

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

  // Child iframe detection (for host shells vs inner content frames)
  const childIframes = Array.from(document.querySelectorAll('iframe'));
  const hasSubstantialChildIframe = childIframes.some((ifr) => {
    try {
      const rect = ifr.getBoundingClientRect();
      return rect.width >= 350 && rect.height >= 250;
    } catch {
      return false;
    }
  });

  // Prototype platform detection (Axure Cloud, *.axshare.com, Axure local, Modao, Pixso, Mockplus RP)
  const prototypePlatform = detectPrototypePrdPlatform(url);
  const designPlatform = detectDesignPlatform(url);

  const hasAxureInnerCanvas = Boolean(
    document.querySelector('#base, .ax_default, [class*="ax_default"]') || typeof (window as any).$axure !== 'undefined'
  );
  const hasAxureOuterFrame = Boolean(document.querySelector('#mainFrame, #sitemapHost, #interfaceControlFrame'));

  let isPrototypeShell = false;
  let isPrototypeCanvas = false;

  if (prototypePlatform) {
    platformBadge = PROTOTYPE_PLATFORM_LABELS[prototypePlatform];

    if (isTopFrame && (hasSubstantialChildIframe || hasAxureOuterFrame)) {
      // Outer prototype host shell (holds Page Notes, sitemap tree, comments, and hosts inner iframe)
      isPrototypeShell = true;
    } else if (
      hasAxureInnerCanvas ||
      !isTopFrame ||
      Boolean(document.querySelector('canvas, [class*="prototype"], [class*="stage"], [class*="artboard"]'))
    ) {
      isPrototypeCanvas = true;
      containerBonus = Math.max(containerBonus, 4000);
    }

    // Refine Axure title when HTML <title> is placeholder
    if (!rawTitle || /^(?:Untitled|Page\s*1|Axure\s*RP\s*Page)$/i.test(rawTitle)) {
      try {
        const axPageName = (window as any).$axure?.page?.pageName || (window as any).DATA?.pageName;
        if (typeof axPageName === 'string' && axPageName.trim()) {
          rawTitle = axPageName.trim();
        }
      } catch {
        // ignore
      }
      if (!rawTitle || /^(?:Untitled|Page\s*1|Axure\s*RP\s*Page)$/i.test(rawTitle)) {
        const axHeading = document.querySelector(
          '.ax_default[class*="heading"], [class*="heading_1"], [class*="heading_2"], [data-label]'
        );
        if (axHeading && axHeading.textContent?.trim()) {
          rawTitle = axHeading.textContent.trim();
        }
      }
    }
  }

  // Design host shell detection (only when hosting a substantial embedded prototype iframe, e.g. Axure inside Lanhu)
  const isPureDesignHost =
    isTopFrame &&
    !prototypePlatform &&
    designPlatform !== 'generic-design';
  const isDesignWrapperShell = isPureDesignHost && hasSubstantialChildIframe;
  const isWrapperShell =
    (childIframes.length > 0 && wordCount < 300) ||
    hasSubstantialChildIframe ||
    isDesignWrapperShell ||
    isPrototypeShell;

  if (isPureDesignHost || isPrototypeShell) {
    if (!platformBadge && designPlatform !== 'generic-design') {
      platformBadge = DESIGN_PLATFORM_LABELS[designPlatform];
    }
    try {
      const activeMenuItem = document.querySelector(
        '#sitemapTreeContainer .sitemapHighlight, [class*="tree"] [class*="active"], [class*="menu"] [class*="active"], [class*="item"][class*="active"], [class*="selected"], [class*="current"]'
      );
      if (activeMenuItem && activeMenuItem.textContent?.trim()) {
        const menuText = activeMenuItem.textContent.trim().split('\n')[0]?.trim();
        if (menuText && menuText.length < 50) {
          rawTitle = isDesignWrapperShell
            ? `${menuText} (${platformBadge || 'Design'} 外壳)`
            : isPrototypeShell
              ? `${menuText} (${platformBadge || 'Prototype'} Shell)`
              : menuText;
        }
      }
    } catch {
      // ignore
    }
  }

  let baseScore = wordCount * 0.4 + headingsCount * 20 + imageCount * 30 + containerBonus;

  if (isDesignWrapperShell) {
    baseScore = 30;
  } else if (isPrototypeShell) {
    // Keep outer prototype shell lower than the inner prototype canvas so inner frame wins as primary target,
    // while retaining shell flag so Page Notes & sitemap are harvested automatically during extraction!
    baseScore = Math.min(250, Math.max(80, Math.round(baseScore * 0.15)));
  } else if (isWrapperShell) {
    baseScore *= 0.1;
  } else if (linkRatio > 0.6 && wordCount < 500 && !isPrototypeCanvas) {
    baseScore *= 0.2;
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
    isPrototypeShell: isPrototypeShell || undefined,
    isPrototypeCanvas: isPrototypeCanvas || undefined,
    prototypePlatform: prototypePlatform || undefined,
  };
}
