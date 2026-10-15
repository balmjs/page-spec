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
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-actualsrc'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-url'),
    img.currentSrc,
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
    if (candidate && candidate.trim() && !candidate.startsWith('data:image/svg+xml;base64,PHN2Zy') && candidate !== 'about:blank') {
      try {
        return new URL(candidate.trim(), window.location.href).href;
      } catch {
        return candidate.trim();
      }
    }
  }

  return null;
}

/**
 * Check if an image or visual element is an essential prototype/content graphic rather than a tiny icon/avatar.
 */
export function isSignificantVisualElement(el: Element, minSize = 32): boolean {
  if (el instanceof HTMLImageElement) {
    const width = el.naturalWidth || el.width || el.getBoundingClientRect().width;
    const height = el.naturalHeight || el.height || el.getBoundingClientRect().height;

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
    return (el.width >= minSize || rect.width >= minSize) && (el.height >= minSize || rect.height >= minSize);
  }

  if (el instanceof SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const w = el.width?.baseVal?.value || rect.width;
    const h = el.height?.baseVal?.value || rect.height;
    return w >= minSize && h >= minSize;
  }

  return true;
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
