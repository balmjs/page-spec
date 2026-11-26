/**
 * Dual-Track Prototype PRD Extractor (v1.3)
 * Covers Axure Cloud (*.axshare.com / app.axure.cloud / local Axure RP HTML),
 * Modao (modao.cc / mockingbot.com), Pixso (pixso.cn / pixso.net), and Mockplus RP.
 *
 * Track A: Structured interaction notes, page notes, widget annotations & coordinate-sorted tables/rules.
 * Track B: Clean viewport-cropped high-res prototype stage visual snapshot (./assets/<title>/prototype-001.png).
 */

import { createTurndownService, generateYamlFrontmatter } from '../markdown/turndown-rules';
import {
  sanitizeFilename,
  cleanPlatformTitleSuffix,
  getElementCaptureRect,
  cropCapturedPngInDom,
  base64ToUint8Array,
  canvasToBlob,
  isImageBlobBlank,
  type CaptureRegionRect,
} from '../../utils/dom-helpers';
import type { BundleAsset } from '../bundler/zip-builder';
import type { PrdExtractionResult, ExtractedAssetMeta } from './prd-extractor';

export type PrototypePlatform = 'axure-cloud' | 'axure-local' | 'modao' | 'pixso' | 'mockplus-rp';

export interface PositionedTextBlock {
  top: number;
  left: number;
  text: string;
  isTable?: boolean;
}

export interface WidgetAnnotationItem {
  label: string;
  note: string;
}

export interface PrototypeShellContext {
  platform: PrototypePlatform | null;
  title?: string;
  breadcrumb?: string;
  pageNotes: string[];
  comments: string[];
  iframeRect?: CaptureRegionRect | null;
  viewportWidth?: number;
  viewportHeight?: number;
}

const PROTOTYPE_CHROME_NOISE_PATTERNS: RegExp[] = [
  /^(?:登录|注册|分享|演示|预览|全屏|退出全屏|缩放|适应屏幕|自适应|下载|导出|评论|批注|隐藏|展开|收起|上一页|下一页|首页|目录|大纲|页面|图层|检查|标注|切图|设置|帮助|反馈|复制链接|重置)$/i,
  /^(?:Sign\s*in|Log\s*in|Share|Present|Preview|Fullscreen|Zoom|Fit|Download|Export|Comments?|Notes?|Pages?|Outline|Layers?|Inspect|Settings?|Help|Copy\s*link|Reset|Close|Cancel|OK|Confirm|Back|Next)$/i,
  /^\d+(?:\.\d+)?%$/,
  /^\d{1,2}:\d{2}(?::\d{2})?$/,
  /^[+\-×÷<>«»•·|\\/]+$/,
];

/**
 * Identify whether a URL (or live DOM) belongs to a supported interactive prototype PRD platform.
 */
export function detectPrototypePrdPlatform(
  url = typeof window !== 'undefined' ? window.location.href : '',
  hasAxureDom?: boolean
): PrototypePlatform | null {
  const lower = (url || '').toLowerCase();

  let hostname = '';
  let pathname = '';
  let hash = '';
  try {
    const parsed = new URL(lower);
    hostname = parsed.hostname;
    pathname = parsed.pathname;
    hash = parsed.hash;
  } catch {
    hostname = lower;
  }

  // 1. Axure Cloud / axshare.com
  if (
    hostname === 'app.axure.cloud' ||
    hostname.endsWith('.axure.cloud') ||
    hostname === 'axshare.com' ||
    hostname.endsWith('.axshare.com')
  ) {
    return 'axure-cloud';
  }

  // 2. Modao (墨刀)
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

  // 3. Mockplus RP (摹客 RP)
  if (
    hostname === 'rp.mockplus.cn' ||
    hostname === 'rp.mockplus.com' ||
    ((hostname === 'app.mockplus.cn' || hostname === 'app.mockplus.com') &&
      /(?:\/rp\/|\/proto|\/run\/|\/preview\/|\/doc\/|rp=)/i.test(`${pathname}${hash}`))
  ) {
    return 'mockplus-rp';
  }

  // 4. Pixso (原型演示 / 白板 / PRD 视图)
  if (
    (hostname === 'pixso.cn' ||
      hostname.endsWith('.pixso.cn') ||
      hostname === 'pixso.net' ||
      hostname.endsWith('.pixso.net')) &&
    /(?:\/proto|\/present|\/board|\/whiteboard|\/prd|\/app\/run|\/app\/editor)/i.test(`${pathname}${hash}`)
  ) {
    return 'pixso';
  }

  // 5. Self-hosted / local Axure RP HTML
  const detectedAxureDom =
    typeof hasAxureDom === 'boolean'
      ? hasAxureDom
      : typeof document !== 'undefined' &&
        Boolean(
          document.querySelector('#base, .ax_default, [class*="ax_default"]') ||
            (document.querySelector('#mainFrame') && document.querySelector('#sitemapHost, #interfaceControlFrame')) ||
            typeof (window as any).$axure !== 'undefined'
        );

  if (detectedAxureDom || /\baxure\b/i.test(lower)) {
    return 'axure-local';
  }

  return null;
}

