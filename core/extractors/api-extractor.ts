import { createTurndownService, generateYamlFrontmatter } from '../markdown/turndown-rules';
import { sanitizeFilename, cleanNoiseElements, sleep } from '../../utils/dom-helpers';

export interface ApiExtractionResult {
  title: string;
  sanitizedTitle: string;
  markdown: string;
  format: 'openapi-spec' | 'dom-scraped';
  endpointsCount: number;
}

/**
 * Convert an OpenAPI 2.0 (Swagger) or OpenAPI 3.0 specification object into Markdown.
 */
export function convertOpenApiJsonToMarkdown(spec: any, pageUrl: string): string {
  const title = spec.info?.title || 'API Specification';
  const version = spec.info?.version || '1.0.0';
  const description = spec.info?.description || '';
  const basePath = spec.basePath || '';
  const servers = spec.servers ? spec.servers.map((s: any) => s.url).join(', ') : basePath || 'N/A';

  let endpointsCount = 0;
  const sections: string[] = [];

  sections.push(`# ${title} (v${version})\n`);
  if (description) {
    sections.push(`${description}\n`);
  }
  sections.push(`- **Base URL / Servers**: \`${servers}\``);
  sections.push(`- **Spec Version**: ${spec.openapi ? `OpenAPI ${spec.openapi}` : `Swagger ${spec.swagger || '2.0'}`}\n`);
  sections.push('---\n');

  const paths = spec.paths || {};
  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of ['get', 'post', 'put', 'delete', 'patch', 'options', 'head']) {
      const op = (pathItem as any)[method];
      if (!op) continue;
      endpointsCount++;

      const upperMethod = method.toUpperCase();
      const summary = op.summary || op.operationId || '';
      const opDesc = op.description || '';

      sections.push(`## \`[${upperMethod}]\` ${pathStr}`);
      if (summary) sections.push(`**${summary}**\n`);
      if (opDesc && opDesc !== summary) sections.push(`${opDesc}\n`);

      // Parameters (query, path, header, cookie)
      const params = op.parameters || (pathItem as any).parameters || [];
      if (Array.isArray(params) && params.length > 0) {
        sections.push('### Request Parameters\n');
        sections.push('| Name | Located In | Type | Required | Description |');
        sections.push('| :--- | :--- | :--- | :--- | :--- |');
        for (const p of params) {
          const pType = p.schema?.type || p.type || 'string';
          const pReq = p.required ? '**Yes**' : 'No';
          const pDesc = (p.description || '').replace(/\n/g, ' ');
          sections.push(`| \`${p.name}\` | \`${p.in}\` | \`${pType}\` | ${pReq} | ${pDesc} |`);
        }
        sections.push('');
      }

      // Request Body (OpenAPI 3.x)
      if (op.requestBody) {
        sections.push('### Request Body\n');
        const content = op.requestBody.content || {};
        const jsonMediaType = content['application/json'] || Object.values(content)[0] as any;
        if (jsonMediaType?.schema) {
          sections.push('**Schema**:');
          sections.push('```json');
          sections.push(JSON.stringify(jsonMediaType.schema, null, 2));
          sections.push('```\n');
        }
        if (jsonMediaType?.example) {
          sections.push('**Example Payload**:');
          sections.push('```json');
          sections.push(JSON.stringify(jsonMediaType.example, null, 2));
          sections.push('```\n');
        }
      }

      // Responses
      const responses = op.responses || {};
      if (Object.keys(responses).length > 0) {
        sections.push('### Responses\n');
        sections.push('| Status | Description | Content-Type |');
        sections.push('| :--- | :--- | :--- |');
        for (const [code, resp] of Object.entries(responses)) {
          const r = resp as any;
          const rDesc = (r.description || '').replace(/\n/g, ' ');
          const content = r.content || {};
          const mediaTypes = Object.keys(content).join(', ') || 'N/A';
          sections.push(`| \`${code}\` | ${rDesc} | \`${mediaTypes}\` |`);
        }
        sections.push('');

        // Response Examples
        for (const [code, resp] of Object.entries(responses)) {
          const r = resp as any;
          const jsonContent = r.content?.['application/json'];
          if (jsonContent?.example || jsonContent?.schema) {
            sections.push(`#### Response Example (\`${code}\`)`);
            sections.push('```json');
            sections.push(JSON.stringify(jsonContent.example || jsonContent.schema, null, 2));
            sections.push('```\n');
          }
        }
      }

      sections.push('---\n');
    }
  }

  const frontmatter = generateYamlFrontmatter({
    title,
    version,
    source_url: pageUrl,
    extracted_at: new Date().toISOString(),
    generator: 'PageSpec-OpenAPI-Engine',
    endpoints_count: endpointsCount,
  });

  return `${frontmatter}\n${sections.join('\n')}`;
}

/**
 * Expand collapsible accordions and operations across Swagger, Knife4j, Apifox, and Redoc.
 */
export async function preExpandApiAccordions(root: Document | Element = document): Promise<void> {
  // Common expandable button selectors
  const expandSelectors = [
    // Swagger UI
    '.opblock-summary',
    '.models-control',
    '.model-box-control',
    // Knife4j
    '.knife4j-menu-item',
    '.ant-collapse-header',
    // Apifox / YApi
    '.api-tab',
    '.collapse-header',
    '.ant-table-row-expand-icon-collapsed',
    '[aria-expanded="false"]',
  ];

  for (const selector of expandSelectors) {
    try {
      const elements = root.querySelectorAll(selector);
      elements.forEach((el) => {
        if (el instanceof HTMLElement) {
          try {
            el.click();
          } catch {
            // ignore click issues
          }
        }
      });
    } catch {
      // ignore selector errors
    }
  }

  // Small delay for DOM rendering / animations to finish
  await sleep(400);
}

