/**
 * Design Artboard & Asset Extractor for Lanhu, MasterGo, Modao, Figma, Axure, and Web Design Pages.
 * Runs 100% locally inside the authenticated browser session.
 */

import { generateYamlFrontmatter } from '../markdown/turndown-rules';
import {
  sanitizeFilename,
  resolveImageSource,
  extractBackgroundImageUrl,
  canvasToBlob,
  asyncPool,
  getExtensionFromMimeOrUrl,
  base64ToUint8Array,
} from '../../utils/dom-helpers';
import type { BundleAsset } from '../bundler/zip-builder';

export type DesignPlatform = 'lanhu' | 'mastergo' | 'modao' | 'figma' | 'axure' | 'generic-design';

export interface DesignArtboardSummary {
  id: string;
  name: string;
  sourceType: 'img' | 'canvas' | 'bg';
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
  pageAnnotations: string[];
  colorTokens: string[];
}

export interface DesignExtractionResult {
  title: string;
  sanitizedTitle: string;
  platform: DesignPlatform;
  markdown: string;
  assets: BundleAsset[];
  artboardsCount: number;
  warnings: string[];
}

/**
 * Identify the design platform from URL and DOM heuristics.
 */
export function detectDesignPlatform(url = window.location.href): DesignPlatform {
  const lower = url.toLowerCase();
  if (lower.includes('lanhuapp.com') || lower.includes('lanhu')) return 'lanhu';
  if (lower.includes('mastergo.com')) return 'mastergo';
  if (lower.includes('modao.cc') || lower.includes('mockingbot')) return 'modao';
  if (lower.includes('figma.com')) return 'figma';
  if (lower.includes('axure') || document.querySelector('#base, .ax_default')) return 'axure';
  return 'generic-design';
}

/**
 * Attempt to strip thumbnail resize query parameters (Aliyun OSS, Tencent COS, Qiniu, Lanhu CDN)
 * to recover lossless full-resolution design URLs while preserving auth tokens when safe.
 */
export function restoreHighResDesignUrl(rawUrl: string): string {
  if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl, window.location.href);

    // If URL is signed (OSS/COS/S3), modifying query params may break signature;
    // return unsigned clean URL only if no signature param exists, or strip unsigned resize suffix.
    const hasSignature =
      parsed.searchParams.has('Signature') ||
      parsed.searchParams.has('OSSAccessKeyId') ||
      parsed.searchParams.has('X-Amz-Signature') ||
      parsed.searchParams.has('q-signature') ||
      parsed.searchParams.has('sign');

    if (!hasSignature) {
      // Aliyun OSS resize / quality / format
      if (parsed.searchParams.has('x-oss-process')) {
        parsed.searchParams.delete('x-oss-process');
      }
      // Tencent COS / Qiniu imageView2 / imageMogr2
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (/^(?:imageMogr2|imageView2|imageSlim|thumbnail|resize)$/i.test(key)) {
          parsed.searchParams.delete(key);
        }
      }
      // Strip raw query string starting with imageMogr2 / imageView2 (non-KV Qiniu/COS format)
      if (/^\?(?:imageMogr2|imageView2)\//i.test(parsed.search)) {
        parsed.search = '';
      }
      // Lanhu / OSS exclamation or @ style thumbnail suffix in pathname (e.g. .png!small or .png@300w)
      parsed.pathname = parsed.pathname.replace(/(\.(?:png|jpe?g|webp))[@!][^/]+$/i, '$1');
    }

    return parsed.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Infer a human-readable artboard name from surrounding DOM labels.
 */
