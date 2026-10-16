import { createTurndownService, generateYamlFrontmatter } from '../markdown/turndown-rules';
import { sanitizeFilename, cleanNoiseElements, sleep } from '../../utils/dom-helpers';

export interface ApiExtractionResult {
  title: string;
  sanitizedTitle: string;
  markdown: string;
  format: 'openapi-spec' | 'dom-scraped';
  endpointsCount: number;
}

export interface SchemaFieldRow {
  path: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * Resolve JSON Pointer string within root OpenAPI specification.
 */
export function resolveRefPointer(ref: string, rootSpec: any): any {
  if (!ref || typeof ref !== 'string') return null;
  if (ref.startsWith('#/')) {
    const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current = rootSpec;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }
    return current;
  }
  return null;
}

/**
 * Dereference schema and $ref pointers with circular reference safety.
 */
export function dereferenceSchema(schema: any, rootSpec: any, seenRefs = new Set<string>(), depth = 0): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (depth > 8) return schema;

  if (schema.$ref && typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (seenRefs.has(ref)) {
      return {
        type: 'object',
        description: `[Circular: ${ref.split('/').pop()}]`,
      };
    }
    const resolved = resolveRefPointer(ref, rootSpec);
    if (resolved && typeof resolved === 'object') {
      const nextSeen = new Set(seenRefs);
      nextSeen.add(ref);
      return dereferenceSchema({ ...resolved, ...schema, $ref: undefined }, rootSpec, nextSeen, depth + 1);
    }
    return schema;
  }

  if (Array.isArray(schema.allOf)) {
    const merged: any = { type: 'object', properties: {}, required: [] };
    for (const item of schema.allOf) {
      const derefItem = dereferenceSchema(item, rootSpec, seenRefs, depth + 1);
      if (derefItem && typeof derefItem === 'object') {
        if (derefItem.properties) {
          Object.assign(merged.properties, derefItem.properties);
        }
        if (Array.isArray(derefItem.required)) {
          merged.required = Array.from(new Set([...merged.required, ...derefItem.required]));
        }
        if (derefItem.description && !merged.description) {
          merged.description = derefItem.description;
        }
      }
    }
    return merged;
  }

  if (schema.type === 'array' && schema.items) {
    return {
      ...schema,
      items: dereferenceSchema(schema.items, rootSpec, seenRefs, depth + 1),
    };
  }

  if (schema.properties && typeof schema.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      newProps[key] = dereferenceSchema(prop, rootSpec, seenRefs, depth + 1);
    }
    return {
      ...schema,
      properties: newProps,
    };
  }

  return schema;
}

/**
 * Flatten nested schema into dot-path rows (e.g. data.list[].id).
 */
export function flattenSchemaToRows(
  schema: any,
  rootSpec: any,
  prefix = '',
  seenRefs = new Set<string>(),
  depth = 0
): SchemaFieldRow[] {
  if (!schema || typeof schema !== 'object' || depth > 5) return [];
  const deref = dereferenceSchema(schema, rootSpec, seenRefs, depth);
  const rows: SchemaFieldRow[] = [];

  // Top-level array handling
  if (deref.type === 'array' && deref.items) {
    const itemType = deref.items.type || (deref.items.properties ? 'object' : 'any');
    rows.push({
      path: prefix ? `${prefix}[]` : 'items[]',
      type: `array<${itemType}>`,
      required: false,
      description: deref.description || '',
    });
    if (deref.items.properties) {
      rows.push(...flattenSchemaToRows(deref.items, rootSpec, prefix ? `${prefix}[]` : 'items[]', seenRefs, depth + 1));
    }
    return rows;
  }

  const props = deref.properties || {};
  const requiredList = Array.isArray(deref.required) ? deref.required : [];

  for (const [key, rawProp] of Object.entries(props)) {
    const prop = dereferenceSchema(rawProp, rootSpec, seenRefs, depth + 1);
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const isReq = requiredList.includes(key);

    let typeStr = prop.type || (prop.properties ? 'object' : 'string');
    if (prop.format) {
      typeStr += `(${prop.format})`;
    }
    if (prop.type === 'array') {
      const itemType = prop.items?.type || (prop.items?.properties ? 'object' : 'any');
      typeStr = `array<${itemType}>`;
    }

    let desc = (prop.description || '').replace(/\n/g, ' ').trim();
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      const enumStr = prop.enum.map((v: any) => `\`${v}\``).join(', ');
      desc += (desc ? ' | ' : '') + `可选值: ${enumStr}`;
    }
    if (prop.default !== undefined) {
      desc += (desc ? ' | ' : '') + `默认值: \`${JSON.stringify(prop.default)}\``;
    }

    rows.push({
      path: fullPath,
      type: typeStr,
      required: isReq,
      description: desc,
    });

    // Recurse into nested object properties
    if (prop.type === 'object' && prop.properties) {
      rows.push(...flattenSchemaToRows(prop, rootSpec, fullPath, seenRefs, depth + 1));
    } else if (prop.type === 'array' && prop.items?.properties) {
      rows.push(...flattenSchemaToRows(prop.items, rootSpec, `${fullPath}[]`, seenRefs, depth + 1));
    }
  }

  return rows;
}