/**
 * Normalize multi-div pseudo-tables (e.g. Swagger parameter rows, Knife4j grids) into real HTML tables.
 */
export function normalizePseudoTables(root: HTMLElement): void {
  // Convert elements with role="table" or class table-like layouts to standard <table>
  const customTables = root.querySelectorAll('.parameters, .responses-table, [role="table"]');
  customTables.forEach((tableEl) => {
    if (tableEl.tagName === 'TABLE') return;

    // Check for row children
    const rows = tableEl.querySelectorAll('[role="row"], .parameter__row, .response');
    if (rows.length === 0) return;

    const table = document.createElement('table');
    const tbody = document.createElement('tbody');

    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const cells = row.querySelectorAll('[role="cell"], [role="columnheader"], td, th, .parameters-col_name, .parameters-col_description');

      cells.forEach((cell) => {
        const cellTag = rowIndex === 0 || cell.getAttribute('role') === 'columnheader' ? 'th' : 'td';
        const td = document.createElement(cellTag);
        td.innerHTML = cell.innerHTML.trim();
        tr.appendChild(td);
      });

      if (tr.children.length > 0) {
        tbody.appendChild(tr);
      }
    });

    if (tbody.children.length > 0) {
      table.appendChild(tbody);
      tableEl.replaceWith(table);
    }
  });
}

/**
 * Extract structured API documentation as clean Markdown.
 */
export async function extractApiDocumentation(
  onProgress?: (pct: number, total: number, msg: string) => void
): Promise<ApiExtractionResult> {
  const rawTitle = document.title?.trim() || 'API_Documentation';
  const cleanTitle = sanitizeFilename(rawTitle, 'API_Spec');
  const sourceUrl = window.location.href;

  onProgress?.(10, 100, '正在嗅探页面 OpenAPI / Swagger 数据源...');

  // 1. Attempt to find in-page Swagger / OpenAPI JSON specifications
  let foundSpec: any = null;

  // Check window.__REDOC_STATE__ or Swagger UI spec via custom event / global
  const specElement = document.querySelector('script[type="application/json"]#swagger-data, #swagger-ui, script#__NEXT_DATA__');
  if (specElement && specElement.textContent) {
    try {
      const parsed = JSON.parse(specElement.textContent);
      if (parsed.paths || parsed.openapi || parsed.swagger) {
        foundSpec = parsed;
      }
    } catch {
      // ignore json parse error
    }
  }

  // If OpenAPI JSON spec was found, use Engine A
  if (foundSpec && (foundSpec.paths || foundSpec.openapi || foundSpec.swagger)) {
    onProgress?.(50, 100, '发现底层 OpenAPI 规范，生成精确结构化 Markdown...');
    const markdown = convertOpenApiJsonToMarkdown(foundSpec, sourceUrl);
    const endpointsCount = Object.keys(foundSpec.paths || {}).length;
    onProgress?.(100, 100, 'OpenAPI 文档转换完成');
    return {
      title: rawTitle,
      sanitizedTitle: cleanTitle,
      markdown,
      format: 'openapi-spec',
      endpointsCount,
    };
  }

  // 2. Engine B: DOM Extraction & Accordion Expansion
  onProgress?.(30, 100, '未发现直接 JSON 规范，开始展开折叠面板并解析 DOM...');
  await preExpandApiAccordions(document);

  // Find API container (Swagger, Knife4j, Redoc, Apifox, or generic main)
  const apiContainerSelectors = [
    '.swagger-ui',
    '.redoc-wrap',
    '.knife4j-swagger-desktop',
    '#knife4j-app',
    '.apifox-container',
    '.api-content',
    '#main-content',
    'article',
    'main',
    'body',
  ];

  let targetContainer: Element | null = null;
  for (const selector of apiContainerSelectors) {
    const el = document.querySelector(selector);
    if (el && (el.textContent?.trim().length || 0) > 50) {
      targetContainer = el;
      break;
    }
  }

  if (!targetContainer) {
    targetContainer = document.body;
  }

  onProgress?.(60, 100, '正在清洗 DOM 并规范化接口表格...');

  const cloned = targetContainer.cloneNode(true) as HTMLElement;
  cleanNoiseElements(cloned);
  normalizePseudoTables(cloned);

  onProgress?.(80, 100, '正在通过 Turndown API 规则转换为 Markdown...');

  const turndown = createTurndownService();
  const rawMarkdown = turndown.turndown(cloned.innerHTML);

  // Count roughly how many endpoints were extracted
  const methodMatches = rawMarkdown.match(/`\[(GET|POST|PUT|DELETE|PATCH)\]`/gi);
  const endpointsCount = methodMatches ? methodMatches.length : 1;

  const frontmatter = generateYamlFrontmatter({
    title: rawTitle,
    source_url: sourceUrl,
    extracted_at: new Date().toISOString(),
    generator: 'PageSpec-DOM-Engine',
    endpoints_count: endpointsCount,
  });

  const fullMarkdown = `${frontmatter}\n# ${rawTitle}\n\n${rawMarkdown.trim()}\n`;

  onProgress?.(100, 100, 'API 文档提取完成');

  return {
    title: rawTitle,
    sanitizedTitle: cleanTitle,
    markdown: fullMarkdown,
    format: 'dom-scraped',
    endpointsCount,
  };
}
