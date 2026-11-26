/**
 * DOM Helper Utilities for PageSpec
 */

/**
 * Sanitize a string to be safely used as a filename.
 */
export function sanitizeFilename(name: string, fallback = 'document'): string {
  if (!name || typeof name !== 'string') return fallback;
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

/**
 * Resolve the real absolute source URL of an image, handling various lazy-load conventions.
 */
export function resolveImageSource(img: HTMLImageElement): string | null {
  const candidates = [
    img.getAttribute('data-ps-resolved-src'),
    img.currentSrc,
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-original-src'),
    img.getAttribute('data-actualsrc'),
    img.getAttribute('data-origin-src'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-url'),
    img.getAttribute('data-zoom-src'),
    img.getAttribute('data-raw-src'),
    img.getAttribute('data-full-src'),
    img.getAttribute('data-preview-src'),
    img.getAttribute('data-preview-url'),
    img.getAttribute('data-file-url'),
    img.getAttribute('data-download-url'),
    img.getAttribute('data-img-url'),
    img.getAttribute('data-img-src'),
    img.getAttribute('data-source'),
    img.getAttribute('data-cos-src'),
    img.getAttribute('data-cdn-src'),
    img.getAttribute('data-crop-src'),
    img.getAttribute('data-large'),
    img.getAttribute('data-image'),
    img.getAttribute('data-origin'),
    img.getAttribute('src'),
  ];

  // Also check srcset for highest resolution candidate if available
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
  if (srcset) {
    const parts = srcset.split(',').map((p) => p.trim());
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      const urlPart = lastPart.split(/\s+/)[0];
      if (urlPart) {
        candidates.unshift(urlPart);
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) continue;
    const c = candidate.trim();
    if (c === 'about:blank' || c === 'javascript:void(0)') continue;
    // Filter out 1x1 transparent placeholders (GIF, PNG, or empty SVG data URIs)
    if (c.startsWith('data:')) {
      if (
        c.includes('R0lGODlhAQABA') ||
        c.includes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB') ||
        c.startsWith('data:image/svg+xml;base64,PHN2Zy') ||
        c.length < 150
      ) {
        continue;
      }
    }
    try {
      return new URL(c, window.location.href).href;
    } catch {
      return c;
    }
  }

  return null;
}

/**
 * Extract background image URL from element inline styles.
 */
export function extractBackgroundImageUrl(el: Element): string | null {
  const style = el.getAttribute('style') || '';
  const match = style.match(/background(?:-image)?\s*:[^;]*url\(['"]?(https?:\/\/[^'")]+|data:image\/[^'")]+)['"]?\)/i);
  if (match && match[1]) {
    const url = match[1].trim();
    if (!url.startsWith('data:image/svg+xml') && url.length > 20) {
      return url;
    }
  }
  return null;
}

/**
 * Check if an image or visual element is an essential prototype/content graphic rather than a tiny icon/avatar.
 */
export function isSignificantVisualElement(el: Element, minSize = 32): boolean {
  if (el.getAttribute('data-ps-ignore') === 'true') {
    return false;
  }
  const cachedW = parseFloat(el.getAttribute('data-ps-width') || '0');
  const cachedH = parseFloat(el.getAttribute('data-ps-height') || '0');

  if (el instanceof HTMLImageElement) {
    const width = cachedW || el.naturalWidth || el.width || el.getBoundingClientRect().width;
    const height = cachedH || el.naturalHeight || el.height || el.getBoundingClientRect().height;

    // Filter out if known dimensions are below threshold
    if ((width > 0 && width < minSize) || (height > 0 && height < minSize)) {
      return false;
    }

    // Check class names / alt / attributes for decorative / avatar hints
    const combinedStr = `${el.className} ${el.alt || ''} ${el.src || ''}`.toLowerCase();
    if (
      combinedStr.includes('avatar') ||
      combinedStr.includes('emoji') ||
      combinedStr.includes('badge-icon') ||
      combinedStr.includes('status-icon') ||
      combinedStr.includes('ui-icon')
    ) {
      return false;
    }
    return true;
  }

  if (el instanceof HTMLCanvasElement) {
    const rect = el.getBoundingClientRect();
    const w = cachedW || el.width || rect.width;
    const h = cachedH || el.height || rect.height;
    return w >= minSize && h >= minSize;
  }

  if (el instanceof SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const w = cachedW || el.width?.baseVal?.value || rect.width;
    const h = cachedH || el.height?.baseVal?.value || rect.height;
    return w >= minSize && h >= minSize;
  }

  return true;
}

/**
 * Run a pool of async tasks with concurrency limit.
 */
export async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Set<Promise<any>> = new Set();

  for (let i = 0; i < array.length; i++) {
    const item = array[i]!;
    const p = Promise.resolve().then(() => iteratorFn(item, i));
    ret.push(p);

    let clean: Promise<any>;
    clean = p.finally(() => executing.delete(clean));
    executing.add(clean);

    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

/**
 * Deduce file extension from Content-Type header or URL.
 */
export function getExtensionFromMimeOrUrl(mime: string | null | undefined, url: string): string {
  if (mime) {
    const m = mime.toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    if (m.includes('svg')) return 'svg';
    if (m.includes('gif')) return 'gif';
    if (m.includes('avif')) return 'avif';
    if (m.includes('bmp')) return 'bmp';
  }
  const cleanUrl = url.split('?')[0]?.split('#')[0] || '';
  const match = cleanUrl.match(/\.(png|jpe?g|webp|svg|gif|bmp|avif)$/i);
  if (match && match[1]) {
    const ext = match[1].toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'png';
}

/**
 * Convert Uint8Array to Base64 string safely without call stack overflow.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string back to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert HTMLCanvasElement to Blob.
 */
export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Clean trailing platform brand suffixes from document titles across major design,
 * prototype, and documentation platforms.
 */
const PLATFORM_TITLE_SUFFIX_REGEX =
  /\s*(?:[-|–—·]\s*(?:Figma|Zeplin|Sketch(?:\s+Cloud|\s+Web)?|蓝湖|Lanhu|Mockplus(?:\s+RP|\s+DT)?|摹客(?:\s*RP|\s*DT)?|MasterGo|Pixso|墨刀|Modao|MockingBot|Axure(?:\s+Cloud|\s+RP)?|腾讯文档|企业微信文档|飞书云文档|语雀|Confluence|Notion)\s*)+$/i;

export function cleanPlatformTitleSuffix(rawTitle: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  const trimmed = rawTitle.trim();
  const stripped = trimmed.replace(PLATFORM_TITLE_SUFFIX_REGEX, '').trim();
  return stripped || trimmed;
}

export interface CaptureRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface PixelCropBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Compute pixel-aligned crop bounds inside a captured tab bitmap, handling DPR and browser zoom.
 */
export function computeCropBox(
  imageWidth: number,
  imageHeight: number,
  rect: CaptureRegionRect
): PixelCropBox {
  const safeImgW = Math.max(1, Math.round(imageWidth));
  const safeImgH = Math.max(1, Math.round(imageHeight));

  const scaleX =
    rect.viewportWidth && rect.viewportWidth > 0
      ? safeImgW / rect.viewportWidth
      : rect.dpr && rect.dpr > 0
        ? rect.dpr
        : 1;
  const scaleY =
    rect.viewportHeight && rect.viewportHeight > 0 ? safeImgH / rect.viewportHeight : scaleX;

  const rawX = Math.round(rect.x * scaleX);
  const rawY = Math.round(rect.y * scaleY);
  const rawRight = Math.round((rect.x + rect.width) * scaleX);
  const rawBottom = Math.round((rect.y + rect.height) * scaleY);

  const sx = Math.max(0, Math.min(safeImgW - 1, rawX));
  const sy = Math.max(0, Math.min(safeImgH - 1, rawY));
  const right = Math.max(sx + 1, Math.min(safeImgW, rawRight));
  const bottom = Math.max(sy + 1, Math.min(safeImgH, rawBottom));

  return {
    sx,
    sy,
    sw: Math.max(1, right - sx),
    sh: Math.max(1, bottom - sy),
  };
}

/**
 * Fallback PNG region cropper in DOM context when Service Worker OffscreenCanvas is unavailable.
 */
export async function cropCapturedPngInDom(
  dataUrl: string,
  rect: CaptureRegionRect
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || !dataUrl) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load captured PNG'));
      el.src = dataUrl;
    });
    const box = computeCropBox(img.naturalWidth || img.width, img.naturalHeight || img.height, rect);
    const canvas = document.createElement('canvas');
    canvas.width = box.sw;
    canvas.height = box.sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh);
    const blob = await canvasToBlob(canvas, 'image/png');
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Compute element rect in viewport coordinates, accumulating same-origin iframe offsets when possible.
 * Returns `needsTopFrameOffset: true` when running inside a cross-origin iframe.
 */
export function getElementCaptureRect(el: Element): {
  rect: CaptureRegionRect;
  needsTopFrameOffset: boolean;
} {
  const box = el.getBoundingClientRect();
  let x = box.left;
  let y = box.top;
  let needsTopFrameOffset = false;
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;

  if (window !== window.top) {
    try {
      let win: Window = window;
      while (win !== win.parent) {
        const frameEl = win.frameElement;
        if (!frameEl) {
          needsTopFrameOffset = true;
          break;
        }
        const fRect = frameEl.getBoundingClientRect();
        x += fRect.left;
        y += fRect.top;
        win = win.parent;
      }
      if (!needsTopFrameOffset) {
        viewportWidth = win.innerWidth;
        viewportHeight = win.innerHeight;
      }
    } catch {
      needsTopFrameOffset = true;
    }
  }

  return {
    rect: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      dpr: window.devicePixelRatio || 1,
      viewportWidth,
      viewportHeight,
    },
    needsTopFrameOffset,
  };
}

/**
 * Sample an 8x8 grid (64 pixels) across an RGBA pixel buffer to detect blank / cleared WebGL frames
 * (either 100% transparent alpha === 0 or 0 RGB variance such as pure solid black/white).
 */
export function isRgbaBufferBlank(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): boolean {
  if (!data || width <= 0 || height <= 0 || data.length < width * height * 4) {
    return true;
  }

  const grid = 8;
  let nonTransparentCount = 0;
  let firstR = -1;
  let firstG = -1;
  let firstB = -1;
  let hasColorVariance = false;

  for (let gy = 0; gy < grid; gy++) {
    const py = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / grid));
    for (let gx = 0; gx < grid; gx++) {
      const px = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / grid));
      const offset = (py * width + px) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const a = data[offset + 3] ?? 0;

      if (a > 0) {
        nonTransparentCount++;
        if (firstR === -1) {
          firstR = r;
          firstG = g;
          firstB = b;
        } else if (
          Math.abs(r - firstR) > 2 ||
          Math.abs(g - firstG) > 2 ||
          Math.abs(b - firstB) > 2
        ) {
          hasColorVariance = true;
        }
      }
    }
  }

  if (nonTransparentCount === 0) return true;
  return !hasColorVariance;
}