/**
 * Auto-synthesize realistic Example JSON from dereferenced schema.
 */
export function synthesizeExampleFromSchema(schema: any, rootSpec: any, seenRefs = new Set<string>(), depth = 0): any {
  if (!schema || typeof schema !== 'object' || depth > 5) return null;
  const deref = dereferenceSchema(schema, rootSpec, seenRefs, depth);

  if (deref.example !== undefined) return deref.example;
  if (deref.default !== undefined) return deref.default;
  if (Array.isArray(deref.enum) && deref.enum.length > 0) return deref.enum[0];

  if (deref.type === 'array') {
    const itemExample = deref.items ? synthesizeExampleFromSchema(deref.items, rootSpec, seenRefs, depth + 1) : {};
    return itemExample !== null ? [itemExample] : [];
  }

  if (deref.type === 'object' || deref.properties) {
    const obj: Record<string, any> = {};
    const props = deref.properties || {};
    for (const [k, p] of Object.entries(props)) {
      obj[k] = synthesizeExampleFromSchema(p, rootSpec, seenRefs, depth + 1);
    }
    return obj;
  }

  switch (deref.type) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      if (deref.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (deref.format === 'date') return '2026-01-01';
      if (deref.format === 'email') return 'user@example.com';
      return 'string';
    default:
      return null;
  }
}

/**
 * Render SchemaFieldRow array into GFM table string.
 */
