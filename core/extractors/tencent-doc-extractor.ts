import { sanitizeFilename } from '../../utils/dom-helpers';
import { generateYamlFrontmatter } from '../markdown/turndown-rules';
import type { BundleAsset } from '../bundler/zip-builder';
import type { PrdExtractionResult, ExtractedAssetMeta } from './prd-extractor';

export function isTencentDoc(url: string = window.location.href): boolean {
  try {
    const host = new URL(url).hostname;
    return host.includes('doc.weixin.qq.com') || host.includes('docs.qq.com');
  } catch {
    return false;
  }
}

interface ImageItem {
  url: string;
  width?: number | null;
  height?: number | null;
  descr?: string;
}

interface ListFormatMeta {
  isList: boolean;
  ilvl: number;
  numId: number | string;
  isOrdered: boolean;
}

interface LineChunk {
  raw: string;
  startPos: number;
  endPos: number;
}

interface ParagraphFormatInfo {
  heading?: number;
  list?: ListFormatMeta;
  bold?: boolean;
}

/**
 * Inspect Word OpenXML numbering definitions from clientVars if present
 */
function getNumberingFormat(
  numberingDefs: any,
  numId: number | string,
  ilvl: number
): { isOrdered: boolean; format: string } {
  try {
    if (!numberingDefs) return { isOrdered: true, format: 'decimal' };
    const numObj = numberingDefs[numId] || numberingDefs[`num_${numId}`];
    const abstractNumId = numObj?.abstractNumId?.val ?? numObj?.abstractNumId;
    const abstractObj =
      abstractNumId != null
        ? numberingDefs.abstractNum?.[abstractNumId] || numberingDefs[abstractNumId]
        : numObj;

    const lvlObj = abstractObj?.levels?.[ilvl] || abstractObj?.lvl?.[ilvl] || numObj?.levels?.[ilvl];
    const fmt = String(lvlObj?.numFmt?.val || lvlObj?.numFmt || '').toLowerCase();

    if (fmt.includes('bullet') || fmt === 'none') {
      return { isOrdered: false, format: 'bullet' };
    }
    return { isOrdered: true, format: fmt || 'decimal' };
  } catch {
    return { isOrdered: true, format: 'decimal' };
  }
}

/**
 * Extract paragraph properties (Heading, List, Indent) from mutation payload
 */
function parseParagraphFormats(
  pr: any,
  numberingDefs: any,
  nestedNumIds?: Set<string>
): ParagraphFormatInfo {
  const result: ParagraphFormatInfo = {};
  if (!pr) return result;

  const pPr = pr.paragraph || pr.p || pr.pPr || pr;
  const numPr = pPr.numPr || pr.numPr || pPr.listPr || pr.listPr || pr.paragraph?.numPr;
  const isExplicitBullet = Boolean(
    pPr.bullet || pr.bullet || pPr.bllt || pr.bllt ||
    pPr.listType === 'bullet' || pr.listType === 'bullet' ||
    pPr.listType === 1 || pr.listType === 1 ||
    pPr.ul || pr.ul
  );
  const isExplicitOrdered = Boolean(
    pPr.ol || pr.ol ||
    pPr.listType === 'ordered' || pr.listType === 'ordered' ||
    pPr.listType === 2 || pr.listType === 2 ||
    pPr.num || pr.num
  );

  const pStyle = String(pPr.pStyle?.val || pPr.pStyle || pr.pStyle?.val || pr.pStyle || '').toLowerCase();
  const outlineLvl = pPr.outlineLvl?.val ?? pPr.outlineLvl ?? pr.outlineLvl?.val ?? pr.outlineLvl;
  const indLeft = pPr.ind?.left || pPr.ind?.val || pr.ind?.left || 0;

  // 1. Heading Detection
  if (pStyle === 'rdbvau' || pStyle.includes('title')) {
    result.heading = 1;
  } else if (typeof outlineLvl === 'number' && outlineLvl >= 0 && outlineLvl <= 5) {
    result.heading = outlineLvl + 1;
  } else if (
    pStyle.includes('heading 1') ||
    pStyle === '1' ||
    pStyle.includes('标题 1') ||
    pStyle.includes('标题1')
  ) {
    result.heading = 1;
  } else if (
    pStyle.includes('heading 2') ||
    pStyle === '2' ||
    pStyle.includes('标题 2') ||
    pStyle.includes('标题2')
  ) {
    result.heading = 2;
  } else if (
    pStyle.includes('heading 3') ||
    pStyle === '3' ||
    pStyle.includes('标题 3') ||
    pStyle.includes('标题3')
  ) {
    result.heading = 3;
  } else if (
    pStyle.includes('heading 4') ||
    pStyle === '4' ||
    pStyle.includes('标题 4') ||
    pStyle.includes('标题4')
  ) {
    result.heading = 4;
  } else if (
    pStyle.includes('heading 5') ||
    pStyle === '5' ||
    pStyle.includes('标题 5') ||
    pStyle.includes('标题5')
  ) {
    result.heading = 5;
  } else if (
    pStyle.includes('heading 6') ||
    pStyle === '6' ||
    pStyle.includes('标题 6') ||
    pStyle.includes('标题6')
  ) {
    result.heading = 6;
  } else if (
    pStyle &&
    pStyle !== 'ablt93' &&
    pStyle !== 'normal' &&
    pStyle !== 'none'
  ) {
    // Custom Tencent Docs heading style (3cwx6c, 9aeyty, zs6grr, 01egs4, aa6oxc, 88lp86, 0tdzim, etc.)
    const ilvl = numPr?.ilvl?.val ?? numPr?.ilvl;
    if (typeof ilvl === 'number') {
      result.heading = ilvl === 0 ? 2 : ilvl === 1 ? 3 : Math.min(6, ilvl + 2);
    } else {
      result.heading = 2;
    }
  }

  // 1.3 Font size fallback for headings
  const run = pr.run || pr.rPr || pPr.rPr;
  if (run?.sz && !result.heading) {
    const rawSz = run.sz.val ?? run.sz;
    const sz = typeof rawSz === 'number' ? rawSz : parseInt(String(rawSz), 10) || 0;
    let pt = sz;
    if (sz >= 100) pt = sz / 20; // dxa to pt
    else if (sz >= 20) pt = sz / 2; // half-points to pt

    if (pt >= 22) result.heading = 1;
    else if (pt >= 16) result.heading = 2;
    else if (pt >= 14) result.heading = 3;
    else if (pt >= 13) result.heading = 4;
  }

  // 2. List Detection
  const hasListPr = Boolean(
    numPr ||
    isExplicitBullet ||
    isExplicitOrdered ||
    pPr.list ||
    pr.list ||
    pStyle.includes('list') ||
    pStyle.includes('bullet') ||
    pStyle.includes('number') ||
    indLeft >= 720
  );

  if (hasListPr && !result.heading) {
    let ilvl = 0;
    if (typeof numPr?.ilvl?.val === 'number') ilvl = numPr.ilvl.val;
    else if (typeof numPr?.ilvl === 'number') ilvl = numPr.ilvl;
    else if (typeof pr.lvl === 'number') ilvl = pr.lvl;
    else if (typeof pPr.lvl === 'number') ilvl = pPr.lvl;
    else if (typeof pr.level === 'number') ilvl = pr.level;
    else if (typeof pPr.level === 'number') ilvl = pPr.level;
    else if (indLeft >= 720) ilvl = Math.min(5, Math.floor(indLeft / 720));

    let numId: number | string = 1;
    const rawNumId = numPr?.numId?.val ?? numPr?.numId ?? pr.numId;
    if (rawNumId != null) {
      numId = rawNumId;
    }

    const numFmt = String(numPr?.numFmt?.val || numPr?.numFmt || '').toLowerCase();
    let isOrdered =
      isExplicitOrdered ||
      (!isExplicitBullet && !numFmt.includes('bullet') && !pStyle.includes('bullet'));

    if (nestedNumIds && nestedNumIds.has(String(numId))) {
      isOrdered = true;
    } else if (numberingDefs && numId) {
      const numInfo = getNumberingFormat(numberingDefs, numId, ilvl);
      isOrdered = numInfo.isOrdered;
    } else if (!isExplicitOrdered && !isExplicitBullet) {
      isOrdered = false;
    }

    result.list = {
      isList: true,
      ilvl: Math.max(0, ilvl),
      numId,
      isOrdered,
    };
  }

  return result;
}