/**
 * Inspect an exported PNG/canvas Blob using a fast 64x64 offscreen draw to detect blank WebGL frames
 * caused by `preserveDrawingBuffer: false`.
 */
export async function isImageBlobBlank(blob: Blob): Promise<boolean> {
  if (!blob || blob.size === 0) return true;

  const sampleSize = 64;

  // Fast path: createImageBitmap + OffscreenCanvas
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(sampleSize, sampleSize);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.clearRect(0, 0, sampleSize, sampleSize);
      ctx.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
      const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
      return isRgbaBufferBlank(imgData.data, sampleSize, sampleSize);
    } catch {
      // fall through to DOM Image fallback
    } finally {
      try {
        bitmap?.close();
      } catch {
        // ignore
      }
    }
  }

  // Fallback: HTMLImageElement + HTMLCanvasElement
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, sampleSize, sampleSize);
    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    return isRgbaBufferBlank(imgData.data, sampleSize, sampleSize);
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Sanitize raw SVG markup string:
 * - Ensures xmlns="http://www.w3.org/2000/svg" and optional fallback viewBox
 * - Strips <script>, <foreignObject>, <iframe>, <object>, <embed>, <applet>
 * - Strips inline on* event attributes and javascript:/vbscript:/data:text/html URIs
 * - Strips CSS expression() and javascript: url() patterns
 */