/**
 * Filter out short platform chrome button text and meaningless control tokens.
 */
export function isPrototypeChromeNoise(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return true;
  return PROTOTYPE_CHROME_NOISE_PATTERNS.some((re) => re.test(t));
}

/**
 * Sort positioned text/table blocks into natural reading order:
 * top-to-bottom first; items within `rowTolerancePx` vertical distance sorted left-to-right.
 */
export function sortBlocksByVisualOrder(
  blocks: PositionedTextBlock[],
  rowTolerancePx = 15
): PositionedTextBlock[] {
  return blocks.slice().sort((a, b) => {
    if (Math.abs(a.top - b.top) <= rowTolerancePx) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });
}

/**
 * Deduplicate and sanitize extracted notes list.
 */
function dedupeNotes(items: string[], maxItems = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const clean = raw.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 3 || isPrototypeChromeNoise(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Find the matching or largest prototype iframe rect inside the top window.
 */
export function findTargetIframeRectInTopWindow(frameUrl = ''): {
  rect: CaptureRegionRect;
  viewportWidth: number;
  viewportHeight: number;
} | null {
  if (typeof document === 'undefined') return null;

  const iframes = Array.from(document.querySelectorAll('iframe'));
  if (iframes.length === 0) return null;

  let matched: HTMLIFrameElement | null = null;
  if (frameUrl) {
    matched =
      iframes.find((f) => {
        const src = f.getAttribute('src') || f.src || '';
        return src && (src === frameUrl || frameUrl.startsWith(src) || src.startsWith(frameUrl));
      }) || null;
  }

  if (!matched) {
    matched =
      (document.querySelector('iframe#mainFrame, iframe[name="mainFrame"]') as HTMLIFrameElement | null) || null;
  }

  if (!matched) {
    let bestArea = 0;
    for (const ifr of iframes) {
      const r = ifr.getBoundingClientRect();
      const area = r.width * r.height;
      if (r.width >= 300 && r.height >= 200 && area > bestArea) {
        bestArea = area;
        matched = ifr;
      }
    }
  }

  if (!matched) return null;
  const r = matched.getBoundingClientRect();
  if (r.width < 100 || r.height < 100) return null;

  return {
    rect: {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      dpr: window.devicePixelRatio || 1,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    },
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

/**
 * Collect prototype metadata (title, sitemap breadcrumb path, Page Notes, comments, iframe rect)
 * from the current window (usually called on the outer host shell frameId 0).
 */
export function collectCurrentWindowShellContext(frameUrl = ''): PrototypeShellContext {
  const platform = detectPrototypePrdPlatform();
  const pageNotesRaw: string[] = [];
  const commentsRaw: string[] = [];

  // 1. Breadcrumb / directory tree path
  let breadcrumb = '';
  const breadcrumbParts: string[] = [];
  try {
    const activeTreeNodes = document.querySelectorAll(
      '#sitemapTreeContainer .sitemapHighlight, .sitemapNode.selected, [class*="sitemap"] [class*="active"], [class*="breadcrumb"] a, [class*="breadcrumb"] span, [class*="tree"] [class*="active"], [class*="page-list"] [class*="active"]'
    );
    activeTreeNodes.forEach((node) => {
      const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length <= 60 && !isPrototypeChromeNoise(txt) && !breadcrumbParts.includes(txt)) {
        breadcrumbParts.push(txt);
      }
    });
    if (breadcrumbParts.length > 0) {
      breadcrumb = breadcrumbParts.slice(0, 5).join(' / ');
    }
  } catch {
    // ignore
  }

  // 2. Active page title
  let title = '';
  const titleCandidates = [
    breadcrumbParts[breadcrumbParts.length - 1],
    document.querySelector('#pageName, .pageNameHeader, [class*="page-title"], [class*="artboard-name"], [class*="stage-title"]')
      ?.textContent,
    document.title,
  ];
  for (const c of titleCandidates) {
    const cleaned = cleanPlatformTitleSuffix(c || '');
    if (cleaned && !/^(?:Untitled|Page\s*1|Axure\s*RP\s*Page)$/i.test(cleaned)) {
      title = cleaned;
      break;
    }
  }

  // 3. Axure & general prototype Page Notes
  const noteSelectors = [
    '#notesHost .pageNote',
    '#notesContent',
    '.pageNote',
    '.pageNoteContent',
    '.noteContent',
    '[class*="page-note"]',
    '[class*="pageNote"]',
    '[class*="prd-content"]',
    '[class*="prd-detail"]',
    '[class*="prd-panel"]',
    '[class*="doc-content"]',
    '[class*="spec-content"]',
    '[class*="remark-content"]',
    '[class*="note-content"]',
    '[class*="requirement-desc"]',
  ];
  for (const sel of noteSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && text.length <= 1500) {
          pageNotesRaw.push(text);
        }
      });
    } catch {
      // ignore
    }
  }

  // 4. Floating review comments / interaction callout cards
  const commentSelectors = [
    '[class*="comment-content"]',
    '[class*="comment-text"]',
    '[class*="comment-item"]',
    '[class*="annotation-content"]',
    '[class*="annotation-item"]',
    '[class*="mark-content"]',
    '[class*="remark-item"]',
  ];
  for (const sel of commentSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && text.length <= 600) {
          commentsRaw.push(text);
        }
      });
    } catch {
      // ignore
    }
  }

  const iframeInfo = findTargetIframeRectInTopWindow(frameUrl);

  return {
    platform,
    title: title || undefined,
    breadcrumb: breadcrumb || undefined,
    pageNotes: dedupeNotes(pageNotesRaw, 30),
    comments: dedupeNotes(commentsRaw, 30),
    iframeRect: iframeInfo?.rect || null,
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
  };
}