/**
 * Detect structural headings in PRD documents (e.g. "1. 需求背景", "2. 原型附件", "附：...")
 * so they are never misclassified as body list items.
 */
function detectSectionHeading(lineText: string): number {
  const t = lineText.trim();
  if (!t || t.length > 50) return 0;

  // Major Level 2 Headings (一、需求背景, 二、功能设计)
  if (/^[一二三四五六七八九十]+[、.]\s*\S+/.test(t)) {
    return 2;
  }

  // Major Level 2 Prefix ("附：...", "附录：...")
  if (/^附[录件]?[:：]\s*\S+/.test(t)) {
    return 2;
  }

  // Level 2 Headings ("1. 需求背景", "2、原型附件", "3. 需求详情")
  if (/^[1-9]\d?[、.]\s*[^。；;!！?？\n]{1,25}$/.test(t)) {
    if (
      /(?:需求|原型|业务|功能|逻辑|说明|背景|概述|详情|附件|架构|接口|清单|数据|流程|权限|规则|附录|版本|目标|场景|设计|规范|交互)/.test(
        t
      )
    ) {
      return 2;
    }
  }

  // Level 3 Headings ("(1) 交互逻辑", "1.1 功能说明", "（一）设计规范")
  if (
    /^(?:[（(][1-9一二三四五六七八九十]+[)）]|[1-9]\.[1-9]\d?[.、])\s*[^。；;!！?？\n]{1,25}$/.test(
      t
    )
  ) {
    return 3;
  }

  return 0;
}

interface ContextualListResult {
  isList: boolean;
  isOrdered: boolean;
  level: number;
  itemContent: string;
}

/**
 * Contextual bullet list detection for standalone status lists.
 */
function detectContextualList(
  lineText: string,
  _sectionHeading?: string
): ContextualListResult | null {
  const t = lineText.trim();
  if (!t) return null;

  // Sibling bullet items:
  // "完全选中：复选框为对钩", "未选中：复选框为空", "部分选中：复选框为横杠或填充状态"
  if (/^(?:完全选中|未选中|部分选中|部分勾选|全部勾选|默认选中|完全勾选)[:：]/.test(t)) {
    return {
      isList: true,
      isOrdered: false,
      level: 0,
      itemContent: t,
    };
  }

  return null;
}

/**
 * Extract authenticated Tencent Docs (doc.weixin.qq.com / docs.qq.com) directly
 * via its internal opendoc API and mutations AST into standard Markdown & local assets.
 */