function inferArtboardName(el: Element, index: number): string {
  // 1. Check direct element attributes
  const attrCandidates = [
    el.getAttribute('alt'),
    el.getAttribute('title'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-name'),
    el.getAttribute('data-title'),
  ];
  for (const c of attrCandidates) {
    const text = c?.trim();
    if (text && text.length >= 2 && text.length <= 60 && !/^image$/i.test(text) && !/^https?:\/\//.test(text)) {
      return text;
    }
  }

  // 2. Walk up to artboard card container and find label/title element
  const card = el.closest(
    '[class*="artboard"], [class*="board"], [class*="screen"], [class*="card"], [class*="item"], figure, li'
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

  // 3. On single-detail view, check active page title in header/sidebar
  const activeHeader = document.querySelector(
    '[class*="artboard-name"], [class*="page-name"], [class*="stage-title"], [class*="tree"] [class*="active"]'
  );
  const headerText = activeHeader?.textContent?.trim().split('\n')[0]?.trim();
  if (headerText && headerText.length >= 1 && headerText.length <= 60) {
    return index === 0 ? headerText : `${headerText}-${index + 1}`;
  }

  return `Artboard-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Extract design annotations, review comments, and CSS color tokens visible on the page.
 */
function extractDesignAnnotationsAndTokens(): { annotations: string[]; colorTokens: string[] } {
  const annotations = new Set<string>();
  const colorTokens = new Set<string>();

  const annotationSelectors = [
    '[class*="annotation"]',
    '[class*="comment-content"]',
    '[class*="comment-text"]',
    '[class*="mark-text"]',
    '[class*="note-content"]',
    '[class*="css-code"]',
    '[class*="style-code"]',
    '[class*="code-box"]',
  ];

  for (const sel of annotationSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && text.length <= 300) {
          annotations.add(text);
        }
        const hexMatches = text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
        if (hexMatches) {
          hexMatches.forEach((c) => colorTokens.add(c.toUpperCase()));
        }
      });
    } catch {
      // ignore selector error
    }
  }

  // Also scan dedicated color swatch badges in inspector sidebars
  try {
    document.querySelectorAll('[class*="color-value"], [class*="hex"], [class*="swatch"]').forEach((el) => {
      const text = (el.textContent || '').trim();
      const hexMatches = text.match(/#[0-9a-fA-F]{6}\b/g);
      if (hexMatches) {
        hexMatches.forEach((c) => colorTokens.add(c.toUpperCase()));
      }
    });
  } catch {
    // ignore
  }

  return {
    annotations: Array.from(annotations).slice(0, 30),
    colorTokens: Array.from(colorTokens).slice(0, 20),
  };
}

/**
 * Filter out UI chrome icons, user avatars, and tiny decorative images.
 */
function isDesignArtboardCandidate(el: Element, width: number, height: number, url?: string): boolean {
  if (width < 100 || height < 100) return false;
  // Filter tiny square avatars or banner logos
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
 * Scan the current page and list selectable design artboards / visual canvases.
 */
export function listDesignArtboards(): DesignArtboardListResult {
  const platform = detectDesignPlatform();
  const rawTitle = document.title?.trim().replace(/\s*[-|–]\s*(?:蓝湖|Lanhu|MasterGo|墨刀|Figma).*$/i, '') || 'Design_Spec';
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

  // 2. Scan background-image artboard cards (common in Lanhu / Modao / MasterGo thumbnails)
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

  // 3. Scan large <canvas> elements (Figma / MasterGo / Lanhu WebGL/2D stage)
  const canvases = Array.from(document.querySelectorAll('canvas'));
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(canvas.width || rect.width);
    const h = Math.round(canvas.height || rect.height);
    if (w < 240 || h < 180) continue;
    // Skip hidden canvases
    if (rect.width < 100 || rect.height < 100) continue;

    artboards.push({
      id: `design-canvas-${idx + 1}`,
      name: inferArtboardName(canvas, idx),
      sourceType: 'canvas',
      previewUrl: '',
      highResUrl: '',
      width: w,
      height: h,
    });
    idx++;
  }

  const { annotations, colorTokens } = extractDesignAnnotationsAndTokens();
  const mode: 'multi-board' | 'single-detail' = artboards.length > 1 ? 'multi-board' : 'single-detail';

  return {
    title: rawTitle,
    sanitizedTitle: cleanTitle,
    platform,
    mode,
    artboards,
    pageAnnotations: annotations,
    colorTokens,
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
 * Extract selected (or all detected) design artboards into local assets and structured Markdown.
 */
export async function extractDesignBundle(
  onProgress?: (current: number, total: number, message: string) => void,
  selectedIds?: string[]
): Promise<DesignExtractionResult> {
  onProgress?.(5, 100, '正在扫描设计画板与标注信息...');

  const scan = listDesignArtboards();
  const selectedSet = selectedIds && selectedIds.length > 0 ? new Set(selectedIds) : null;
  const targets = selectedSet
    ? scan.artboards.filter((a) => selectedSet.has(a.id))
    : scan.artboards;

  if (targets.length === 0) {
    throw new Error('未在当前页面检测到可提取的设计图或画板，请确认已选中至少 1 张画板');
  }

  const assets: BundleAsset[] = [];
  const warnings: string[] = [];
  const exportedItems: Array<{
    artboard: DesignArtboardSummary;
    localPath: string;
    filename: string;
    usedUrl: string;
  }> = [];

  // Map live canvas elements by index for canvas targets
  const liveCanvases = Array.from(document.querySelectorAll('canvas')).filter((c) => {
    const rect = c.getBoundingClientRect();
    return (c.width || rect.width) >= 240 && (c.height || rect.height) >= 180 && rect.width >= 100 && rect.height >= 100;
  });

  onProgress?.(15, 100, `准备并发抓取 ${targets.length} 张高清设计画板...`);

  let completed = 0;
  await asyncPool(5, targets, async (artboard, index) => {
    const seq = String(index + 1).padStart(3, '0');
    const slug = sanitizeFilename(artboard.name, `board-${seq}`).slice(0, 40);

    try {
      if (artboard.sourceType === 'canvas') {
        // Match canvas element by order among canvas items
        const canvasIdx = scan.artboards
          .filter((a) => a.sourceType === 'canvas')
          .findIndex((a) => a.id === artboard.id);
        const targetCanvas = liveCanvases[canvasIdx] || liveCanvases[0];
        if (!targetCanvas) throw new Error('未找到对应的 Live Canvas 节点');
        const blob = await canvasToBlob(targetCanvas);
        if (!blob) throw new Error('Canvas 跨域受限或内容为空，无法导出位图');
        const buffer = await blob.arrayBuffer();
        const filename = `assets/${scan.sanitizedTitle}/design-${seq}-${slug}.png`;
        assets.push({ filename, data: new Uint8Array(buffer) });
        exportedItems[index] = {
          artboard,
          localPath: `./${filename}`,
          filename,
          usedUrl: '[live-canvas]',
        };
      } else {
        const { buffer, mime, usedUrl } = await fetchDesignImageBinary(
          artboard.highResUrl,
          artboard.previewUrl
        );
        const ext = getExtensionFromMimeOrUrl(mime, usedUrl);
        const filename = `assets/${scan.sanitizedTitle}/design-${seq}-${slug}.${ext}`;
        assets.push({ filename, data: new Uint8Array(buffer) });
        exportedItems[index] = {
          artboard,
          localPath: `./${filename}`,
          filename,
          usedUrl,
        };
      }
    } catch (err: any) {
      warnings.push(`画板 [${artboard.name}] 下载失败: ${err?.message || err}`);
      exportedItems[index] = {
        artboard,
        localPath: artboard.previewUrl || '',
        filename: '',
        usedUrl: artboard.previewUrl || '',
      };
    } finally {
      completed++;
      const pct = 15 + Math.floor((completed / Math.max(1, targets.length)) * 75);
      onProgress?.(pct, 100, `设计图抓取进度: ${completed}/${targets.length}...`);
    }
  });

  onProgress?.(92, 100, '正在生成结构化设计规范 Markdown...');

  const sourceUrl = window.location.href;
  const frontmatter = generateYamlFrontmatter({
    title: scan.title,
    source_url: sourceUrl,
    extracted_at: new Date().toISOString(),
    type: 'design-spec',
    platform: scan.platform,
    artboard_count: exportedItems.length,
    asset_count: assets.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });

  const mdLines: string[] = [
    `# ${scan.title} (UI Design Assets)`,
    '',
    `- **Source Platform**: \`${scan.platform}\``,
    `- **Source URL**: ${sourceUrl}`,
    `- **Exported Artboards**: ${exportedItems.length} (${assets.length} localized images)`,
    '',
  ];

  // Summary Table
  mdLines.push('## Artboard Index', '');
  mdLines.push('| # | Artboard Name | Dimensions | Local Asset Path |');
  mdLines.push('| :-: | :--- | :--- | :--- |');
  exportedItems.forEach((item, idx) => {
    if (!item) return;
    const dim = item.artboard.width && item.artboard.height ? `${item.artboard.width} × ${item.artboard.height}` : 'N/A';
    mdLines.push(`| ${idx + 1} | ${item.artboard.name} | \`${dim}\` | \`${item.localPath || 'N/A'}\` |`);
  });
  mdLines.push('');

  // Design Tokens & Page Annotations if found
  if (scan.colorTokens.length > 0) {
    mdLines.push('## Detected Color Tokens', '');
    mdLines.push(scan.colorTokens.map((c) => `\`${c}\``).join(' · '), '');
  }

  if (scan.pageAnnotations.length > 0) {
    mdLines.push('## Design Annotations & Notes', '');
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
    mdLines.push(`- **Dimensions**: \`${dim}\``);
    if (item.localPath) {
      mdLines.push(`- **Asset File**: \`${item.localPath}\``, '');
      mdLines.push(`![${item.artboard.name}](${item.localPath})`, '');
    } else {
      mdLines.push(`- **Status**: Failed to download image`, '');
    }
  });

  const fullMarkdown = `${frontmatter}\n${mdLines.join('\n')}\n`;

  onProgress?.(100, 100, '设计稿资产与规范提取完成');

  return {
    title: scan.title,
    sanitizedTitle: scan.sanitizedTitle,
    platform: scan.platform,
    markdown: fullMarkdown,
    assets,
    artboardsCount: exportedItems.length,
    warnings,
  };
}
