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
 * Convert inline SVG element to an SVG text Blob.
 */
export function svgToBlob(svg: SVGSVGElement): Blob {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svg);
  if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
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
