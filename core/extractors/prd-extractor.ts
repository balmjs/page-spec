import { Readability } from '@mozilla/readability';
import { createTurndownService, generateYamlFrontmatter } from '../markdown/turndown-rules';
import {
  markLiveDomForSmartpage,
  preprocessSmartpageDom,
  postprocessMarkdown,
} from './smartpage-dom-preprocessor';
import {
  sanitizeFilename,
  resolveImageSource,
  extractBackgroundImageUrl,
  isSignificantVisualElement,
  canvasToBlob,
  svgToBlob,
  cleanNoiseElements,
  asyncPool,
  getExtensionFromMimeOrUrl,
  base64ToUint8Array,
} from '../../utils/dom-helpers';

import type { BundleAsset } from '../bundler/zip-builder';

export interface ExtractedAssetMeta {
  filename: string;
  originalUrl: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface PrdExtractionResult {
  title: string;
  sanitizedTitle: string;
  markdown: string;
  assets: BundleAsset[];
  assetMetadata: ExtractedAssetMeta[];
  warnings: string[];
}

/**
 * Known container selectors for popular documentation platforms.
 */
const PLATFORM_SELECTORS = [
  // Tencent Docs / SmartPage / BlankPage
  '#pages',
  '.blankpage-editor',
  '.smartpage-editor',
  '[class*="blankpage-"]',
  '[class*="smartpage-"]',
  '.dui-editor',
  '#weworkContainer #pages',
  // Feishu / Lark
  '.docx-page',
  '.bear-web-document',
  '.suite-cloud-document',
  '.wiki-content-wrapper',
  '.lark-editor-content',
  // Confluence
  '#main-content',
  '.wiki-content',
  '[data-testid="page-content"]',
  '#content .content-inner',
  // Yuque
  '.ne-viewer-body',
  '.lake-content',
  '#article-body',
  // Notion
  '.notion-page-content',
  'main.notion-frame',
  // Axure RP HTML exports
  '#base',
  '.ax_default',
  '#u0',
  '#mainFrame',
  // Generic standard containers
  'article',
  '[role="main"]',
  'main',
  '#main',
  '#content',
  '.post-content',
  '.markdown-body',
];

/**
 * Locate the primary content container on the page.
 */
export function findDocumentContainer(doc: Document = document): Element | null {
  // If Tencent Docs (doc.weixin.qq.com / page.weixin.qq.com), prioritize full document container
  if (isTencentDoc()) {
    const tencentContainer =
      doc.querySelector('#pages') ||
      doc.querySelector('.blankpage-editor') ||
      doc.querySelector('.smartpage-editor') ||
      doc.querySelector('[class*="blankpage-"]') ||
      doc.querySelector('[class*="smartpage-"]') ||
      doc.querySelector('.dui-editor') ||
      doc.querySelector('#weworkContainer');
    if (tencentContainer && (tencentContainer.textContent?.trim().length || 0) > 30) {
      return tencentContainer;
    }
  }

  for (const selector of PLATFORM_SELECTORS) {
    try {
      const el = doc.querySelector(selector);
      if (el && (el.textContent?.trim().length || 0) > 40) {
        return el;
      }
    } catch {
      // ignore selector errors
    }
  }

  // Fallback to Readability
  try {
    const cloneDoc = doc.cloneNode(true) as Document;
    const reader = new Readability(cloneDoc);
    const parsed = reader.parse();
    if (parsed && parsed.content) {
      const div = document.createElement('div');
      div.innerHTML = parsed.content;
      return div;
    }
  } catch {
    // Readability failed, fallback to body
  }

  return doc.body;
}

import { isTencentDoc, extractTencentDocBundle } from './tencent-doc-extractor';

/**
 * Extract authenticated PRD content, rewrite assets locally, and bundle into Markdown.
 */
export async function extractPrdBundle(
  onProgress?: (current: number, total: number, message: string) => void,
  engineMode: 'auto' | 'tencent' | 'dom' = 'auto'
): Promise<PrdExtractionResult> {
  // 0. Dedicated native extractor for Tencent Docs (doc.weixin.qq.com / docs.qq.com / page.weixin.qq.com)
  const shouldUseTencent =
    engineMode === 'tencent' || (engineMode === 'auto' && isTencentDoc());

  if (shouldUseTencent) {
    try {
      return await extractTencentDocBundle(onProgress);
    } catch (err: any) {
      if (engineMode === 'tencent') {
        throw err;
      }
      console.warn('[PageSpec] 腾讯文档专用提取失败，降级为通用 DOM 提取:', err);
    }
  }

  let rawTitle = document.title?.trim() || '';
  if (!rawTitle || rawTitle === 'Untitled' || rawTitle === 'Page 1') {
    const heading = document.querySelector('h1, h2')?.textContent?.trim();
    if (heading && heading.length < 60) {
      rawTitle = heading;
    } else {
      try {
        if (window.top && window.top.document.title?.trim()) {
          rawTitle = window.top.document.title.trim();
        }
      } catch {
        // ignore cross-origin top access restriction
      }
    }
  }
  if (!rawTitle) {
    rawTitle = 'Requirement_Document';
  }
  const cleanTitle = sanitizeFilename(rawTitle, 'PRD');
  const sourceUrl = window.location.href;
  const warnings: string[] = [];

  onProgress?.(0, 100, '正在定位主文档内容区...');

  const container = findDocumentContainer(document);
  if (!container) {
    throw new Error('未能从当前页面定位到有效的内容区域');
  }

  // 1. Detect prominent in-document title in container (often more descriptive than HTML <title>)
  const docTitleEl = container.querySelector(
    'h1, [class*="title-content"], [class*="pad-title"], [class*="blankpage-title"], [class*="header-title"]'
  );
  if (docTitleEl && docTitleEl.textContent?.trim()) {
    const candidateTitle = docTitleEl.textContent.trim();
    if (candidateTitle.length >= 3 && candidateTitle.length <= 150) {
      rawTitle = candidateTitle;
    }
  }

  // 2. Mark live DOM with computed styles (bold, headings, video attachments, visual dimensions) before cloning
  const { cleanup, canvasMap } = markLiveDomForSmartpage(container);
  const cloned = container.cloneNode(true) as HTMLElement;
  cleanup();

  cleanNoiseElements(cloned, isTencentDoc());
  preprocessSmartpageDom(cloned);

  onProgress?.(10, 100, '正在识别原型图与多媒体资源...');

  // Support background-image prototypes on SmartPage blocks
  const bgElements = Array.from(cloned.querySelectorAll('[style*="background-image"], [style*="background:"]'));
  for (const bgEl of bgElements) {
    if (bgEl.querySelector('img, canvas, svg')) continue;
    const bgUrl = extractBackgroundImageUrl(bgEl);
    if (bgUrl && !/\.(?:mp4|mov|webm|avi)/i.test(bgUrl)) {
      const img = document.createElement('img');
      img.setAttribute('src', bgUrl);
      img.setAttribute('alt', (bgEl as HTMLElement).title || bgEl.getAttribute('aria-label') || '原型图');
      bgEl.replaceWith(img);
    }
  }

  // Support <video poster="..."> video previews
  const videoElements = Array.from(cloned.querySelectorAll('video[poster]'));
  for (const v of videoElements) {
    const poster = v.getAttribute('poster');
    if (poster && !/\.(?:mp4|mov|webm|avi)/i.test(poster)) {
      const img = document.createElement('img');
      img.setAttribute('src', poster);
      img.setAttribute('alt', v.getAttribute('title') || '视频演示');
      v.replaceWith(img);
    }
  }

  // 1. Gather all candidates in strict DOM tree order
  const mediaElements = Array.from(cloned.querySelectorAll('img, canvas, svg'));

  interface TargetItem {
    element: Element;
    type: 'img' | 'canvas' | 'svg';
    srcUrl?: string;
  }

  const targets: TargetItem[] = [];

  for (const el of mediaElements) {
    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement;
      if (!isSignificantVisualElement(img)) {
        img.remove();
        continue;
      }
      const realSrc = img.getAttribute('data-ps-resolved-src') || resolveImageSource(img);
      // Skip only if the resolved source is directly an actual raw video stream file
      if (realSrc && /\.(?:mp4|mov|webm|avi)(?:\?.*)?$/i.test(realSrc)) {
        continue;
      }
      if (realSrc) {
        targets.push({ element: img, type: 'img', srcUrl: realSrc });
      }
    } else if (el.tagName === 'CANVAS') {
      const canvas = el as HTMLCanvasElement;
      if (!isSignificantVisualElement(canvas)) {
        canvas.remove();
        continue;
      }
      targets.push({ element: canvas, type: 'canvas' });
    } else if (el.tagName.toLowerCase() === 'svg') {
      const svg = el as unknown as SVGSVGElement;
      if (svg.parentElement?.closest('svg')) continue;
      if (!isSignificantVisualElement(svg)) {
        svg.remove();
        continue;
      }
      targets.push({ element: svg, type: 'svg' });
    }
  }

