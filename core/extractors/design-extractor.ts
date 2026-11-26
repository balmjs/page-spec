/**
 * Multi-Platform Zero-Token Design Artboard & Asset Extractor (v1.3)
 * Covers Tier 1 DOM/CDN platforms (Lanhu, Mockplus, Zeplin, Sketch Web, Modao)
 * and Tier 2 WebGL/WASM canvas platforms (Figma, MasterGo, Pixso) plus Axure & web galleries.
 *
 * - Strips unsigned CDN resize parameters to recover full-resolution originals.
 * - Captures meaningful inline <svg> vector assets (>= 48x48, XSS-sanitized).
 * - Detects blank WebGL canvas frames (preserveDrawingBuffer: false) and falls back to
 *   activeTab region-cropped viewport capture cleanly excluding toolbars/sidebars.
 */

import { generateYamlFrontmatter } from '../markdown/turndown-rules';
import {
  sanitizeFilename,
  cleanPlatformTitleSuffix,
  resolveImageSource,
  extractBackgroundImageUrl,
  canvasToBlob,
  isImageBlobBlank,
  serializeSafeSvg,
  getElementCaptureRect,
  cropCapturedPngInDom,
  asyncPool,
  getExtensionFromMimeOrUrl,
  base64ToUint8Array,
} from '../../utils/dom-helpers';
import type { BundleAsset } from '../bundler/zip-builder';

export type DesignPlatform =
  | 'figma'
  | 'zeplin'
  | 'sketch'
  | 'lanhu'
  | 'mockplus'
  | 'mastergo'
  | 'pixso'
  | 'modao'
  | 'axure'
  | 'generic-design';

export type DesignAssetSourceType = 'img' | 'canvas' | 'bg' | 'svg';

export interface DesignArtboardSummary {
  id: string;
  name: string;
  sourceType: DesignAssetSourceType;
  previewUrl: string;
  highResUrl: string;
  width: number;
  height: number;
  annotations?: string[];
}

export interface DesignArtboardListResult {
  title: string;
  sanitizedTitle: string;
  platform: DesignPlatform;
  mode: 'multi-board' | 'single-detail';
  artboards: DesignArtboardSummary[];
  vectorCount: number;
  pageAnnotations: string[];
  colorTokens: string[];
  typographyTokens: string[];
}

export interface DesignExtractionResult {
  title: string;
  sanitizedTitle: string;
  platform: DesignPlatform;
  sourceType: 'design-spec';
  markdown: string;
  assets: BundleAsset[];
  artboardsCount: number;
  vectorCount: number;
  warnings: string[];
}

const WEBGL_CANVAS_PLATFORMS: ReadonlySet<DesignPlatform> = new Set(['figma', 'mastergo', 'pixso']);

/**
 * Identify the design platform from URL and optional DOM heuristics (pure & Node-testable).
 */
export function detectDesignPlatform(
  url = typeof window !== 'undefined' ? window.location.href : '',
  hasAxureDom?: boolean
): DesignPlatform {
  const lower = (url || '').toLowerCase();
  let hostname = '';
  try {
    hostname = new URL(lower).hostname;
  } catch {
    hostname = lower;
  }

  if (hostname === 'figma.com' || hostname.endsWith('.figma.com')) return 'figma';
  if (hostname === 'zeplin.io' || hostname.endsWith('.zeplin.io')) return 'zeplin';
  if (
    hostname === 'sketch.com' ||
    hostname.endsWith('.sketch.com') ||
    hostname === 'sketch.cloud' ||
    hostname.endsWith('.sketch.cloud')
  ) {
    return 'sketch';
  }
  if (hostname === 'lanhuapp.com' || hostname.endsWith('.lanhuapp.com') || /\blanhu\b/.test(hostname)) {
    return 'lanhu';
  }
  if (
    hostname === 'mockplus.cn' ||
    hostname.endsWith('.mockplus.cn') ||
    hostname === 'mockplus.com' ||
    hostname.endsWith('.mockplus.com')
  ) {
    return 'mockplus';
  }
  if (hostname === 'mastergo.com' || hostname.endsWith('.mastergo.com')) return 'mastergo';
  if (
    hostname === 'pixso.cn' ||
    hostname.endsWith('.pixso.cn') ||
    hostname === 'pixso.net' ||
    hostname.endsWith('.pixso.net')
  ) {
    return 'pixso';
  }
  if (
    hostname === 'modao.cc' ||
    hostname.endsWith('.modao.cc') ||
    hostname === 'mockingbot.com' ||
    hostname.endsWith('.mockingbot.com') ||
    hostname === 'mockingbot.cn' ||
    hostname.endsWith('.mockingbot.cn')
  ) {
    return 'modao';
  }
  if (
    hostname === 'axure.cloud' ||
    hostname.endsWith('.axure.cloud') ||
    hostname === 'axshare.com' ||
    hostname.endsWith('.axshare.com') ||
    /\baxure\b/.test(lower) ||
    (typeof hasAxureDom === 'boolean'
      ? hasAxureDom
      : typeof document !== 'undefined' && Boolean(document.querySelector('#base, .ax_default')))
  ) {
    return 'axure';
  }
  return 'generic-design';
}