function renderFieldRowsToTable(rows: SchemaFieldRow[]): string {
  if (rows.length === 0) return '';
  const lines: string[] = [];
  lines.push('| Field | Type | Required | Description |');
  lines.push('| :--- | :--- | :--- | :--- |');
  for (const r of rows) {
    const req = r.required ? '**Yes**' : 'No';
    lines.push(`| \`${r.path}\` | \`${r.type}\` | ${req} | ${r.description} |`);
  }
  return lines.join('\n');
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

      // Merge Path-level and Operation-level parameters (Op params override Path params)
      const pathParams = (pathItem as any).parameters || [];
      const opParams = op.parameters || [];
      const paramMap = new Map<string, any>();
      for (const p of [...pathParams, ...opParams]) {
        const derefParam = dereferenceSchema(p, spec);
        if (derefParam?.name && derefParam?.in) {
          paramMap.set(`${derefParam.in}:${derefParam.name}`, derefParam);
        }
      }
      const allParams = Array.from(paramMap.values());

      // Filter non-body parameters (query, path, header, cookie)
      const nonBodyParams = allParams.filter((p) => p.in !== 'body');
      if (nonBodyParams.length > 0) {
        sections.push('### Request Parameters\n');
        sections.push('| Name | Located In | Type | Required | Description |');
        sections.push('| :--- | :--- | :--- | :--- | :--- |');
        for (const p of nonBodyParams) {
          const pType = p.schema?.type || p.type || 'string';
          const pReq = p.required ? '**Yes**' : 'No';
          const pDesc = (p.description || '').replace(/\n/g, ' ');
          sections.push(`| \`${p.name}\` | \`${p.in}\` | \`${pType}\` | ${pReq} | ${pDesc} |`);
        }
        sections.push('');
      }

      // Request Body: OpenAPI 3.x or Swagger 2.0 (in === 'body')
      let requestBodySchema: any = null;
      let requestBodyExample: any = null;

      if (op.requestBody) {
        const derefBody = dereferenceSchema(op.requestBody, spec);
        const content = derefBody.content || {};
        const jsonMediaType = content['application/json'] || Object.values(content)[0] as any;
        if (jsonMediaType?.schema) {
          requestBodySchema = dereferenceSchema(jsonMediaType.schema, spec);
        }
        if (jsonMediaType?.example) {
          requestBodyExample = jsonMediaType.example;
        }
      } else {
        const bodyParam = allParams.find((p) => p.in === 'body');
        if (bodyParam?.schema) {
          requestBodySchema = dereferenceSchema(bodyParam.schema, spec);
        }
      }

      if (requestBodySchema) {
        sections.push('### Request Body\n');
        const rows = flattenSchemaToRows(requestBodySchema, spec);
        if (rows.length > 0) {
          sections.push(renderFieldRowsToTable(rows) + '\n');
        }

        const exampleObj = requestBodyExample || synthesizeExampleFromSchema(requestBodySchema, spec);
        if (exampleObj !== null) {
          sections.push('**Example Payload**:');
          sections.push('```json');
          sections.push(JSON.stringify(exampleObj, null, 2));
          sections.push('```\n');
        }
      }

      // Responses
      const responses = op.responses || {};
      const responseEntries = Object.entries(responses);
      if (responseEntries.length > 0) {
        sections.push('### Responses\n');
        sections.push('| Status | Description | Content-Type |');
        sections.push('| :--- | :--- | :--- |');
        for (const [code, resp] of responseEntries) {
          const r = dereferenceSchema(resp, spec);
          const rDesc = (r.description || '').replace(/\n/g, ' ');
          const content = r.content || {};
          const mediaTypes = Object.keys(content).join(', ') || 'N/A';
          sections.push(`| \`${code}\` | ${rDesc} | \`${mediaTypes}\` |`);
        }
        sections.push('');

        // 2xx Response Schema and Example
        for (const [code, resp] of responseEntries) {
          if (!/^2\d\d$/.test(code) && code !== 'default') continue;
          const r = dereferenceSchema(resp, spec);
          const content = r.content || {};
          const jsonContent = content['application/json'] || Object.values(content)[0] as any;
          const respSchema = jsonContent?.schema || r.schema;

          if (respSchema) {
            const derefRespSchema = dereferenceSchema(respSchema, spec);
            const rows = flattenSchemaToRows(derefRespSchema, spec);
            if (rows.length > 0) {
              sections.push(`#### Response Properties (\`${code}\`)\n`);
              sections.push(renderFieldRowsToTable(rows) + '\n');
            }

            const exampleObj = jsonContent?.example || r.example || synthesizeExampleFromSchema(derefRespSchema, spec);
            if (exampleObj !== null) {
              sections.push(`#### Response Example (\`${code}\`)`);
              sections.push('```json');
              sections.push(JSON.stringify(exampleObj, null, 2));
              sections.push('```\n');
            }
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

  await sleep(400);
}

/**
 * Normalize multi-div pseudo-tables into real HTML tables.
 */
export function normalizePseudoTables(root: HTMLElement): void {
  const customTables = root.querySelectorAll('.parameters, .responses-table, [role="table"]');
  customTables.forEach((tableEl) => {
    if (tableEl.tagName === 'TABLE') return;

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
 * Request OpenAPI spec directly from Main World context via window.postMessage.
 */
function requestOpenApiSpecFromMainWorld(timeoutMs = 2000): Promise<any | null> {
  return new Promise((resolve) => {
    const requestId = `ps_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let settled = false;

    const handler = (event: MessageEvent) => {
      if (
        event.source !== window ||
        !event.data ||
        event.data.source !== 'PAGESPEC_PAGE' ||
        event.data.type !== 'SNIFF_OPENAPI_SPEC_RESPONSE' ||
        event.data.requestId !== requestId
      ) {
        return;
      }
      settled = true;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      resolve(event.data.spec || null);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', handler);
        resolve(null);
      }
    }, timeoutMs);

    window.addEventListener('message', handler);
    window.postMessage(
      {
        source: 'PAGESPEC_CONTENT',
        type: 'SNIFF_OPENAPI_SPEC',
        requestId,
      },
      '*'
    );
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

  // 1. Attempt to sniff in-page Swagger / OpenAPI JSON directly from Main World
  let foundSpec: any = null;
  try {
    foundSpec = await requestOpenApiSpecFromMainWorld(1500);
  } catch {
    // ignore sniffer error
  }

  // 2. Check embedded JSON scripts if Main World sniffing did not yield spec
  if (!foundSpec || (!foundSpec.paths && !foundSpec.openapi && !foundSpec.swagger)) {
    const specElement = document.querySelector('script[type="application/json"]#swagger-data, script#__NEXT_DATA__');
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

  // 3. Engine B: DOM Extraction & Accordion Expansion
  onProgress?.(30, 100, '未发现直接 JSON 规范，开始展开折叠面板并解析 DOM...');
  await preExpandApiAccordions(document);

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