export function sanitizeSvgMarkup(rawSvg: string, fallbackViewBox?: string): string {
  if (!rawSvg || typeof rawSvg !== 'string') return '';

  let cleaned = rawSvg.trim();

  // Strip dangerous container elements and their inner contents
  const dangerousBlockTags = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'applet'];
  for (const tag of dangerousBlockTags) {
    const pairRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    const selfCloseRe = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    cleaned = cleaned.replace(pairRe, '').replace(selfCloseRe, '');
  }

  // Strip animation tags that target href or event handlers
  cleaned = cleaned.replace(
    /<(?:set|animate)\b[^>]*attributeName\s*=\s*["']\s*(?:on[a-z]+|(?:xlink:)?href)\s*["'][^>]*\/?>/gi,
    ''
  );

  // Strip inline on* event handler attributes (quoted or unquoted)
  cleaned = cleaned.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Strip javascript: / vbscript: / data:text/html URLs in href, xlink:href, src, action, formaction
  cleaned = cleaned.replace(
    /\s+(?:xlink:)?(?:href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^']*')/gi,
    ''
  );

  // Neutralize dangerous CSS expressions / javascript: url() inside style blocks or attributes
  cleaned = cleaned.replace(/expression\s*\([^)]*\)/gi, '');
  cleaned = cleaned.replace(/url\s*\(\s*["']?\s*(?:javascript|vbscript):[^)]*\)/gi, 'none');

  // Ensure root <svg> has xmlns
  if (/^<svg\b/i.test(cleaned) && !/^<svg\b[^>]*\bxmlns\s*=/i.test(cleaned)) {
    cleaned = cleaned.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Ensure root <svg> has viewBox when a fallback is available
  if (
    fallbackViewBox &&
    /^<svg\b/i.test(cleaned) &&
    !/^<svg\b[^>]*\bviewBox\s*=/i.test(cleaned)
  ) {
    cleaned = cleaned.replace(/^<svg\b/i, `<svg viewBox="${fallbackViewBox}"`);
  }

  return cleaned;
}

/**
 * Safely clone, strip dangerous nodes/attributes from an inline SVG element,
 * ensure xmlns + viewBox, and serialize to clean SVG markup.
 */
export function serializeSafeSvg(svg: SVGSVGElement | Element): string {
  const clone = svg.cloneNode(true) as Element;

  // Compute fallback viewBox from live element before detaching
  let fallbackViewBox: string | undefined;
  if (!clone.getAttribute('viewBox')) {
    try {
      const rect = svg.getBoundingClientRect();
      const attrW = parseFloat(svg.getAttribute('width') || '0');
      const attrH = parseFloat(svg.getAttribute('height') || '0');
      const w = Math.round(rect.width || attrW);
      const h = Math.round(rect.height || attrH);
      if (w > 0 && h > 0) {
        fallbackViewBox = `0 0 ${w} ${h}`;
      }
    } catch {
      // ignore
    }
  }

  // Remove dangerous elements in DOM tree first
  const dangerousSelectors = 'script, foreignObject, iframe, object, embed, applet';
  try {
    clone.querySelectorAll(dangerousSelectors).forEach((node) => node.remove());
  } catch {
    // ignore
  }

  // Strip unsafe attributes across root and all descendants
  const allNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (const node of allNodes) {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' || name === 'xlink:href' || name === 'src' || name === 'action' || name === 'formaction') &&
        /^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(val)
      ) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && /(?:expression\s*\(|javascript:|vbscript:)/i.test(val)) {
        node.removeAttribute(attr.name);
      }
    }
  }

  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('viewBox') && fallbackViewBox) {
    clone.setAttribute('viewBox', fallbackViewBox);
  }

  const serializer = new XMLSerializer();
  return sanitizeSvgMarkup(serializer.serializeToString(clone), fallbackViewBox);
}