const SIGNED_QUERY_KEYS = [
  'signature',
  'ossaccesskeyid',
  'x-amz-signature',
  'x-amz-credential',
  'x-goog-signature',
  'q-signature',
  'sign',
  'sig',
  'key-pair-id',
  'policy',
  'token',
];

const RESIZE_QUERY_KEY_RE =
  /^(?:x-oss-process|imageMogr2|imageView2|imageSlim|thumbnail|resize|w|width|h|height|fit|q|quality|auto|dpr|fm|format|scale|size)$/i;

/**
 * Strip unsigned thumbnail resize parameters (Aliyun OSS, Tencent COS, Qiniu, Imgix, CloudFront,
 * Zeplin, Sketch, Mockplus, Lanhu CDN) to recover full-resolution original design URLs.
 * Signed URLs are left intact to avoid invalidating HMAC signatures.
 */
export function restoreHighResDesignUrl(
  rawUrl: string,
  baseUrl = typeof window !== 'undefined' ? window.location.href : 'https://example.com/'
): string {
  if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl, baseUrl);

    const lowerKeys = new Set(Array.from(parsed.searchParams.keys()).map((k) => k.toLowerCase()));
    const hasSignature =
      SIGNED_QUERY_KEYS.some((k) => lowerKeys.has(k)) ||
      (lowerKeys.has('s') && (lowerKeys.has('e') || lowerKeys.has('exp') || lowerKeys.has('expires')));

    if (!hasSignature) {
      // Strip raw non-KV Qiniu / COS imageMogr2 / imageView2 query strings
      if (/^\?(?:imageMogr2|imageView2)\//i.test(parsed.search)) {
        parsed.search = '';
      } else {
        for (const key of Array.from(parsed.searchParams.keys())) {
          if (RESIZE_QUERY_KEY_RE.test(key)) {
            parsed.searchParams.delete(key);
          }
        }
      }

      // Lanhu / OSS exclamation or @ style thumbnail suffix in pathname (e.g. .png!small or .png@300w)
      parsed.pathname = parsed.pathname.replace(/(\.(?:png|jpe?g|webp))[@!][^/]+$/i, '$1');

      // Zeplin / Sketch / Mockplus preview thumbnail filename suffixes (e.g. home_thumb.png -> home.png)
      parsed.pathname = parsed.pathname.replace(
        /(?:[_.-](?:thumb|thumbnail|preview|small))(\.(?:png|jpe?g|webp))$/i,
        '$1'
      );
    }

    return parsed.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Infer a human-readable artboard or vector asset name from surrounding DOM labels.
 */