/**
 * Extract DOM-level widget annotations, tables, and coordinate-sorted narrative text blocks
 * inside the active prototype frame.
 */
function extractInnerPrototypeDomContent(): {
  widgetAnnotations: WidgetAnnotationItem[];
  pageNotes: string[];
  structuredContent: string;
} {
  const widgetAnnotations: WidgetAnnotationItem[] = [];
  const seenWidgets = new Set<string>();
  const pageNotes: string[] = [];

  const pushWidget = (label: string, note: string) => {
    const cleanLabel = label.replace(/\s+/g, ' ').trim();
    const cleanNote = note.replace(/\s+/g, ' ').trim();
    if (!cleanNote || cleanNote.length < 3 || isPrototypeChromeNoise(cleanNote)) return;
    const key = `${cleanLabel.toLowerCase()}::${cleanNote.toLowerCase()}`;
    if (seenWidgets.has(key)) return;
    seenWidgets.add(key);
    widgetAnnotations.push({
      label: cleanLabel || `Widget #${widgetAnnotations.length + 1}`,
      note: cleanNote,
    });
  };

  // 1. Axure widget note markers & labeled elements with tooltips/notes
  try {
    document.querySelectorAll('.annnotelabel, .annotation, [data-annotation], [class*="widget-note"]').forEach((el) => {
      const parentLabel =
        el.closest('[data-label]')?.getAttribute('data-label') ||
        el.getAttribute('data-label') ||
        el.getAttribute('title') ||
        '';
      const noteText =
        el.getAttribute('data-annotation') ||
        el.getAttribute('aria-description') ||
        el.textContent ||
        '';
      if (noteText.trim().length >= 4) {
        pushWidget(parentLabel, noteText);
      }
    });

    // Elements with data-label + meaningful title tooltip
    document.querySelectorAll('[data-label][title]').forEach((el) => {
      const label = el.getAttribute('data-label') || '';
      const tip = el.getAttribute('title') || '';
      if (tip.trim().length >= 4 && tip.trim() !== label.trim()) {
        pushWidget(label, tip);
      }
    });
  } catch {
    // ignore
  }

  // 2. Prototype drawer / floating note cards in single-frame apps (Modao / Pixso / Mockplus RP)
  const drawerSelectors = [
    '[class*="prd-content"]',
    '[class*="note-content"]',
    '[class*="page-note"]',
    '[class*="annotation-text"]',
    '[class*="comment-content"]',
    '[class*="remark-text"]',
    '[class*="spec-desc"]',
    '[class*="interaction-desc"]',
  ];
  for (const sel of drawerSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && text.length <= 1200 && !isPrototypeChromeNoise(text)) {
          pageNotes.push(text);
        }
      });
    } catch {
      // ignore
    }
  }

  // 3. Structured tables & substantial narrative blocks sorted by visual coordinates (top -> left)
  const stageRoot =
    document.querySelector('#base, [class*="prototype-stage"], [class*="canvas-container"], main') || document.body;
  const blocks: PositionedTextBlock[] = [];
  const turndown = createTurndownService();
  const seenBlockText = new Set<string>();

  if (stageRoot) {
    // Tables first
    const tables = Array.from(stageRoot.querySelectorAll('table'));
    for (const table of tables) {
      const rect = table.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) continue;
      const md = turndown.turndown(table.outerHTML).trim();
      if (md && md.length > 10 && !seenBlockText.has(md)) {
        seenBlockText.add(md);
        blocks.push({
          top: Math.round(rect.top + window.scrollY),
          left: Math.round(rect.left + window.scrollX),
          text: md,
          isTable: true,
        });
      }
    }

    // Substantial requirement narrative blocks (skip tiny isolated wireframe button/label fragments)
    const textCandidates = Array.from(
      stageRoot.querySelectorAll('h1, h2, h3, h4, p, li, .ax_default .text, [id$="_text"], [class*="desc"], [class*="rule"]')
    );
    for (const el of textCandidates) {
      if (el.closest('table, nav, header, footer, [role="toolbar"]')) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
        continue;
      }
      const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const isHeading = /^H[1-4]$/.test(el.tagName);
      // Keep headings >= 3 chars or narrative sentences / rules >= 14 chars (avoid scattered button words)
      if ((!isHeading && rawText.length < 14) || rawText.length > 2000) continue;
      if (isPrototypeChromeNoise(rawText)) continue;

      const dedupeKey = rawText.toLowerCase();
      if (seenBlockText.has(dedupeKey)) continue;
      seenBlockText.add(dedupeKey);

      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10) continue;

      const formatted = isHeading ? `### ${rawText}` : `- ${rawText}`;
      blocks.push({
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        text: formatted,
      });
    }
  }

  const orderedBlocks = sortBlocksByVisualOrder(blocks, 15);
  const structuredContent = orderedBlocks
    .slice(0, 80)
    .map((b) => b.text)
    .join('\n\n');

  return {
    widgetAnnotations: widgetAnnotations.slice(0, 60),
    pageNotes: dedupeNotes(pageNotes, 30),
    structuredContent,
  };
}