/**
 * Convert inline SVG element to a sanitized SVG text Blob.
 */
export function svgToBlob(svg: SVGSVGElement): Blob {
  const source = serializeSafeSvg(svg);
  return new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * Remove noise elements (scripts, ads, navigation, sidebars, comments) from a container.
 */
export function cleanNoiseElements(root: Element, isDocPlatform = false): void {
  if (isDocPlatform) {
    // For rich doc editors, only remove non-visual technical tags; preserve all layout & block elements
    const technicalSelectors = ['script', 'noscript', 'style', 'link'];
    for (const sel of technicalSelectors) {
      try {
        root.querySelectorAll(sel).forEach((el) => el.remove());
      } catch {
        // ignore
      }
    }
    return;
  }

  const noiseSelectors = [
    'script',
    'noscript',
    'style',
    'link',
    'nav',
    'header:not(article header)',
    'footer:not(article footer)',
    'aside',
    '.sidebar',
    '#sidebar',
    '.comment',
    '.comments',
    '#comments',
    '.footer',
    '#footer',
    '.site-header',
    '#site-header',
    '.global-header',
    '.nav',
    '#nav',
    '.navigation',
    '.ads',
    '.advertisement',
    '.cookie-banner',
    '.popover',
    '.tooltip',
    '.dropdown-menu',
    '.doc-feedback',
    '.feedback-widget',
    '.social-share',
    '.like-button',
    '.print-hide',
  ];

  for (const sel of noiseSelectors) {
    try {
      const elements = root.querySelectorAll(sel);
      elements.forEach((el) => {
        // Protect headings, tables, or code blocks that might have accidental class overlap
        if (!['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'CODE', 'TABLE'].includes(el.tagName)) {
          // If the element contains headings, table, or code blocks, do not remove
          if (el.querySelector('h1, h2, h3, h4, h5, h6, table, pre, code')) return;
          // If the element contains substantial text (> 50 chars), keep it
          if ((el.textContent?.trim().length || 0) > 50) return;
          el.remove();
        }
      });
    } catch {
      // Ignore querySelector exceptions
    }
  }

  // Handle [aria-hidden="true"] separately: only remove if it doesn't contain readable text
  try {
    const ariaHidden = root.querySelectorAll('[aria-hidden="true"]');
    ariaHidden.forEach((el) => {
      if (!el.textContent?.trim()) {
        el.remove();
      }
    });
  } catch {
    // ignore
  }
}

/**
 * Wait helper with timeout
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