function inferArtboardName(el: Element, index: number, isVector = false): string {
  // 1. Direct element attributes
  const attrCandidates = [
    el.getAttribute('alt'),
    el.getAttribute('title'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-name'),
    el.getAttribute('data-title'),
    el.getAttribute('data-artboard-name'),
    el.getAttribute('data-layer-name'),
    isVector ? el.querySelector('title')?.textContent : null,
  ];
  for (const c of attrCandidates) {
    const text = c?.trim();
    if (text && text.length >= 2 && text.length <= 60 && !/^image$/i.test(text) && !/^https?:\/\//.test(text)) {
      return text;
    }
  }

  // 2. Artboard card container label
  const card = el.closest(
    '[class*="artboard"], [class*="board"], [class*="screen"], [class*="frame-card"], [class*="card"], [class*="item"], figure, li'
  );
  if (card) {
    const labelEl = card.querySelector(
      '[class*="title"], [class*="name"], [class*="label"], figcaption, h1, h2, h3, h4, .text'
    );
    const labelText = labelEl?.textContent?.trim().split('\n')[0]?.trim();
    if (labelText && labelText.length >= 1 && labelText.length <= 60) {
      return labelText;
    }
  }

  // 3. Active page / artboard breadcrumb in editor topbar or layer tree (Figma / MasterGo / Pixso / Zeplin / Sketch)
  const activeHeader = document.querySelector(
    '[class*="artboard-name"], [class*="screen-name"], [class*="page-name"], [class*="stage-title"], [data-testid="filename"], [class*="file-title"], [class*="breadcrumb"] [class*="active"], [class*="tree"] [class*="active"], [class*="layer"][class*="selected"]'
  );
  const headerText = cleanPlatformTitleSuffix(activeHeader?.textContent?.trim().split('\n')[0]?.trim() || '');
  if (headerText && headerText.length >= 1 && headerText.length <= 60) {
    return index === 0 ? headerText : `${headerText}-${index + 1}`;
  }

  const prefix = isVector ? 'Vector' : 'Artboard';
  return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Extract design annotations, CSS snippets, color tokens (#HEX / rgba), and typography tokens
 * from inspector sidebars across Figma Dev Mode, Zeplin, Sketch, Mockplus, MasterGo, Pixso, and Lanhu.
 */
function extractDesignAnnotationsAndTokens(): {
  annotations: string[];
  colorTokens: string[];
  typographyTokens: string[];
} {
  const annotations = new Set<string>();
  const colorTokens = new Set<string>();
  const typographyTokens = new Set<string>();

  const annotationSelectors = [
    '[class*="annotation"]',
    '[class*="comment-content"]',
    '[class*="comment-text"]',
    '[class*="comment-body"]',
    '[class*="mark-text"]',
    '[class*="note-content"]',
    '[class*="css-code"]',
    '[class*="style-code"]',
    '[class*="code-box"]',
    '[class*="code-snippet"]',
    '[class*="inspect-code"]',
    '[class*="dev-mode"] pre',
    '[class*="inspector"] pre',
    '[class*="inspector"] code',
    '[class*="snippet"]',
  ];

  const extractTokensFromText = (text: string) => {
    const hexMatches = text.match(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
    if (hexMatches) {
      hexMatches.forEach((c) => colorTokens.add(c.toUpperCase()));
    }
    const rgbaMatches = text.match(/rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)/gi);
    if (rgbaMatches) {
      rgbaMatches.forEach((c) => colorTokens.add(c.replace(/\s+/g, ' ')));
    }
    const fontMatches = text.match(/(?:font-family|font-size|line-height|font-weight)\s*:\s*[^;}\n]{1,60}/gi);
    if (fontMatches) {
      fontMatches.forEach((f) => typographyTokens.add(f.replace(/\s+/g, ' ').trim()));
    }
  };

  for (const sel of annotationSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && text.length <= 400) {
          annotations.add(text);
        }
        extractTokensFromText(text);
      });
    } catch {
      // ignore selector error
    }
  }

  // Dedicated color swatch & typography inspector elements
  try {
    document
      .querySelectorAll(
        '[class*="color-value"], [class*="hex"], [class*="swatch"], [class*="color-code"], [class*="token-value"], [class*="text-style"], [class*="font-info"]'
      )
      .forEach((el) => {
        const text = (el.textContent || '').trim();
        extractTokensFromText(text);
        if (/(?:\d+px\s*\/\s*\d+px|\b\d{2}px\b.*(?:Regular|Medium|Semibold|Bold))/i.test(text) && text.length <= 80) {
          typographyTokens.add(text.replace(/\s+/g, ' '));
        }
      });
  } catch {
    // ignore
  }

  return {
    annotations: Array.from(annotations).slice(0, 30),
    colorTokens: Array.from(colorTokens).slice(0, 24),
    typographyTokens: Array.from(typographyTokens).slice(0, 16),
  };
}

