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
  isSignificantVisualElement,
  canvasToBlob,
  svgToBlob,
  cleanNoiseElements,
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

/**
 * Run a pool of async tasks with concurrency limit.
 */
async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Promise<any>[] = [];

  for (let i = 0; i < array.length; i++) {
    const item = array[i]!;
    const p = Promise.resolve().then(() => iteratorFn(item, i));
    ret.push(p);

    if (poolLimit <= array.length) {
      const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

/**
 * Deduce file extension from Content-Type header or URL.
 */
function getExtensionFromMimeOrUrl(mime: string | null, url: string): string {
  if (mime) {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('svg')) return 'svg';
    if (mime.includes('gif')) return 'gif';
  }
  const cleanUrl = url.split('?')[0]?.split('#')[0] || '';
  const match = cleanUrl.match(/\.(png|jpe?g|webp|svg|gif|bmp|avif)$/i);
  if (match && match[1]) {
    const ext = match[1].toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'png';
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

  // 2. Mark live DOM with computed styles (bold, headings, video attachments) before cloning
  const unmarkLive = markLiveDomForSmartpage(container);
  const cloned = container.cloneNode(true) as HTMLElement;
  unmarkLive();

  cleanNoiseElements(cloned, isTencentDoc());
  preprocessSmartpageDom(cloned);

  onProgress?.(10, 100, '正在识别原型图与多媒体资源...');

  // 1. Gather all candidates
  const images = Array.from(cloned.querySelectorAll('img'));
  const canvases = Array.from(cloned.querySelectorAll('canvas'));
  const svgs = Array.from(cloned.querySelectorAll('svg'));

  interface TargetItem {
    element: Element;
    type: 'img' | 'canvas' | 'svg';
    srcUrl?: string;
  }

  const targets: TargetItem[] = [];

  for (const img of images) {
    if (!isSignificantVisualElement(img)) {
      // Remove tiny icons/avatars to keep markdown clean
      img.remove();
      continue;
    }
    const alt = img.getAttribute('alt') || '';
    const src = img.getAttribute('src') || '';
    // Skip video attachments so they are not downloaded as fake prototypes
    if (
      img.hasAttribute('data-ps-video') ||
      /\.(?:mp4|mov|webm|avi)(?:\?.*)?$/i.test(alt) ||
      /\.(?:mp4|mov|webm|avi)(?:\?.*)?$/i.test(src)
    ) {
      continue;
    }

    const realSrc = resolveImageSource(img);
    if (realSrc) {
      targets.push({ element: img, type: 'img', srcUrl: realSrc });
    }
  }

  for (const canvas of canvases) {
    if (!isSignificantVisualElement(canvas)) {
      canvas.remove();
      continue;
    }
    targets.push({ element: canvas, type: 'canvas' });
  }

  for (const svg of svgs) {
    if (!isSignificantVisualElement(svg)) {
      // Remove tiny decorative svgs
      svg.remove();
      continue;
    }
    targets.push({ element: svg, type: 'svg' });
  }

  const totalAssets = targets.length;
  onProgress?.(20, 100, `发现 ${totalAssets} 个重要视觉资产，开始并发抓取与本地化...`);

  const assets: BundleAsset[] = [];
  const assetMetadata: ExtractedAssetMeta[] = [];
  const urlToLocalMap = new Map<string, string>();
  let assetCounter = 0;

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
              if (bgRes && bgRes.ok && Array.isArray(bgRes.data)) {
                mime = bgRes.mime || 'image/png';
                buffer = new Uint8Array(bgRes.data).buffer;
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
        assetCounter++;
        const filename = `assets/prototype-${String(assetCounter).padStart(3, '0')}.${ext}`;
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
        const canvas = target.element as HTMLCanvasElement;
        const blob = await canvasToBlob(canvas);
        if (blob) {
          assetCounter++;
          const filename = `assets/prototype-${String(assetCounter).padStart(3, '0')}.png`;
          const localPath = `./${filename}`;
          const buffer = await blob.arrayBuffer();
          assets.push({
            filename,
            data: new Uint8Array(buffer),
          });

          // Replace canvas in cloned DOM with img tag
          const img = document.createElement('img');
          img.setAttribute('src', localPath);
          img.setAttribute('alt', `Canvas Prototype ${assetCounter}`);
          target.element.replaceWith(img);

          assetMetadata.push({
            filename,
            originalUrl: '[inline-canvas]',
            width: canvas.width,
            height: canvas.height,
          });
        }
      } else if (target.type === 'svg') {
        const svg = target.element as SVGSVGElement;
        const blob = svgToBlob(svg);
        assetCounter++;
        const filename = `assets/prototype-${String(assetCounter).padStart(3, '0')}.svg`;
        const localPath = `./${filename}`;
        const buffer = await blob.arrayBuffer();
        assets.push({
          filename,
          data: new Uint8Array(buffer),
        });

        // Replace SVG in cloned DOM with img tag
        const img = document.createElement('img');
        img.setAttribute('src', localPath);
        img.setAttribute('alt', `Vector Diagram ${assetCounter}`);
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
      const pct = 20 + Math.floor((currentDone / totalAssets) * 60);
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