/**
 * Identify the main prototype stage element for clean toolbar-free snapshot cropping.
 */
function findPrototypeStageElement(): Element | null {
  const candidates = [
    '#base',
    'iframe#mainFrame',
    'iframe[name="mainFrame"]',
    '[class*="prototype-stage"]',
    '[class*="proto-stage"]',
    '[class*="artboard-stage"]',
    '[class*="canvas-stage"]',
    '[class*="canvas-wrapper"]',
    '[class*="stage-container"]',
    '[class*="preview-stage"]',
    'main canvas',
    'canvas',
  ];

  let bestEl: Element | null = null;
  let bestArea = 0;

  for (const sel of candidates) {
    try {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        const visibleW = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
        const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (visibleW < 240 || visibleH < 180) continue;
        const area = visibleW * visibleH;
        if (area > bestArea) {
          bestArea = area;
          bestEl = el;
        }
      }
      if (bestEl) return bestEl;
    } catch {
      // ignore
    }
  }

  return document.body;
}

/**
 * Capture Track B visual snapshot of the prototype stage via live Canvas or Background region crop.
 */
async function capturePrototypeStageSnapshot(): Promise<{ bytes: Uint8Array; method: string } | null> {
  const stageEl = findPrototypeStageElement();
  if (!stageEl) return null;

  // 1. If stage is a non-blank HTMLCanvasElement, try direct lossless export first
  if (stageEl instanceof HTMLCanvasElement) {
    const blob = await canvasToBlob(stageEl);
    if (blob && !(await isImageBlobBlank(blob))) {
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        method: 'live-canvas',
      };
    }
  }

  // 2. Otherwise use activeTab viewport crop (reuses activeTab, strips sidebars/toolbars)
  const { rect, needsTopFrameOffset } = getElementCaptureRect(stageEl);
  // Clamp rect to visible window area
  const clampedX = Math.max(0, rect.x);
  const clampedY = Math.max(0, rect.y);
  const clampedW = Math.min(rect.width, (rect.viewportWidth || window.innerWidth) - clampedX);
  const clampedH = Math.min(rect.height, (rect.viewportHeight || window.innerHeight) - clampedY);

  const captureRect: CaptureRegionRect =
    clampedW >= 160 && clampedH >= 120
      ? {
          ...rect,
          x: clampedX,
          y: clampedY,
          width: clampedW,
          height: clampedH,
        }
      : {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };

  try {
    const res: any = await browser.runtime.sendMessage({
      type: 'CAPTURE_REGION_CROP',
      rect: captureRect,
      needsTopFrameOffset,
    });
    if (res?.ok) {
      if (!res.cropped && res.dataUrl && !needsTopFrameOffset) {
        const domCropped = await cropCapturedPngInDom(res.dataUrl, captureRect);
        if (domCropped) {
          return { bytes: domCropped, method: 'viewport-crop' };
        }
      }
      if (res.base64) {
        return {
          bytes: base64ToUint8Array(res.base64),
          method: res.cropped ? 'viewport-crop' : 'viewport-full',
        };
      }
    }
  } catch {
    // ignore capture failure
  }
  return null;
}