/**
 * Filter out UI chrome icons, user avatars, and tiny decorative images.
 */
function isDesignArtboardCandidate(el: Element, width: number, height: number, url?: string): boolean {
  if (width < 100 || height < 100) return false;
  const classAndSrc = `${(el as HTMLElement).className || ''} ${el.getAttribute('alt') || ''} ${url || ''}`.toLowerCase();
  if (
    classAndSrc.includes('avatar') ||
    classAndSrc.includes('emoji') ||
    classAndSrc.includes('favicon') ||
    classAndSrc.includes('qrcode') ||
    classAndSrc.includes('logo-icon') ||
    classAndSrc.includes('headimg')
  ) {
    return false;
  }
  return true;
}

/**
 * Check whether an inline <svg> is a meaningful standalone design/illustration/icon asset
 * (>= 48x48) rather than platform UI chrome (toolbar button, navbar icon, spinner).
 */
function isDesignSvgCandidate(svg: SVGSVGElement, width: number, height: number): boolean {
  if (width < 48 || height < 48) return false;
  if (svg.parentElement?.closest('svg')) return false;
  if (svg.closest('nav, header, footer, [role="toolbar"], [role="menubar"], [class*="toolbar"], [class*="menubar"], [class*="header-bar"], [class*="top-bar"], [class*="nav-bar"]')) {
    return false;
  }

  const classAttr = (svg.getAttribute('class') || '').toLowerCase();
  const idAttr = (svg.getAttribute('id') || '').toLowerCase();
  const combined = `${classAttr} ${idAttr}`;
  if (
    combined.includes('spinner') ||
    combined.includes('loading') ||
    combined.includes('avatar') ||
    combined.includes('cursor') ||
    combined.includes('toolbar-icon') ||
    combined.includes('ui-icon')
  ) {
    return false;
  }

  // Must contain actual vector primitives
  const hasShapes = Boolean(svg.querySelector('path, rect, circle, ellipse, polygon, polyline, line, text, image'));
  return hasShapes;
}

/**
 * Scan the current page and list selectable design artboards, WebGL canvases, and inline SVG vectors.
 */
