import TurndownService from 'turndown';
import { gfm } from '@truto/turndown-plugin-gfm';

/**
 * Configure and create TurndownService with GFM and specialized rules for PRDs & API Docs.
 */
export function createTurndownService(options?: TurndownService.Options): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    ...options,
  });

  // Enable GFM (tables, strikethrough, task lists, highlighted code blocks)
  service.use(gfm);

  // 1. API HTTP Method Badges Rule
  service.addRule('apiMethodBadge', {
    filter: (node) => {
      const el = node as HTMLElement;
      if (!el || !el.textContent) return false;
      const text = el.textContent.trim().toUpperCase();
      const isMethodText = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(text);
      if (!isMethodText) return false;

      // Check if styled like a badge/method indicator in Swagger, Redoc, Knife4j, Apifox, etc.
      const className = (el.className || '').toString().toLowerCase();
      return (
        className.includes('method') ||
        className.includes('opblock-summary-method') ||
        className.includes('http-') ||
        className.includes('badge') ||
        className.includes('tag') ||
        el.tagName === 'SPAN' ||
        el.tagName === 'BUTTON'
      );
    },
    replacement: (content) => {
      const method = content.trim().toUpperCase();
      return ` \`[${method}]\` `;
    },
  });

  // 2. Callout / Alert Boxes Rule (Notion, Feishu, Confluence -> GFM Alerts)
  service.addRule('calloutBoxes', {
    filter: (node) => {
      const el = node as HTMLElement;
      if (!el) return false;
      const className = (el.className || '').toString().toLowerCase();
      return (
        className.includes('callout') ||
        className.includes('confluence-information-macro') ||
        className.includes('alert') ||
        className.includes('info-box') ||
        className.includes('tip-box') ||
        className.includes('warning-box')
      );
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const className = (el.className || '').toString().toLowerCase();
      let alertType = 'NOTE';
      if (className.includes('tip') || className.includes('success')) {
        alertType = 'TIP';
      } else if (className.includes('warn') || className.includes('caution')) {
        alertType = 'WARNING';
      } else if (className.includes('danger') || className.includes('error')) {
        alertType = 'CAUTION';
      } else if (className.includes('important')) {
        alertType = 'IMPORTANT';
      }

      const lines = content.trim().split('\n').map((line) => `> ${line}`).join('\n');
      return `\n\n> [!${alertType}]\n${lines}\n\n`;
    },
  });

  // 3. Code Blocks with Language Detection
  service.addRule('enhancedCodeBlock', {
    filter: (node) => {
      return node.nodeName === 'PRE' && !!node.querySelector('code');
    },
    replacement: (_content, node) => {
      const pre = node as HTMLElement;
      const code = pre.querySelector('code') || pre;
      const className = `${pre.className || ''} ${code.className || ''}`.toLowerCase();
      
      let lang = '';
      const match = className.match(/(?:language|lang|highlight)-([a-z0-9_-]+)/i);
      if (match && match[1]) {
        lang = match[1];
      } else if (code.getAttribute('data-lang')) {
        lang = code.getAttribute('data-lang') || '';
      }

      // Check if text looks like JSON
      const rawText = code.textContent || '';
      if (!lang && (rawText.trim().startsWith('{') || rawText.trim().startsWith('['))) {
        try {
          JSON.parse(rawText.trim());
          lang = 'json';
        } catch {
          // not strictly json
        }
      }

      return `\n\n\`\`\`${lang}\n${rawText.replace(/\n+$/, '')}\n\`\`\`\n\n`;
    },
  });

  // 4. Image Reference Rule (preserving relative path and title)
  service.addRule('imagePreserve', {
    filter: 'img',
    replacement: (_content, node) => {
      const img = node as HTMLImageElement;
      const alt = (img.alt || '').replace(/[[\]]/g, '\\$&');
      const src = img.getAttribute('src') || '';
      const title = img.title ? ` "${img.title.replace(/"/g, '\\"')}"` : '';
      if (!src) return '';
      return `![${alt}](${src}${title})`;
    },
  });

  return service;
}

/**
 * Generate YAML Frontmatter header for Markdown documents.
 */
export function generateYamlFrontmatter(metadata: Record<string, any>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      // Escape multiline or special quotes
      if (value.includes('\n') || value.includes('"') || value.includes(':')) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${key}: "${value}"`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${JSON.stringify(item)}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [subKey, subVal] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${JSON.stringify(subVal)}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '\n');
  return lines.join('\n');
}