/**
 * Format dual-track Prototype PRD Markdown document (pure function for easy testing).
 */
export function formatPrototypePrdMarkdown(input: {
  title: string;
  sourceUrl: string;
  platform: PrototypePlatform;
  breadcrumb?: string;
  snapshotPath?: string;
  pageNotes: string[];
  widgetAnnotations: WidgetAnnotationItem[];
  structuredContent?: string;
  assetCount: number;
  warnings?: string[];
}): string {
  const frontmatter = generateYamlFrontmatter({
    title: input.title,
    source_url: input.sourceUrl,
    extracted_at: new Date().toISOString(),
    type: 'prd-prototype',
    platform: input.platform,
    asset_count: input.assetCount,
    ...(input.warnings && input.warnings.length > 0 ? { warnings: input.warnings } : {}),
  });

  const lines: string[] = [
    `# ${input.title}`,
    '',
    `- **来源平台 (Platform)**: \`${input.platform}\``,
  ];

  if (input.breadcrumb) {
    lines.push(`- **原型路径 (Prototype Path)**: \`${input.breadcrumb}\``);
  }
  lines.push('');

  let sectionIdx = 1;

  if (input.snapshotPath) {
    lines.push(`## ${sectionIdx++}. 原型视图快照 (Prototype Visual Snapshot)`, '');
    lines.push(`![${input.title}](${input.snapshotPath})`, '');
  }

  if (input.pageNotes.length > 0) {
    lines.push(`## ${sectionIdx++}. 页面说明与业务规则 (Page Notes)`, '');
    for (const note of input.pageNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  if (input.widgetAnnotations.length > 0) {
    lines.push(`## ${sectionIdx++}. 控件交互标注 (Widget Annotations)`, '');
    input.widgetAnnotations.forEach((item, idx) => {
      lines.push(`${idx + 1}. **${item.label}**：${item.note}`);
    });
    lines.push('');
  }

  if (input.structuredContent && input.structuredContent.trim()) {
    lines.push(`## ${sectionIdx++}. 结构化界面内容与规则表 (Structured Content & Tables)`, '');
    lines.push(input.structuredContent.trim(), '');
  }

  if (
    !input.snapshotPath &&
    input.pageNotes.length === 0 &&
    input.widgetAnnotations.length === 0 &&
    !input.structuredContent?.trim()
  ) {
    lines.push('> 未在当前原型页面检测到文字批注或可裁剪的视觉画布，请尝试切换到包含原型画布的 Frame 后重试。', '');
  }

  return `${frontmatter}\n${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Execute dual-track Prototype PRD extraction (Track A Notes/Annotations + Track B Visual Snapshot).
 */
export async function extractPrototypePrdBundle(
  onProgress?: (current: number, total: number, message: string) => void,
  options?: { forcedPlatform?: PrototypePlatform }
): Promise<PrdExtractionResult> {
  const warnings: string[] = [];
  onProgress?.(10, 100, '正在采集原型宿主壳批注与目录上下文...');

  // 1. Gather outer shell context (cross-frame if running in an iframe, or directly if top frame)
  let shellContext: PrototypeShellContext;
  if (window !== window.top) {
    try {
      const shellRes: any = await browser.runtime.sendMessage({
        type: 'COLLECT_PROTOTYPE_SHELL_CONTEXT',
        frameUrl: window.location.href,
      });
      shellContext =
        shellRes?.ok && shellRes.data
          ? (shellRes.data as PrototypeShellContext)
          : { platform: null, pageNotes: [], comments: [] };
    } catch {
      shellContext = { platform: null, pageNotes: [], comments: [] };
    }
  } else {
    shellContext = collectCurrentWindowShellContext();
  }

  const platform: PrototypePlatform =
    options?.forcedPlatform ||
    detectPrototypePrdPlatform() ||
    shellContext.platform ||
    'axure-local';

  // 2. On-demand Axure MAIN world metadata read (Page Notes + Widget Notes)
  let axureMeta: {
    pageName?: string;
    pageNotes?: string[];
    widgetNotes?: WidgetAnnotationItem[];
  } | null = null;
  if (platform === 'axure-cloud' || platform === 'axure-local') {
    try {
      const axRes: any = await browser.runtime.sendMessage({ type: 'READ_AXURE_METADATA' });
      if (axRes?.ok && axRes.data) {
        axureMeta = axRes.data;
      }
    } catch {
      // ignore if scripting unavailable (e.g. Firefox)
    }
  }

  onProgress?.(35, 100, '正在提取交互标注、页面说明与坐标重排文本...');

  // 3. Extract inner frame DOM notes, widget annotations & visual-order content
  const innerDom = extractInnerPrototypeDomContent();

  // Resolve clean document title
  let rawTitle =
    cleanPlatformTitleSuffix(axureMeta?.pageName || '') ||
    cleanPlatformTitleSuffix(shellContext.title || '') ||
    cleanPlatformTitleSuffix(document.title || '');
  if (!rawTitle || /^(?:Untitled|Page\s*1|Axure\s*RP\s*Page)$/i.test(rawTitle)) {
    const heading = document.querySelector('h1, h2, .ax_default[class*="heading"]')?.textContent?.trim();
    rawTitle = cleanPlatformTitleSuffix(heading || '') || 'Prototype_PRD';
  }
  const cleanTitle = sanitizeFilename(rawTitle, 'Prototype_PRD');

  // Merge Track A notes & widget annotations (outer shell + Axure MAIN metadata + inner DOM)
  const mergedPageNotes = dedupeNotes(
    [
      ...(axureMeta?.pageNotes || []),
      ...shellContext.pageNotes,
      ...innerDom.pageNotes,
      ...shellContext.comments,
    ],
    40
  );

  const mergedWidgets: WidgetAnnotationItem[] = [];
  const seenWidgetKey = new Set<string>();
  for (const w of [...(axureMeta?.widgetNotes || []), ...innerDom.widgetAnnotations]) {
    const key = `${w.label.toLowerCase()}::${w.note.toLowerCase()}`;
    if (!seenWidgetKey.has(key)) {
      seenWidgetKey.add(key);
      mergedWidgets.push(w);
    }
  }

  onProgress?.(65, 100, '正在捕获原型画布高清视觉快照...');

  // 4. Track B: Capture high-res prototype stage visual snapshot
  const assets: BundleAsset[] = [];
  const assetMetadata: ExtractedAssetMeta[] = [];
  let snapshotPath: string | undefined;

  const snapshot = await capturePrototypeStageSnapshot();
  if (snapshot) {
    const filename = `assets/${cleanTitle}/prototype-001.png`;
    snapshotPath = `./${filename}`;
    assets.push({
      filename,
      data: snapshot.bytes,
    });
    assetMetadata.push({
      filename,
      originalUrl: `[prototype-${snapshot.method}]`,
      alt: rawTitle,
    });
  } else {
    warnings.push('未能自动截取原型舞台视口快照（请确保当前原型页面处于激活可见状态）');
  }

  onProgress?.(90, 100, '正在合成双轨原型 PRD Markdown...');

  const sourceUrl = window.location.href;
  const markdown = formatPrototypePrdMarkdown({
    title: rawTitle,
    sourceUrl,
    platform,
    breadcrumb: shellContext.breadcrumb,
    snapshotPath,
    pageNotes: mergedPageNotes,
    widgetAnnotations: mergedWidgets,
    structuredContent: innerDom.structuredContent,
    assetCount: assets.length,
    warnings,
  });

  onProgress?.(100, 100, '原型 PRD 双轨提取完成');

  return {
    title: rawTitle,
    sanitizedTitle: cleanTitle,
    platform,
    sourceType: 'prd-prototype',
    markdown,
    assets,
    assetMetadata,
    warnings,
  };
}