export function listDesignArtboards(): DesignArtboardListResult {
  const platform = detectDesignPlatform();
  const rawTitle = cleanPlatformTitleSuffix(document.title || '') || 'Design_Spec';
  const cleanTitle = sanitizeFilename(rawTitle, 'Design_Spec');

  const artboards: DesignArtboardSummary[] = [];
  const seenUrls = new Set<string>();
  let idx = 0;

  // 1. Scan <img> elements
  const imgs = Array.from(document.querySelectorAll('img'));
  for (const img of imgs) {
    const rect = img.getBoundingClientRect();
    const w = Math.round(img.naturalWidth || rect.width);
    const h = Math.round(img.naturalHeight || rect.height);
    const resolved = resolveImageSource(img);
    if (!resolved) continue;
    if (!isDesignArtboardCandidate(img, w, h, resolved)) continue;

    const highRes = restoreHighResDesignUrl(resolved);
    if (seenUrls.has(highRes) || seenUrls.has(resolved)) continue;
    seenUrls.add(highRes);
    seenUrls.add(resolved);

    artboards.push({
      id: `design-img-${idx + 1}`,
      name: inferArtboardName(img, idx),
      sourceType: 'img',
      previewUrl: resolved,
      highResUrl: highRes,
      width: w,
      height: h,
    });
    idx++;
  }

  // 2. Scan background-image artboard cards (Lanhu / Mockplus / Modao / MasterGo / Zeplin thumbnails)
  const bgNodes = Array.from(
    document.querySelectorAll('[style*="background-image"], [style*="background:"]')
  );
  for (const node of bgNodes) {
    if (node.querySelector('img')) continue;
    const bgUrl = extractBackgroundImageUrl(node);
    if (!bgUrl) continue;
    const rect = node.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!isDesignArtboardCandidate(node, w, h, bgUrl)) continue;

    const highRes = restoreHighResDesignUrl(bgUrl);
    if (seenUrls.has(highRes) || seenUrls.has(bgUrl)) continue;
    seenUrls.add(highRes);
    seenUrls.add(bgUrl);

    artboards.push({
      id: `design-bg-${idx + 1}`,
      name: inferArtboardName(node, idx),
      sourceType: 'bg',
      previewUrl: bgUrl,
      highResUrl: highRes,
      width: w,
      height: h,
    });
    idx++;
  }

  // 3. Scan large <canvas> elements (Figma / MasterGo / Pixso / Lanhu WebGL or 2D stage)
  const canvases = Array.from(document.querySelectorAll('canvas'));
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(canvas.width || rect.width);
    const h = Math.round(canvas.height || rect.height);
    if (w < 240 || h < 180) continue;
    if (rect.width < 100 || rect.height < 100) continue;

    artboards.push({
      id: `design-canvas-${idx + 1}`,
      name: inferArtboardName(canvas, idx),
      sourceType: 'canvas',
      previewUrl: '',
      highResUrl: '',
      width: Math.round(rect.width || w),
      height: Math.round(rect.height || h),
    });
    idx++;
  }

  // 4. Scan meaningful standalone inline <svg> vector assets (>= 48x48, non-chrome)
  let vectorCount = 0;
  const svgs = Array.from(document.querySelectorAll('svg'));
  for (const svg of svgs) {
    const rect = svg.getBoundingClientRect();
    const w = Math.round(rect.width || svg.width?.baseVal?.value || 0);
    const h = Math.round(rect.height || svg.height?.baseVal?.value || 0);
    if (!isDesignSvgCandidate(svg, w, h)) continue;

    let previewUrl = '';
    try {
      const safeSvg = serializeSafeSvg(svg);
      if (safeSvg.length > 0 && safeSvg.length < 250000) {
        previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`;
      }
    } catch {
      // ignore preview serialization errors
    }

    artboards.push({
      id: `design-svg-${idx + 1}`,
      name: inferArtboardName(svg, idx, true),
      sourceType: 'svg',
      previewUrl,
      highResUrl: '',
      width: w,
      height: h,
    });
    vectorCount++;
    idx++;
  }

  const { annotations, colorTokens, typographyTokens } = extractDesignAnnotationsAndTokens();
  const mode: 'multi-board' | 'single-detail' = artboards.length > 1 ? 'multi-board' : 'single-detail';

  return {
    title: rawTitle,
    sanitizedTitle: cleanTitle,
    platform,
    mode,
    artboards,
    vectorCount,
    pageAnnotations: annotations,
    colorTokens,
    typographyTokens,
  };
}

/**
 * Fetch image binary with automatic fallback: direct fetch -> background proxy -> fallback previewUrl.
 */
async function fetchDesignImageBinary(
  highResUrl: string,
  fallbackUrl: string
): Promise<{ buffer: ArrayBuffer; mime: string; usedUrl: string }> {
  const tryFetchSingle = async (url: string): Promise<{ buffer: ArrayBuffer; mime: string }> => {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return { buffer: await blob.arrayBuffer(), mime: blob.type || 'image/png' };
    }

    try {
      let resp: Response;
      try {
        resp = await fetch(url);
      } catch {
        resp = await fetch(url, { credentials: 'include' });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const mime = resp.headers.get('content-type') || blob.type || 'image/png';
      return { buffer: await blob.arrayBuffer(), mime };
    } catch (directErr) {
      const bgRes: any = await browser.runtime.sendMessage({
        type: 'FETCH_IMAGE_DATA',
        url,
      });
      if (bgRes && bgRes.ok && bgRes.base64) {
        return {
          buffer: base64ToUint8Array(bgRes.base64).buffer as ArrayBuffer,
          mime: bgRes.mime || 'image/png',
        };
      }
      throw directErr;
    }
  };

  try {
    const res = await tryFetchSingle(highResUrl);
    return { ...res, usedUrl: highResUrl };
  } catch (highResErr) {
    if (fallbackUrl && fallbackUrl !== highResUrl) {
      const res = await tryFetchSingle(fallbackUrl);
      return { ...res, usedUrl: fallbackUrl };
    }
    throw highResErr;
  }
}

/**
 * WebGL Canvas fallback: capture visible active tab via background and crop strictly to the canvas bounds.
 * When `sharedCaptureDataUrl` is provided (multi-canvas page), crops locally in DOM to avoid
 * Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.
 */
async function captureCanvasRegionFallback(
  canvas: HTMLCanvasElement,
  sharedCaptureDataUrl?: string | null
): Promise<{ bytes: Uint8Array; cropped: boolean } | null> {
  const { rect, needsTopFrameOffset } = getElementCaptureRect(canvas);
  if (rect.width < 40 || rect.height < 40) return null;

  if (sharedCaptureDataUrl && !needsTopFrameOffset) {
    const croppedBytes = await cropCapturedPngInDom(sharedCaptureDataUrl, rect);
    if (croppedBytes) {
      return { bytes: croppedBytes, cropped: true };
    }
  }

  const res: any = await browser.runtime.sendMessage({
    type: 'CAPTURE_REGION_CROP',
    rect,
    needsTopFrameOffset,
  });

  if (res?.ok) {
    if (!res.cropped && res.dataUrl && !needsTopFrameOffset) {
      const domCropped = await cropCapturedPngInDom(res.dataUrl, rect);
      if (domCropped) {
        return { bytes: domCropped, cropped: true };
      }
    }
    if (res.base64) {
      return {
        bytes: base64ToUint8Array(res.base64),
        cropped: Boolean(res.cropped),
      };
    }
  }
  return null;
}

/**
 * Extract selected (or all detected) design artboards, WebGL canvases, and inline SVGs
 * into local assets and structured Markdown.
 */
export async function extractDesignBundle(
  onProgress?: (current: number, total: number, message: string) => void,
  selectedIds?: string[]
): Promise<DesignExtractionResult> {
  onProgress?.(5, 100, '正在扫描设计画板、矢量 SVG 与标注信息...');

  const scan = listDesignArtboards();
  const selectedSet = selectedIds && selectedIds.length > 0 ? new Set(selectedIds) : null;
  const targets = selectedSet
    ? scan.artboards.filter((a) => selectedSet.has(a.id))
    : scan.artboards;

  if (targets.length === 0) {
    throw new Error('未在当前页面检测到可提取的设计图、画布或矢量资产，请确认已选中至少 1 项');
  }

  const assets: BundleAsset[] = [];
  const warnings: string[] = [];
  const exportedItems: Array<{
    artboard: DesignArtboardSummary;
    localPath: string;
    filename: string;
    formatLabel: string;
    usedUrl: string;
  }> = [];

  // Snapshot live canvas & SVG node lists in matching scan order
  const liveCanvases = Array.from(document.querySelectorAll('canvas')).filter((c) => {
    const rect = c.getBoundingClientRect();
    return (c.width || rect.width) >= 240 && (c.height || rect.height) >= 180 && rect.width >= 100 && rect.height >= 100;
  });

  const liveSvgs = Array.from(document.querySelectorAll('svg')).filter((svg) => {
    const rect = svg.getBoundingClientRect();
    const w = Math.round(rect.width || svg.width?.baseVal?.value || 0);
    const h = Math.round(rect.height || svg.height?.baseVal?.value || 0);
    return isDesignSvgCandidate(svg, w, h);
  });

  onProgress?.(15, 100, `准备并发抓取 ${targets.length} 项高清设计资产...`);

  // If multiple canvas targets are selected on the top frame, share a single visible tab capture
  // across blank-frame fallbacks to avoid hitting Chrome's captureVisibleTab per-second quota.
  const selectedCanvasCount = targets.filter((t) => t.sourceType === 'canvas').length;
  let sharedViewportPromise: Promise<string | null> | null = null;
  const getSharedViewportDataUrl = (): Promise<string | null> => {
    if (selectedCanvasCount <= 1 || window !== window.top) return Promise.resolve(null);
    if (!sharedViewportPromise) {
      sharedViewportPromise = browser.runtime
        .sendMessage({ type: 'CAPTURE_VISIBLE_TAB' })
        .then((res: any) => (res?.ok && res.dataUrl ? String(res.dataUrl) : null))
        .catch(() => null);
    }
    return sharedViewportPromise;
  };

  let completed = 0;
  let exportedVectorCount = 0;

  await asyncPool(5, targets, async (artboard, index) => {
    const seq = String(index + 1).padStart(3, '0');
    const slug = sanitizeFilename(artboard.name, `board-${seq}`).slice(0, 40);

    try {
      if (artboard.sourceType === 'svg') {
        const svgIdx = scan.artboards
          .filter((a) => a.sourceType === 'svg')
          .findIndex((a) => a.id === artboard.id);
        const targetSvg = liveSvgs[svgIdx];
        if (!targetSvg) throw new Error('未找到对应的内联 SVG 节点');
        const safeSvgMarkup = serializeSafeSvg(targetSvg);
        if (!safeSvgMarkup) throw new Error('SVG 序列化结果为空');
        const bytes = new TextEncoder().encode(safeSvgMarkup);
        const filename = `assets/${scan.sanitizedTitle}/design-${seq}-${slug}.svg`;
        assets.push({ filename, data: bytes });
        exportedVectorCount++;
        exportedItems[index] = {
          artboard,
          localPath: `./${filename}`,
          filename,
          formatLabel: 'SVG',
          usedUrl: '[inline-svg]',
        };
      } else if (artboard.sourceType === 'canvas') {
        const canvasIdx = scan.artboards
          .filter((a) => a.sourceType === 'canvas')
          .findIndex((a) => a.id === artboard.id);
        const targetCanvas = liveCanvases[canvasIdx] || liveCanvases[0];
        if (!targetCanvas) throw new Error('未找到对应的 Live Canvas 节点');

        // 1. Try direct canvasToBlob + 64-pixel blank-frame check (catches WebGL preserveDrawingBuffer: false)
        const blob = await canvasToBlob(targetCanvas);
        const isBlank = !blob || (await isImageBlobBlank(blob));

        if (!isBlank && blob) {
          const buffer = await blob.arrayBuffer();
          const filename = `assets/${scan.sanitizedTitle}/design-${seq}-${slug}.png`;
          assets.push({ filename, data: new Uint8Array(buffer) });
          exportedItems[index] = {
            artboard,
            localPath: `./${filename}`,
            filename,
            formatLabel: 'PNG (Canvas)',
            usedUrl: '[live-canvas]',
          };
        } else {
          // 2. WebGL / tainted canvas fallback -> activeTab viewport region crop
          const sharedDataUrl = await getSharedViewportDataUrl();
          const cropRes = await captureCanvasRegionFallback(targetCanvas, sharedDataUrl);
          if (!cropRes) {
            const hint = WEBGL_CANVAS_PLATFORMS.has(scan.platform)
              ? 'WebGL 画布为空且视口裁切兜底不可用（请确保目标标签页处于当前可见状态）'
              : 'Canvas 跨域受限或内容为空，且视口裁切兜底失败';
            throw new Error(hint);
          }
          const filename = `assets/${scan.sanitizedTitle}/design-${seq}-${slug}.png`;
          assets.push({ filename, data: cropRes.bytes });
          exportedItems[index] = {
            artboard,
            localPath: `./${filename}`,
            filename,
            formatLabel: cropRes.cropped ? 'PNG (Viewport Crop)' : 'PNG (Viewport)',
            usedUrl: '[webgl-viewport-crop]',
          };
        }
      } else {
        const { buffer, mime, usedUrl } = await fetchDesignImageBinary(
          artboard.highResUrl,
          artboard.previewUrl
        );
        const ext = getExtensionFromMimeOrUrl(mime, usedUrl);
        const filename = `assets/${scan.sanitizedTitle}/design-${seq}-${slug}.${ext}`;
        assets.push({ filename, data: new Uint8Array(buffer) });
        if (ext === 'svg') exportedVectorCount++;
        exportedItems[index] = {
          artboard,
          localPath: `./${filename}`,
          filename,
          formatLabel: ext.toUpperCase(),
          usedUrl,
        };
      }
    } catch (err: any) {
      warnings.push(`画板 [${artboard.name}] 提取失败: ${err?.message || err}`);
      exportedItems[index] = {
        artboard,
        localPath: artboard.previewUrl || '',
        filename: '',
        formatLabel: artboard.sourceType.toUpperCase(),
        usedUrl: artboard.previewUrl || '',
      };
    } finally {
      completed++;
      const pct = 15 + Math.floor((completed / Math.max(1, targets.length)) * 75);
      onProgress?.(pct, 100, `设计资产抓取进度: ${completed}/${targets.length}...`);
    }
  });

  onProgress?.(92, 100, '正在生成结构化设计规范 Markdown...');

  const sourceUrl = window.location.href;
  const frontmatter = generateYamlFrontmatter({
    title: scan.title,
    source_url: sourceUrl,
    design_url: sourceUrl,
    extracted_at: new Date().toISOString(),
    type: 'design-spec',
    platform: scan.platform,
    artboard_count: exportedItems.length,
    vector_count: exportedVectorCount,
    asset_count: assets.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });

  const mdLines: string[] = [
    `# ${scan.title} (UI Design Assets)`,
    '',
    `- **Source Platform**: \`${scan.platform}\``,
    `- **Source URL**: ${sourceUrl}`,
    `- **Exported Assets**: ${exportedItems.length} (${assets.length} localized files${exportedVectorCount > 0 ? `, including ${exportedVectorCount} SVG vectors` : ''})`,
    '',
  ];

  // Unified Asset Manifest Table (Bitmaps + SVG Vectors)
  mdLines.push('## Artboard & Asset Index', '');
  mdLines.push('| # | Asset Name | Type | Dimensions | Local Asset Path |');
  mdLines.push('| :-: | :--- | :---: | :--- | :--- |');
  exportedItems.forEach((item, idx) => {
    if (!item) return;
    const dim = item.artboard.width && item.artboard.height ? `${item.artboard.width} × ${item.artboard.height}` : 'N/A';
    mdLines.push(
      `| ${idx + 1} | ${item.artboard.name} | \`${item.formatLabel}\` | \`${dim}\` | \`${item.localPath || 'N/A'}\` |`
    );
  });
  mdLines.push('');

  // Color & Typography Tokens
  if (scan.colorTokens.length > 0) {
    mdLines.push('## Detected Color Tokens', '');
    mdLines.push(scan.colorTokens.map((c) => `\`${c}\``).join(' · '), '');
  }

  if (scan.typographyTokens.length > 0) {
    mdLines.push('## Detected Typography & Style Tokens', '');
    for (const token of scan.typographyTokens) {
      mdLines.push(`- \`${token}\``);
    }
    mdLines.push('');
  }

  if (scan.pageAnnotations.length > 0) {
    mdLines.push('## Design Annotations & Inspector CSS', '');
    for (const note of scan.pageAnnotations) {
      mdLines.push(`- ${note}`);
    }
    mdLines.push('');
  }

  // Per-artboard detail sections
  mdLines.push('## Artboard Visual Specs', '');
  exportedItems.forEach((item, idx) => {
    if (!item) return;
    const dim = item.artboard.width && item.artboard.height ? `${item.artboard.width} × ${item.artboard.height}` : 'Auto';
    mdLines.push(`### ${idx + 1}. ${item.artboard.name}`, '');
    mdLines.push(`- **Type**: \`${item.formatLabel}\``);
    mdLines.push(`- **Dimensions**: \`${dim}\``);
    if (item.localPath) {
      mdLines.push(`- **Asset File**: \`${item.localPath}\``, '');
      mdLines.push(`![${item.artboard.name}](${item.localPath})`, '');
    } else {
      mdLines.push(`- **Status**: Failed to export asset`, '');
    }
  });

  const fullMarkdown = `${frontmatter}\n${mdLines.join('\n')}\n`;

  onProgress?.(100, 100, '全平台设计稿资产与规范提取完成');

  return {
    title: scan.title,
    sanitizedTitle: scan.sanitizedTitle,
    platform: scan.platform,
    sourceType: 'design-spec',
    markdown: fullMarkdown,
    assets,
    artboardsCount: exportedItems.length,
    vectorCount: exportedVectorCount,
    warnings,
  };
}