  const totalAssets = targets.length;
  onProgress?.(20, 100, `发现 ${totalAssets} 个重要视觉资产，开始并发抓取与本地化...`);

  const assets: BundleAsset[] = [];
  const assetMetadata: ExtractedAssetMeta[] = [];
  const urlToLocalMap = new Map<string, string>();

  // 2. Fetch and process assets with concurrency limit 5
  await asyncPool(5, targets, async (target, index) => {
    try {
      if (target.type === 'img' && target.srcUrl) {
        const src = target.srcUrl;
        if (urlToLocalMap.has(src)) {
          // Already downloaded, just rewrite
          const localPath = urlToLocalMap.get(src)!;
          (target.element as HTMLImageElement).setAttribute('src', localPath);
          return;
        }

        let buffer: ArrayBuffer | null = null;
        let mime = '';

        if (src.startsWith('data:')) {
          // Convert data URL
          const res = await fetch(src);
          const blob = await res.blob();
          mime = blob.type;
          buffer = await blob.arrayBuffer();
        } else {
          try {
            let resp: Response;
            try {
              resp = await fetch(src);
            } catch {
              resp = await fetch(src, { credentials: 'include' });
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            mime = resp.headers.get('content-type') || blob.type || 'image/png';
            buffer = await blob.arrayBuffer();
          } catch (fetchErr) {
            // Background script proxy fetch to bypass webpage CORS (e.g. for wdcdn.qpic.cn)
            try {
              const bgRes: any = await browser.runtime.sendMessage({
                type: 'FETCH_IMAGE_DATA',
                url: src,
              });
              if (bgRes && bgRes.ok) {
                mime = bgRes.mime || 'image/png';
                if (bgRes.base64) {
                  buffer = base64ToUint8Array(bgRes.base64).buffer as ArrayBuffer;
                } else if (Array.isArray(bgRes.data)) {
                  buffer = new Uint8Array(bgRes.data).buffer as ArrayBuffer;
                } else {
                  throw fetchErr;
                }
              } else {
                throw fetchErr;
              }
            } catch {
              throw fetchErr;
            }
          }
        }

        if (!buffer) throw new Error('未能获取有效图片二进制数据');

        const ext = getExtensionFromMimeOrUrl(mime, src);
        const assetNum = index + 1;
        const filename = `assets/${cleanTitle}/prototype-${String(assetNum).padStart(3, '0')}.${ext}`;
        const localPath = `./${filename}`;

        assets.push({
          filename,
          data: new Uint8Array(buffer),
        });

        urlToLocalMap.set(src, localPath);
        (target.element as HTMLImageElement).setAttribute('src', localPath);

        const imgEl = target.element as HTMLImageElement;
        assetMetadata.push({
          filename,
          originalUrl: src,
          width: imgEl.naturalWidth || imgEl.width,
          height: imgEl.naturalHeight || imgEl.height,
          alt: imgEl.alt,
        });
      } else if (target.type === 'canvas') {
        const clonedCanvas = target.element as HTMLCanvasElement;
        const canvasId = clonedCanvas.getAttribute('data-ps-canvas-id');
        const liveCanvas = (canvasId && canvasMap.get(canvasId)) || clonedCanvas;
        const blob = await canvasToBlob(liveCanvas);
        if (blob) {
          const assetNum = index + 1;
          const filename = `assets/${cleanTitle}/prototype-${String(assetNum).padStart(3, '0')}.png`;
          const localPath = `./${filename}`;
          const buffer = await blob.arrayBuffer();
          assets.push({
            filename,
            data: new Uint8Array(buffer),
          });

          // Replace canvas in cloned DOM with img tag
          const img = document.createElement('img');
          img.setAttribute('src', localPath);
          img.setAttribute('alt', `Canvas Prototype ${assetNum}`);
          target.element.replaceWith(img);

          assetMetadata.push({
            filename,
            originalUrl: '[inline-canvas]',
            width: liveCanvas.width || clonedCanvas.width,
            height: liveCanvas.height || clonedCanvas.height,
          });
        }
      } else if (target.type === 'svg') {
        const svg = target.element as SVGSVGElement;
        const blob = svgToBlob(svg);
        const assetNum = index + 1;
        const filename = `assets/${cleanTitle}/prototype-${String(assetNum).padStart(3, '0')}.svg`;
        const localPath = `./${filename}`;
        const buffer = await blob.arrayBuffer();
        assets.push({
          filename,
          data: new Uint8Array(buffer),
        });

        // Replace SVG in cloned DOM with img tag
        const img = document.createElement('img');
        img.setAttribute('src', localPath);
        img.setAttribute('alt', `Vector Diagram ${assetNum}`);
        target.element.replaceWith(img);

        assetMetadata.push({
          filename,
          originalUrl: '[inline-svg]',
        });
      }
    } catch (err: any) {
      const warn = `图片/资源抓取降级 [${target.srcUrl || target.type}]: ${err?.message || err}`;
      warnings.push(warn);
      // Keep original src if available so markdown still has the reference
      if (target.srcUrl && target.element instanceof HTMLImageElement) {
        target.element.setAttribute('src', target.srcUrl);
      }
    } finally {
      const currentDone = index + 1;
      const pct = 20 + Math.floor((currentDone / Math.max(1, totalAssets)) * 60);
      onProgress?.(pct, 100, `资源抓取进度: ${currentDone}/${totalAssets}...`);
    }
  });

  onProgress?.(85, 100, '正在将文档结构转换为 GFM Markdown...');

  // 3. Convert mutated DOM tree into GFM Markdown
  const turndown = createTurndownService();
  const rawMarkdown = turndown.turndown(cloned.innerHTML);
  const cleanMarkdown = postprocessMarkdown(rawMarkdown);

  // 4. Prepend Frontmatter
  const frontmatter = generateYamlFrontmatter({
    title: rawTitle,
    source_url: sourceUrl,
    extracted_at: new Date().toISOString(),
    asset_count: assets.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });

  const fullMarkdown = `${frontmatter}\n# ${rawTitle}\n\n${cleanMarkdown}\n`;

  onProgress?.(100, 100, 'PRD 提取与打包准备完成');

  return {
    title: rawTitle,
    sanitizedTitle: cleanTitle,
    markdown: fullMarkdown,
    assets,
    assetMetadata,
    warnings,
  };
}