export async function extractTencentDocBundle(
  onProgress?: (current: number, total: number, message: string) => void
): Promise<PrdExtractionResult> {
  onProgress?.(5, 100, '正在识别腾讯文档标识与鉴权参数...');

  const urlParams = new URLSearchParams(window.location.search);
  const scode = urlParams.get('scode') || '';
  const pathParts = window.location.pathname.split('/');
  const docId = urlParams.get('id') || pathParts[pathParts.length - 1];

  if (!docId) {
    throw new Error('未能从当前腾讯文档 URL 中解析出有效 docId');
  }

  onProgress?.(15, 100, '正在请求腾讯文档数据接口 (带会话认证)...');

  const apiUrl = `/dop-api/opendoc?scode=${scode}&id=${docId}&doc_chunk_flag=1&normal=1&noEscape=1&outformat=1&t=${Date.now()}`;
  const resp = await fetch(apiUrl, { credentials: 'include' });
  if (!resp.ok) {
    throw new Error(`腾讯文档接口请求失败: HTTP ${resp.status}（请确认已在网页中登录且拥有查看权限）`);
  }

  const apiData = await resp.json();
  const title = apiData.clientVars?.title || apiData.clientVars?.proTitle || document.title || '腾讯文档';
  const cleanTitle = sanitizeFilename(title, 'PRD');
  const creator = apiData.clientVars?.userName || apiData.clientVars?.ownerInfo?.ownerNick || '未知作者';
  const warnings: string[] = [];

  onProgress?.(30, 100, '正在解析在线文档 AST 结构、列表序号与表格...');

  // Parse all text chunks & commands
  const textArray = apiData.clientVars?.collab_client_vars?.initialAttributedText?.text || [];
  const textData = textArray[0];
  if (!textData || !textData.commands || !textData.commands[0]?.mutations) {
    throw new Error('未能从接口数据中读取到正文内容（可能需要登录或文档已被加密）');
  }

  // Aggregate all mutations across all commands in all text objects
  const allMutations: any[] = [];
  for (const textObj of textArray) {
    for (const cmd of textObj.commands || []) {
      if (Array.isArray(cmd.mutations)) {
        allMutations.push(...cmd.mutations);
      }
    }
  }

  const rawText: string = textData.commands[0].mutations[0]?.s || allMutations[0]?.s || '';

  const collabVars = apiData.clientVars?.collab_client_vars || {};
  const numberingDefs = collabVars.numbering || apiData.clientVars?.numbering || null;

  // Pre-scan all mutations to find which numIds contain nested sub-items (ilvl >= 1)
  const nestedNumIds = new Set<string>();
  for (const m of allMutations) {
    if (!m) continue;
    const pr = m.pr || m.pPr || m.rPr;
    if (!pr) continue;
    const pPr = pr.paragraph || pr.p || pr.pPr || pr;
    const numPr = pPr.numPr || pr.numPr || pr.paragraph?.numPr;
    const nid = String(numPr?.numId?.val ?? numPr?.numId ?? '');
    const ilvl = numPr?.ilvl?.val ?? numPr?.ilvl ?? 0;
    if (nid && ilvl >= 1) {
      nestedNumIds.add(nid);
    }
  }

  // Split lines first to know exact paragraph counts and character bounds
  const lines: LineChunk[] = [];
  const newlineRegex = /\r\n|\r|\n/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = newlineRegex.exec(rawText)) !== null) {
    lines.push({
      raw: rawText.substring(lastIdx, match.index),
      startPos: lastIdx,
      endPos: match.index,
    });
    lastIdx = newlineRegex.lastIndex;
  }
  if (lastIdx < rawText.length) {
    lines.push({
      raw: rawText.substring(lastIdx),
      startPos: lastIdx,
      endPos: rawText.length,
    });
  }

  // Dual format maps:
  // 1. paragraphFormatMap: indexed by paragraph index (0..lines.length-1)
  // 2. charFormatMap: indexed by character offset in rawText
  const paragraphFormatMap: Record<number, ParagraphFormatInfo> = {};
  const charFormatMap: Record<
    number,
    {
      heading?: number;
      bold?: boolean;
      italic?: boolean;
      strike?: boolean;
      code?: boolean;
      list?: ListFormatMeta;
    }
  > = {};
  function findLineIndexByCharPos(pos: number): number {
    for (let idx = 0; idx < lines.length; idx++) {
      if (pos >= lines[idx]!.startPos && pos <= lines[idx]!.endPos) {
        return idx;
      }
    }
    return -1;
  }

  const imageMap: Record<number, ImageItem> = {};

  for (const m of allMutations) {
    if (!m) continue;
    const pr = m.pr || m.pPr || m.rPr;
    if (!pr && !m.drawing) continue;

    const bi = m.bi ?? m.i ?? m.range?.[0] ?? pr?.bi ?? pr?.i ?? 0;
    const len = m.len ?? m.l ?? pr?.len ?? pr?.l;
    const ei = m.ei ?? (len != null ? bi + len : undefined) ?? m.range?.[1] ?? pr?.ei ?? bi;

    if (ei <= bi && !m.drawing && !pr?.drawing) continue;

    // True paragraph mutations (mp, p, par, or contains paragraph-level properties)
    const hasParagraphProps = Boolean(
      pr.paragraph || pr.p || pr.pPr || pr.numPr || pr.listPr || pr.bullet || pr.list || pr.pStyle || pr.outlineLvl
    );
    const isParagraphMutation = m.ty === 'mp' || m.ty === 'p' || hasParagraphProps;
    const parsedPara = parseParagraphFormats(pr, numberingDefs, nestedNumIds);

    // Save to paragraphFormatMap and charFormatMap
    if (isParagraphMutation) {
      const lineIdx = findLineIndexByCharPos(bi);
      if (lineIdx !== -1) {
        paragraphFormatMap[lineIdx] = {
          ...paragraphFormatMap[lineIdx],
          ...parsedPara,
        };
        for (let c = lines[lineIdx]!.startPos; c <= lines[lineIdx]!.endPos; c++) {
          if (!charFormatMap[c]) charFormatMap[c] = {};
          if (parsedPara.heading) charFormatMap[c]!.heading = parsedPara.heading;
          if (parsedPara.list) charFormatMap[c]!.list = parsedPara.list;
        }
      } else if (bi < lines.length) {
        for (let p = bi; p < Math.min(lines.length, Math.max(bi + 1, ei)); p++) {
          paragraphFormatMap[p] = {
            ...paragraphFormatMap[p],
            ...parsedPara,
          };
        }
      }
    }

    // Text Run Formats (bold, italic, code, etc. always indexed by character offset)
    const run = pr?.run || pr?.rPr || (m.ty === 'mr' ? pr : null);
    if (run) {
      for (let i = bi; i < ei; i++) {
        if (!charFormatMap[i]) charFormatMap[i] = {};
        if (run.b && (run.b.val === true || run.b === true)) charFormatMap[i]!.bold = true;
        if (run.i && (run.i.val === true || run.i === true)) charFormatMap[i]!.italic = true;
        if (run.strike && (run.strike.val === true || run.strike === true)) charFormatMap[i]!.strike = true;
        if (run.bgclr && (run.bgclr.val || run.bgclr)) charFormatMap[i]!.code = true;
      }
    }

    // Drawings (Images)
    const drawing = pr?.drawing || m.drawing;
    if (drawing) {
      try {
        const pic =
          (drawing.inlineKeyword || {}).graphic?.graphicData?.pic ||
          drawing.graphic?.graphicData?.pic ||
          drawing.pic;
        if (pic) {
          const blip = pic.blipFill?.blip;
          const url = blip?.embed || '';
          if (url && url.startsWith('http')) {
            const wMatch = url.match(/[?&]w=(\d+)/);
            const hMatch = url.match(/[?&]h=(\d+)/);
            const width = wMatch ? parseInt(wMatch[1]!, 10) : null;
            const height = hMatch ? parseInt(hMatch[1]!, 10) : null;
            const descr = pic.nvPicPr?.cNvPr?.descr || '';
            const charPos = isParagraphMutation && bi < lines.length && lines[bi] ? lines[bi]!.startPos : bi;
            imageMap[charPos] = { url, width, height, descr };
          }
        }
      } catch {
        // ignore image parse failure
      }
    }
  }

  // Concurrently download all images and rewrite to relative paths
  const imageEntries = Object.entries(imageMap)
    .map(([pos, img]) => [parseInt(pos, 10), img] as [number, ImageItem])
    .sort((a, b) => a[0] - b[0]);

  const totalImages = imageEntries.length;
  onProgress?.(45, 100, `发现 ${totalImages} 张原型图片，正在并发下载并本地化...`);

  const assets: BundleAsset[] = [];
  const assetMetadata: ExtractedAssetMeta[] = [];
  const localImageMap: Record<number, string> = {};
  let assetCounter = 0;

  for (let idx = 0; idx < imageEntries.length; idx++) {
    const [pos, img] = imageEntries[idx]!;
    try {
      // First attempt standard fetch (handles public CDNs like wdcdn.qpic.cn without credentials/CORS issues)
      let imgResp: Response;
      try {
        imgResp = await fetch(img.url);
      } catch {
        imgResp = await fetch(img.url, { credentials: 'include' });
      }

      if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);

      const blob = await imgResp.blob();
      const mime = imgResp.headers.get('content-type') || blob.type || 'image/png';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('svg') ? 'svg' : 'png';

      assetCounter++;
      const filename = `assets/prototype-${String(assetCounter).padStart(3, '0')}.${ext}`;
      const localPath = `./${filename}`;

      const buffer = await blob.arrayBuffer();
      assets.push({
        filename,
        data: new Uint8Array(buffer),
      });

      assetMetadata.push({
        filename,
        originalUrl: img.url,
        width: img.width || undefined,
        height: img.height || undefined,
        alt: img.descr || `Prototype ${assetCounter}`,
      });

      localImageMap[pos] = localPath;
    } catch (err: any) {
      warnings.push(`图片抓取失败: ${err?.message || err}`);
      localImageMap[pos] = img.url; // fallback to remote URL
    }

    const currentDone = idx + 1;
    const pct = 45 + Math.floor((currentDone / Math.max(1, totalImages)) * 35);
    onProgress?.(pct, 100, `资源抓取进度: ${currentDone}/${totalImages}...`);
  }

  onProgress?.(80, 100, '正在将正文结构深度重构为 GFM Markdown...');

  const markdownParts: string[] = [];

  // Table State Machine
  let inTable = false;
  let tableRows: string[][] = [];
  let currentRowCells: string[] = [];

  // Code Block State Machine
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let prevWasEmpty = false;

  // List Numbering Counters: keyed by list group (numId or section) -> (level -> count)
  const orderedCountersByGroup: Record<string, Record<number, number>> = {};
  let lastListLevel = -1;
  let lastListWasOrdered = false;
  let currentSectionHeading = '';

  const TABLE_HEADER_START = '\x1a'; // 26
  const TABLE_CELL_SEP = '\x07';     // 7
  const TABLE_ROW_START = '\x06';     // 6
  const CODE_BLOCK_MARK = '\x1d';     // 29
  const HEADING_MARK = '\x08';        // 8

  // Regex for explicit bullet list markers (Unicode dots, squares, arrows, dashes)
  const BULLET_REGEX = /^([•·・･▪▫◦○●∙⁃✦✧➢▶►✔✓◆◇■□☑☐\-\*\+–—])\s*(.*)$/;

  // Regex for explicit ordered list markers (numbers, letters, roman numerals, circled numbers, Chinese)
  const ORDERED_REGEX =
    /^(?:(\d+|[a-zA-Z]|\([0-9a-zA-Z]+\)|\[\d+\]|[①-⑩]|[⑴-⑽]|[⒈-⒑]|[一二三四五六七八九十]+|（[一二三四五六七八九十]+）)[.、\)\s]\s*|(?:([iIvVxX]+)\.\s*))(.*)$/;

  function cleanCellText(t: string): string {
    return t
      .replace(/[\x00-\x1f]/g, '')
      .replace(/\|/g, '\\|')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function appendBlock(t: string) {
    markdownParts.push(t);
  }

  function processLinks(text: string): string {
    // 1. Process Word/Tencent OpenXML field codes: \x13HYPERLINK ... \x14display\x15 or \x13MENTION ... \x14display\x15
    let result = text.replace(
      /(?:\x13)?(?:HYPERLINK|MENTION\w*)\s+(\S+)[^\x14\x15]*\x14([^\x15]*)\x15/g,
      (_match, url, display) => {
        let cleanUrl = url.trim();
        let cleanText = display.trim() || cleanUrl;
        if (cleanUrl.startsWith('https://@') || cleanUrl.startsWith('@') || cleanUrl.includes('MENTION')) {
          return cleanText;
        }
        try {
          cleanUrl = decodeURIComponent(cleanUrl);
        } catch {
          // ignore
        }
        return `[${cleanText}](${cleanUrl})`;
      }
    );

    // 2. Fallback for raw HYPERLINK tokens without field control chars
    result = result.replace(
      /HYPERLINK\s+(\S+)\s+(?:normalLink|docLink|text|addonHina)?(?:\s+\\td\w+\s+[^\s\n\r]+)*\s*(?:\\td[a-z]+\s+)?([^\s\n\r\[]+)?/g,
      (_match, url, display) => {
        let linkUrl = url;
        try {
          linkUrl = decodeURIComponent(linkUrl);
        } catch {
          // ignore
        }
        const displayText = display && display !== 'normalLink' ? display : linkUrl;
        return `[${displayText}](${linkUrl})`;
      }
    );

    // 3. Clean WeChat Work mentions
    result = result.replace(/MENTION_WXWORK\s+[^\n\r]*?(@\S+)/g, '$1');

    // 4. Clean stray control characters and \td tokens
    result = result.replace(/[\x13\x14\x15]/g, '').replace(/\\td\w+\s+[^\s\n\r]+/g, '');

    // 5. Bare URLs (not already markdown links)
    if (!result.includes('](')) {
      result = result.replace(/(https?:\/\/[^\s\)\],]+)/g, '[$1]($1)');
    }

    return result;
  }

  function renderInlineLine(text: string, lineStartPos: number): string {
    if (!text) return '';
    if (text.includes('HYPERLINK') || text.includes('\x13')) return processLinks(text);

    let result = '';
    let buffer = '';
    let currentFormat: any = null;
    let currentKey = '';

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const fmt = charFormatMap[lineStartPos + i] || {};
      const formatKey = `${fmt.bold ? 1 : 0}${fmt.italic ? 1 : 0}${fmt.strike ? 1 : 0}${fmt.code ? 1 : 0}`;
      if (formatKey !== currentKey) {
        if (buffer) {
          let seg = buffer;
          if (currentFormat?.code) seg = `\`${seg.replace(/`/g, '\\`')}\``;
          if (currentFormat?.bold) seg = `**${seg}**`;
          if (currentFormat?.italic) seg = `*${seg}*`;
          if (currentFormat?.strike) seg = `~~${seg}~~`;
          result += seg;
        }
        buffer = '';
        currentFormat = fmt;
        currentKey = formatKey;
      }
      buffer += ch;
    }

    if (buffer) {
      let seg = buffer;
      if (currentFormat?.code) seg = `\`${seg.replace(/`/g, '\\`')}\``;
      if (currentFormat?.bold) seg = `**${seg}**`;
      if (currentFormat?.italic) seg = `*${seg}*`;
      if (currentFormat?.strike) seg = `~~${seg}~~`;
      result += seg;
    }

    return processLinks(result);
  }

  // Flush table to valid GFM Markdown
  function flushTable() {
    if (currentRowCells.length > 0) {
      tableRows.push(currentRowCells);
      currentRowCells = [];
    }

    if (tableRows.length === 0) {
      inTable = false;
      return;
    }

    // Filter out rows that have zero non-empty cells
    const validRows = tableRows.filter((row) => row.some((cell) => cell.trim().length > 0));
    if (validRows.length === 0) {
      tableRows = [];
      inTable = false;
      return;
    }

    // Calculate maximum columns across all rows
    const maxCols = Math.max(...validRows.map((r) => r.length));
    if (maxCols < 1) {
      tableRows = [];
      inTable = false;
      return;
    }

    // Pad all rows to uniform column count
    const paddedRows = validRows.map((row) => {
      const r = [...row];
      while (r.length < maxCols) {
        r.push(' ');
      }
      return r.map((c) => c.trim() || ' ');
    });

    // Render GFM Table
    let tableMd = '\n| ' + paddedRows[0]!.join(' | ') + ' |\n';
    tableMd += '| ' + paddedRows[0]!.map(() => ':---').join(' | ') + ' |\n';
    for (let r = 1; r < paddedRows.length; r++) {
      tableMd += '| ' + paddedRows[r]!.join(' | ') + ' |\n';
    }
    tableMd += '\n';

    appendBlock(tableMd);
    tableRows = [];
    inTable = false;
  }

  function flushCodeBlock() {
    if (!inCodeBlock) return;
    appendBlock(`\n\`\`\`\n${codeLines.join('\n')}\n\`\`\`\n\n`);
    codeLines = [];
    inCodeBlock = false;
  }

  function appendImage(pos: number, img: ImageItem) {
    const localSrc = localImageMap[pos] || img.url;
    const altText = (img.descr || '原型图').replace(/[\\`*_[\]{}()#+\-.!|]/g, '');
    appendBlock(`\n![${altText}](${localSrc})\n\n`);
  }

  // Look ahead helper: determines whether upcoming lines are part of the current table
  function hasUpcomingTableElements(startIndex: number): boolean {
    const limit = Math.min(lines.length, startIndex + 20);
    for (let j = startIndex; j < limit; j++) {
      const l = lines[j]!.raw;
      const cleanL = l.replace(/[\x00-\x1f]/g, '').trim();
      if (
        l.includes('\x1b') ||
        (paragraphFormatMap[j]?.heading && paragraphFormatMap[j]!.heading! > 0) ||
        detectSectionHeading(cleanL) > 0
      ) {
        return false;
      }
      if (
        l.startsWith(TABLE_HEADER_START) ||
        l.startsWith(TABLE_CELL_SEP) ||
        l.startsWith(TABLE_ROW_START)
      ) {
        return true;
      }
      // If we encounter an actual heading, stop lookahead
      if (l.includes(HEADING_MARK) || l.startsWith('#') || l.startsWith('```')) {
        return false;
      }
    }
    return false;
  }

  let imageIndex = 0;
  let skippedLeadingTitle = false;

  for (let i = 0; i < lines.length; i++) {
    const lineInfo = lines[i]!;
    const raw = lineInfo.raw;
    const lineStartPos = lineInfo.startPos;
    const lineEndPos = lineInfo.endPos;
    const paraFmt = paragraphFormatMap[i];

    // 1. Insert any pending images before this line
    while (imageIndex < imageEntries.length) {
      const [pos, img] = imageEntries[imageIndex]!;
      if (pos < lineStartPos) {
        imageIndex++;
        continue;
      }
      if (pos >= lineEndPos) break;

      if (inTable) {
        const localSrc = localImageMap[pos] || img.url;
        const altText = (img.descr || '原型图').replace(/[\\`*_[\]{}()#+\-.!|]/g, '');
        const imgMd = `![${altText}](${localSrc})`;
        if (currentRowCells.length > 0) {
          const lastIdx = currentRowCells.length - 1;
          const prev = currentRowCells[lastIdx]!.trim();
          currentRowCells[lastIdx] = prev ? `${prev}<br>${imgMd}` : imgMd;
        } else {
          currentRowCells.push(imgMd);
        }
      } else {
        if (inCodeBlock) flushCodeBlock();
        appendImage(pos, img);
      }
      imageIndex++;
    }

    // 2. Table Parsing: Check for Boundary, Header, New Row, or New Cell
    const hasTableExit = raw.includes('\x1b');
    const cleanRawForTableCheck = raw.replace(/[\x00-\x1f]/g, '').trim();
    const isTableBoundary =
      hasTableExit ||
      (paraFmt?.heading && paraFmt.heading > 0) ||
      detectSectionHeading(cleanRawForTableCheck) > 0;

    if (inTable && isTableBoundary) {
      flushTable();
    }

    const isTableHeader = !isTableBoundary && raw.startsWith(TABLE_HEADER_START);
    const isTableRowStart =
      !isTableBoundary &&
      (raw.startsWith(TABLE_CELL_SEP + TABLE_ROW_START) || raw.startsWith(TABLE_ROW_START));
    const isTableCellSep = !isTableBoundary && raw.startsWith(TABLE_CELL_SEP) && !isTableRowStart;

    if (isTableHeader || isTableRowStart || isTableCellSep) {
      if (inCodeBlock) flushCodeBlock();

      if (isTableHeader) {
        if (inTable) flushTable();
        inTable = true;
        currentRowCells = [processLinks(cleanCellText(raw.replace(TABLE_HEADER_START, '')))];
        continue;
      }

      if (isTableRowStart) {
        if (!inTable) inTable = true;
        if (currentRowCells.length > 0) {
          tableRows.push(currentRowCells);
        }
        const cellContent = raw.replace(TABLE_CELL_SEP + TABLE_ROW_START, '').replace(TABLE_ROW_START, '');
        currentRowCells = [processLinks(cleanCellText(cellContent))];
        continue;
      }

      if (isTableCellSep) {
        if (!inTable) inTable = true;
        const cellContent = raw.replace(TABLE_CELL_SEP, '');
        currentRowCells.push(processLinks(cleanCellText(cellContent)));
        continue;
      }
    }

    // 3. Table Cell Continuation (Multi-line content in a cell)
    if (inTable) {
      const cleanRaw = raw.replace(/[\x00-\x1f]/g, '').trim();
      const isHeading = (paraFmt?.heading && paraFmt.heading > 0) || detectSectionHeading(cleanRaw) > 0;
      if (hasUpcomingTableElements(i + 1) && !isHeading) {
        if (cleanRaw.length > 0) {
          const processedContent = processLinks(cleanCellText(cleanRaw));
          if (currentRowCells.length === 0) {
            currentRowCells.push(processedContent);
          } else {
            const lastIdx = currentRowCells.length - 1;
            currentRowCells[lastIdx] = `${currentRowCells[lastIdx]}<br>${processedContent}`;
          }
        }
        continue;
      } else {
        flushTable();
      }
    }

    // 4. Analyze Indentation and Leading Control Characters
    let leadingWhitespace = 0;
    let leadingTabs = 0;
    while (leadingWhitespace < raw.length) {
      const ch = raw[leadingWhitespace]!;
      if (ch === '\t') {
        leadingTabs++;
        leadingWhitespace++;
      } else if (ch === ' ') {
        leadingWhitespace++;
      } else {
        break;
      }
    }

    let k = leadingWhitespace;
    let controlCharLevel = -1;
    let hasControlMarker = false;

    while (k < raw.length) {
      const code = raw.charCodeAt(k);
      if (
        code < 32 &&
        code !== 9 &&
        code !== 10 &&
        code !== 13 &&
        code !== 6 &&
        code !== 7 &&
        code !== 19 &&
        code !== 26 &&
        code !== 28 &&
        code !== 29
      ) {
        hasControlMarker = true;
        if (code >= 1 && code <= 5) {
          controlCharLevel = Math.max(controlCharLevel, code - 1);
        }
        k++;
      } else {
        break;
      }
    }

    const lineContent = raw.substring(k).trim();

    // 5. Empty Line handling
    if (lineContent.length === 0 || raw.trim() === HEADING_MARK) {
      if (inCodeBlock) codeLines.push('');
      else if (!prevWasEmpty) {
        appendBlock('\n');
        prevWasEmpty = true;
      }

      // Check if next non-empty line is still a list item to maintain counter continuity
      let nextIsList = false;
      for (let n = i + 1; n < Math.min(lines.length, i + 4); n++) {
        const nextRaw = lines[n]!.raw.trim();
        if (nextRaw.length === 0) continue;
        if (
          nextRaw.match(BULLET_REGEX) ||
          nextRaw.match(ORDERED_REGEX) ||
          paragraphFormatMap[n]?.list?.isList ||
          detectContextualList(nextRaw, currentSectionHeading) ||
          (nextRaw.charCodeAt(0) < 32 && nextRaw.charCodeAt(0) !== 8)
        ) {
          nextIsList = true;
        }
        break;
      }

      if (!nextIsList) {
        lastListLevel = -1;
      }
      continue;
    }
    prevWasEmpty = false;

    // Skip redundant duplicate title line at start of document
    if (
      !skippedLeadingTitle &&
      (lineContent === title.trim() ||
        lineContent.replace(/\s+/g, '_') === cleanTitle ||
        lineContent === cleanTitle)
    ) {
      skippedLeadingTitle = true;
      continue;
    }

    // 6. Code Block handling
    if (raw.includes(CODE_BLOCK_MARK)) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      }
      codeLines.push(raw.replace(/[\x00-\x1f]/g, ''));
      continue;
    }
    if (inCodeBlock) flushCodeBlock();

    // 7. Heading Detection & Rendering
    let maxHeading = paraFmt?.heading || 0;

    for (let c = lineStartPos; c <= lineEndPos; c++) {
      const fmt = charFormatMap[c];
      if (fmt?.heading && fmt.heading > maxHeading) {
        maxHeading = fmt.heading;
      }
    }

    // Check PRD structural heading patterns (e.g. "1. 需求背景", "2. 原型附件", "附：...")
    const structuralHeading = detectSectionHeading(lineContent);
    if (structuralHeading > 0) {
      maxHeading = Math.max(maxHeading, structuralHeading);
    }

    if (maxHeading > 0) {
      lastListLevel = -1;
      currentSectionHeading = lineContent;
      const headingBody = lineContent.replace(/^#+\s*/, '');
      const headingText = renderInlineLine(headingBody, lineStartPos + (raw.length - lineContent.length));
      appendBlock('\n' + '#'.repeat(maxHeading) + ' ' + (headingText || headingBody) + '\n\n');
      continue;
    }

    // 8. List and Numbering Detection & Rebuilding
    const explicitBulletMatch = lineContent.match(BULLET_REGEX);
    const explicitNumberMatch = lineContent.match(ORDERED_REGEX);

    let listMeta: ListFormatMeta | undefined = paraFmt?.list;
    if (!listMeta) {
      for (let c = lineStartPos; c <= lineEndPos; c++) {
        const fmt = charFormatMap[c];
        if (fmt?.list?.isList) {
          listMeta = fmt.list;
          break;
        }
      }
    }

    // Contextual list detection (for online PRDs where bullets/numbers are drawn by layout engine)
    const ctxList = detectContextualList(lineContent, currentSectionHeading);

    let detectedLevel = 0;
    if (listMeta?.ilvl != null && listMeta.ilvl > 0) {
      detectedLevel = listMeta.ilvl;
    } else if (ctxList?.level != null && ctxList.level > 0) {
      detectedLevel = ctxList.level;
    } else if (controlCharLevel >= 0) {
      detectedLevel = controlCharLevel;
    } else if (leadingTabs > 0) {
      detectedLevel = leadingTabs;
    } else if (leadingWhitespace >= 4) {
      detectedLevel = Math.floor(leadingWhitespace / 3);
    }

    const isList = Boolean(
      explicitBulletMatch ||
      explicitNumberMatch ||
      listMeta?.isList ||
      ctxList?.isList ||
      hasControlMarker ||
      (leadingTabs > 0 && lineContent.length > 0)
    );

    if (isList) {
      let isOrdered = false;
      let itemBody = lineContent;
      let explicitNum = '';

      if (explicitNumberMatch) {
        isOrdered = true;
        explicitNum = explicitNumberMatch[1] || explicitNumberMatch[2] || '';
        itemBody = explicitNumberMatch[3] || '';
      } else if (explicitBulletMatch) {
        isOrdered = false;
        itemBody = explicitBulletMatch[2] || '';
      } else if (listMeta?.isList) {
        isOrdered = listMeta.isOrdered;
      } else if (ctxList?.isList) {
        isOrdered = ctxList.isOrdered;
        itemBody = ctxList.itemContent;
      } else if (lastListWasOrdered) {
        isOrdered = true;
      } else {
        isOrdered = false;
      }

      let listPrefix = '';
      const level = Math.max(0, Math.min(detectedLevel, 5));

      if (isOrdered) {
        const groupKey = `${currentSectionHeading}_${listMeta?.numId != null ? String(listMeta.numId) : 'default'}`;

        if (!orderedCountersByGroup[groupKey]) {
          orderedCountersByGroup[groupKey] = {};
        }
        const cMap = orderedCountersByGroup[groupKey];

        if (explicitNum) {
          const indent = '   '.repeat(level);
          if (/^\d+$/.test(explicitNum)) {
            cMap[level] = parseInt(explicitNum, 10);
            listPrefix = `${indent}${explicitNum}. `;
          } else if (/^[a-zA-Z]$/.test(explicitNum)) {
            const subIndent = '   '.repeat(Math.max(1, level));
            listPrefix = `${subIndent}${explicitNum.toLowerCase()}. `;
          } else {
            listPrefix = `${indent}${explicitNum} `;
          }
        } else {
          cMap[level] = (cMap[level] || 0) + 1;
          for (let l = level + 1; l <= 10; l++) {
            delete cMap[l];
          }

          const count = cMap[level] || 1;
          const indent = '   '.repeat(level);
          if (level === 0) {
            listPrefix = `${indent}${count}. `;
          } else if (level === 1) {
            const letter = String.fromCharCode(96 + (((count - 1) % 26) + 1));
            listPrefix = `${indent}${letter}. `;
          } else {
            listPrefix = `${indent}${count}. `;
          }
        }
      } else {
        const indent = '  '.repeat(level);
        listPrefix = `${indent}- `;
      }

      lastListLevel = level;
      lastListWasOrdered = isOrdered;

      const bodyOffset = lineStartPos + Math.max(0, raw.length - itemBody.length);
      const renderedBody = renderInlineLine(itemBody, bodyOffset);

      if (level >= 1) {
        // Sublist item: two trailing spaces for hard break + double newline for block separation
        appendBlock(`${listPrefix}${renderedBody || itemBody}  \n\n`);
      } else {
        appendBlock(`${listPrefix}${renderedBody || itemBody}\n\n`);
      }
      continue;
    }

    // Reset list state when hitting normal paragraph
    lastListLevel = -1;

    // 9. Normal Paragraph
    const paraOffset = lineStartPos + Math.max(0, raw.length - lineContent.length);
    const renderedPara = renderInlineLine(lineContent, paraOffset);
    appendBlock((renderedPara || lineContent) + '\n\n');
  }

  // Final flushes
  if (inTable) flushTable();
  if (inCodeBlock) flushCodeBlock();

  // Append any images at end of document
  while (imageIndex < imageEntries.length) {
    const [pos, img] = imageEntries[imageIndex]!;
    appendImage(pos, img);
    imageIndex++;
  }

  // Include full AST debug dump in assets for transparency and future diagnostics
  try {
    const debugDump = {
      title,
      commandsCount: textData?.commands?.length,
      allMutationsCount: allMutations.length,
      allMutationTypes: Array.from(new Set(allMutations.map((m: any) => m.ty || 'none'))),
      numberingDefs,
      sampleMutationsWithProperties: allMutations
        .filter((m: any) => {
          const s = JSON.stringify(m).toLowerCase();
          return (
            s.includes('list') ||
            s.includes('num') ||
            s.includes('bullet') ||
            s.includes('lvl') ||
            s.includes('ind')
          );
        })
        .slice(0, 30),
      rawLinesSample: lines.slice(0, 40).map((l) => l.raw),
    };
    assets.push({
      filename: 'assets/debug_ast.json',
      data: new TextEncoder().encode(JSON.stringify(debugDump, null, 2)),
    });
  } catch {
    // ignore debug write error
  }

  // Prepend YAML Frontmatter
  const frontmatter = generateYamlFrontmatter({
    title,
    source_url: window.location.href,
    extracted_at: new Date().toISOString(),
    platform: 'Tencent Docs (腾讯文档)',
    author: creator,
    asset_count: assets.length - 1, // exclude debug_ast.json from asset count
    ...(warnings.length > 0 ? { warnings } : {}),
  });

  const fullMarkdown = `${frontmatter}\n# ${title}\n\n${markdownParts.join('').replace(/\n{3,}/g, '\n\n').trim()}\n`;

  onProgress?.(100, 100, '腾讯文档提取与结构化解析完成！');

  return {
    title,
    sanitizedTitle: cleanTitle,
    markdown: fullMarkdown,
    assets,
    assetMetadata,
    warnings,
  };
}
