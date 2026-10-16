import { sanitizeFilename, asyncPool, getExtensionFromMimeOrUrl, base64ToUint8Array } from '../../utils/dom-helpers';
import { generateYamlFrontmatter } from '../markdown/turndown-rules';
import type { BundleAsset } from '../bundler/zip-builder';
import type { PrdExtractionResult, ExtractedAssetMeta } from './prd-extractor';

export function isTencentDoc(url: string = window.location.href): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host.includes('doc.weixin.qq.com') ||
      host.includes('docs.qq.com') ||
      host.includes('page.weixin.qq.com') ||
      host.includes('txdocs.qq.com')
    );
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
  blockquote?: boolean;
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
  } else if (
    pPr.outlineLvl != null ||
    pr.outlineLvl != null
  ) {
    const rawLvl = pPr.outlineLvl?.val ?? pPr.outlineLvl ?? pr.outlineLvl?.val ?? pr.outlineLvl;
    const lvl = typeof rawLvl === 'number' ? rawLvl : parseInt(String(rawLvl), 10);
    if (!isNaN(lvl)) {
      result.heading = Math.max(1, Math.min(6, lvl + 1));
    }
  }

  // 1.3 Font size fallback for headings (only if not an explicit list item)
  const run = pr.run || pr.rPr || pPr.rPr;
  if (run?.sz && !result.heading && !numPr && !isExplicitBullet && !isExplicitOrdered) {
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

  // 1.4 Blockquote Detection
  const pBdr = pPr.pBdr || pr.pBdr;
  const hasLeftBdr = Boolean(pBdr?.left?.val && pBdr.left.val !== 'none' && pBdr.left.val !== 'nil');
  const hasRightBdr = Boolean(pBdr?.right?.val && pBdr.right.val !== 'none' && pBdr.right.val !== 'nil');
  const hasTopBdr = Boolean(pBdr?.top?.val && pBdr.top.val !== 'none' && pBdr.top.val !== 'nil');
  const hasBottomBdr = Boolean(pBdr?.bottom?.val && pBdr.bottom.val !== 'none' && pBdr.bottom.val !== 'nil');

  const isBlockQuote = Boolean(
    pPr.blockQuote === true ||
    pr.blockQuote === true ||
    pPr.blockquote === true ||
    pr.blockquote === true ||
    pStyle.includes('quote') ||
    (hasLeftBdr && !hasRightBdr && !hasTopBdr && !hasBottomBdr)
  );
  if (isBlockQuote) {
    result.blockquote = true;
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
    pStyle.includes('number')
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
  if (/^[一二三四五六七八九十]+[、.]\s*[^。；;!！?？\n]{1,35}$/.test(t)) {
    return 2;
  }

  // Major Level 2 Prefix ("附：...", "附录：...")
  if (/^附[录件]?[:：]\s*[^。；;!！?？\n]{1,35}$/.test(t)) {
    return 2;
  }

  // Level 2 Numbered Section Headings ("1. 需求背景", "2、原型附件", "3. 需求详情")
  if (/^[1-9]\d?[、.]\s*[^。；;!！?？\n]{1,25}$/.test(t)) {
    if (
      /(?:需求|原型|业务|功能|逻辑|说明|背景|概述|详情|附件|架构|接口|清单|数据|流程|权限|规则|附录|版本|目标|场景|设计|规范|交互)/.test(
        t
      )
    ) {
      return 2;
    }
  }

  // Level 2 PRD Standard Section Keywords without numbers
  if (
    /^(?:概述|背景和目标|需求背景|需求场景|产品架构|需求范围|视觉设计要求|前台功能清单|新增业务清单|验收标准|使用权限|使用路径|页面组织|主要功能|边界情况|通用交互与弹窗规则|数据展示与缓存规则|指标口径和具体需求|用户注册功能|培训账号生成方案总览|简单易用的业务数据库|团队沟通[，,]高效协作|实时协作[，,]数据轻松整理|各种信息[，,]一键收集|帮助与反馈)[:：]?\s*$/.test(
      t
    )
  ) {
    return 2;
  }

  // Level 3 Headings ("(1) 交互逻辑", "1.1 功能说明", "4.1、预览场景", "（一）设计规范")
  if (
    /^(?:[（(][1-9一二三四五六七八九十]+[)）]|[1-9]\.[1-9]\d?[.、])\s*[^。；;!！?？\n]{1,35}$/.test(
      t
    )
  ) {
    return 3;
  }

  // Level 3 Emoji / Callout Headings (e.g. "✅ 正常点", "🎯 期望改动 + ❌ 原有问题", "📌 核心说明", "⚠️ 注意事项")
  if (
    /^(?:[✅✔️☑️🎯❌⚡️💡📌⚠️🔍🚀🔥🌟⭐️✨❓🚩🏷️])\s*[^。；;!！?？\n]{1,35}$/u.test(t) ||
    /^(?:🎯\s*期望改动|❌\s*原有问题|✅\s*正常点)/.test(t)
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

  // Never treat lines ending with colon (introductory lines) as list items
  if (/[:：]\s*$/.test(t)) return null;

  // Exclude common PRD section/paragraph labels that use colons
  if (
    /^(?:背景|目标|交互|设计稿|筛选交互|筛选项交互|指标|说明|注意|报错|弹窗规则|规则|路径|权限|需求|情况|原因|尺寸|操作|提示语|填写项|输入框|自上而下|自左至右)[:：]/.test(
      t
    )
  ) {
    return null;
  }

  // Generic short key-value bullet items (e.g. "完全选中：...", "状态：已完成", "优先级：高")
  const match = t.match(/^([^。；;!！?？\n\s]{2,8})[:：]\s*(\S.*)$/);
  if (match && !/^(?:http|https|note|tip|warning|notice)/i.test(match[1]!)) {
    if (match[2]!.length <= 80 && !match[2]!.includes('\n')) {
      return {
        isList: true,
        isOrdered: false,
        level: 0,
        itemContent: t,
      };
    }
  }

  return null;
}

/**
 * Extract authenticated Tencent Docs (doc.weixin.qq.com / docs.qq.com) directly
 * via its internal opendoc API and mutations AST into standard Markdown & local assets.
 */
export async function extractTencentDocBundle(
  onProgress?: (current: number, total: number, message: string) => void,
  options?: { includeDebugAst?: boolean }
): Promise<PrdExtractionResult> {
  onProgress?.(5, 100, '正在识别腾讯文档标识与鉴权参数...');

  const urlParams = new URLSearchParams(window.location.search);
  const scode = urlParams.get('scode') || '';
  const pathParts = window.location.pathname.split('/');
  // Sub-page in smartpage / blankpage notebook is in 'p', fallback to 'id' or last path segment
  const docId = urlParams.get('p') || urlParams.get('id') || pathParts[pathParts.length - 1];

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
      blockquote?: boolean;
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

  interface CollectedDocImage {
    pos: number;
    img: ImageItem;
    order: number;
  }
  const collectedImages: CollectedDocImage[] = [];
  let imageOrderSeq = 0;

  for (const m of allMutations) {
    if (!m) continue;
    const pr = m.pr || m.pPr || m.rPr;
    if (!pr && !m.drawing) continue;

    const bi = m.bi ?? m.i ?? m.range?.[0] ?? pr?.bi ?? pr?.i ?? 0;
    const len = m.len ?? m.l ?? pr?.len ?? pr?.l;
    const ei = m.ei ?? (len != null ? bi + len : undefined) ?? m.range?.[1] ?? pr?.ei ?? bi;

    if (ei <= bi && !m.drawing && !pr?.drawing) continue;

    // True paragraph mutations (mp, p, or contains paragraph-level properties)
    const isParagraphMutation = m.ty === 'mp' || m.ty === 'p' || m.mt === 'paragraph';
    const parsedPara = parseParagraphFormats(pr, numberingDefs, nestedNumIds);

    // Save to paragraphFormatMap and charFormatMap
    if (isParagraphMutation) {
      const startLine = findLineIndexByCharPos(bi);
      const endLine = ei > bi ? findLineIndexByCharPos(ei - 1) : startLine;
      if (startLine !== -1) {
        const pEnd = endLine !== -1 ? Math.max(startLine, endLine) : startLine;
        for (let p = startLine; p <= pEnd; p++) {
          paragraphFormatMap[p] = {
            ...paragraphFormatMap[p],
            ...parsedPara,
          };
          for (let c = lines[p]!.startPos; c <= lines[p]!.endPos; c++) {
            if (!charFormatMap[c]) charFormatMap[c] = {};
            if (parsedPara.heading) charFormatMap[c]!.heading = parsedPara.heading;
            if (parsedPara.list) charFormatMap[c]!.list = parsedPara.list;
            if (parsedPara.blockquote) charFormatMap[c]!.blockquote = parsedPara.blockquote;
          }
        }
      } else if (bi < lines.length) {
        const pEnd = Math.min(lines.length - 1, Math.max(bi, ei - 1));
        for (let p = bi; p <= pEnd; p++) {
          paragraphFormatMap[p] = {
            ...paragraphFormatMap[p],
            ...parsedPara,
          };
        }
      }
    }

    // Text Run Formats (bold, italic, code, etc. always indexed by character offset in rawText)
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
            let charPos = bi;
            if (isParagraphMutation && bi < lines.length && lines[bi]) {
              charPos = lines[bi]!.startPos;
            }
            collectedImages.push({
              pos: charPos,
              img: { url, width, height, descr },
              order: imageOrderSeq++,
            });
          }
        }
      } catch {
        // ignore image parse failure
      }
    }
  }

  // Stable sort by character position in rawText, then insertion order
  const imageEntries = collectedImages
    .slice()
    .sort((a, b) => a.pos - b.pos || a.order - b.order)
    .map((item, idx) => ({ ...item, idx }));

  const totalImages = imageEntries.length;
  onProgress?.(45, 100, `发现 ${totalImages} 张原型图片，正在并发下载并本地化...`);

  const assets: BundleAsset[] = [];
  const assetMetadata: ExtractedAssetMeta[] = [];
  const localImageMap: Record<number, string> = {}; // keyed by image order

  await asyncPool(5, imageEntries, async (entry) => {
    const { img, idx, order } = entry;
    try {
      let buffer: ArrayBuffer | null = null;
      let mime = 'image/png';

      try {
        let imgResp: Response;
        try {
          imgResp = await fetch(img.url);
        } catch {
          imgResp = await fetch(img.url, { credentials: 'include' });
        }

        if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
        const blob = await imgResp.blob();
        mime = imgResp.headers.get('content-type') || blob.type || 'image/png';
        buffer = await blob.arrayBuffer();
      } catch (directErr) {
        // Fallback to background script proxy fetch to bypass webpage CORS (e.g. for wdcdn.qpic.cn)
        try {
          const bgRes: any = await browser.runtime.sendMessage({
            type: 'FETCH_IMAGE_DATA',
            url: img.url,
          });
          if (bgRes && bgRes.ok) {
            mime = bgRes.mime || 'image/png';
            if (bgRes.base64) {
              buffer = base64ToUint8Array(bgRes.base64).buffer as ArrayBuffer;
            } else if (Array.isArray(bgRes.data)) {
              buffer = new Uint8Array(bgRes.data).buffer as ArrayBuffer;
            } else {
              throw directErr;
            }
          } else {
            throw directErr;
          }
        } catch {
          throw directErr;
        }
      }

      if (!buffer) throw new Error('未能获取有效图片二进制数据');

      const ext = getExtensionFromMimeOrUrl(mime, img.url);
      const assetNum = idx + 1;
      const filename = `assets/${cleanTitle}/prototype-${String(assetNum).padStart(3, '0')}.${ext}`;
      const localPath = `./${filename}`;

      assets.push({
        filename,
        data: new Uint8Array(buffer),
      });

      assetMetadata.push({
        filename,
        originalUrl: img.url,
        width: img.width || undefined,
        height: img.height || undefined,
        alt: img.descr || `Prototype ${assetNum}`,
      });

      localImageMap[order] = localPath;
    } catch (err: any) {
      warnings.push(`图片抓取失败 [${img.url}]: ${err?.message || err}`);
      localImageMap[order] = img.url; // fallback to remote URL
    } finally {
      const currentDone = idx + 1;
      const pct = 45 + Math.floor((currentDone / Math.max(1, totalImages)) * 35);
      onProgress?.(pct, 100, `资源抓取进度: ${currentDone}/${totalImages}...`);
    }
  });

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

    // 6. Clean WeChat Work Cold Start / template button markup (e.g. WxWORK_COLD_START_BUTTON {...}使用)
    result = result.replace(/WxWORK_COLD_START_BUTTON\s*\{[^}]*\}\s*(\S+)?/g, (_match, label) => {
      return label ? `\`[${label}]\`` : '';
    });

    return result;
  }

  function renderInlineLine(text: string, lineStartPos: number): string {
    if (!text) return '';

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

    result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
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

  function appendImage(order: number, img: ImageItem) {
    const localSrc = localImageMap[order] || img.url;
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

  function checkIsBlockQuote(idx: number): boolean {
    if (idx < 0 || idx >= lines.length) return false;
    if (paragraphFormatMap[idx]?.blockquote) return true;
    const l = lines[idx]!.raw.trim();
    if (/^[>》]/.test(l)) return true;
    const start = lines[idx]!.startPos;
    if (charFormatMap[start]?.blockquote) return true;
    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    const lineInfo = lines[i]!;
    const raw = lineInfo.raw;
    const lineStartPos = lineInfo.startPos;
    const lineEndPos = lineInfo.endPos;
    const paraFmt = paragraphFormatMap[i];

    function attachImagesUpTo(maxPos: number) {
      while (imageIndex < imageEntries.length) {
        const entry = imageEntries[imageIndex]!;
        if (entry.pos < lineStartPos) {
          imageIndex++;
          continue;
        }
        if (entry.pos > maxPos) break;

        const localSrc = localImageMap[entry.order] || entry.img.url;
        const altText = (entry.img.descr || '原型图').replace(/[\\`*_[\]{}()#+\-.!|]/g, '');
        const imgMd = `![${altText}](${localSrc})`;

        if (inTable) {
          if (currentRowCells.length > 0) {
            const lastIdx = currentRowCells.length - 1;
            const prev = currentRowCells[lastIdx]!.trim();
            currentRowCells[lastIdx] = prev ? `${prev}<br>${imgMd}` : imgMd;
          } else {
            currentRowCells.push(imgMd);
          }
        } else {
          if (inCodeBlock) flushCodeBlock();
          appendImage(entry.order, entry.img);
        }
        imageIndex++;
      }
    }

    // 1. Table Boundary Check
    const hasTableExit = raw.includes('\x1b');
    const cleanRawForTableCheck = raw.replace(/[\x00-\x1f]/g, '').trim();
    const isTableBoundary =
      hasTableExit ||
      (paraFmt?.heading && paraFmt.heading > 0) ||
      detectSectionHeading(cleanRawForTableCheck) > 0;

    if (inTable && isTableBoundary) {
      flushTable();
    }

    // 2. Table Structural Elements (Header, Row, Cell Separator)
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
        const cellText = cleanCellText(raw.replace(TABLE_HEADER_START, ''));
        const cellOffset = lineStartPos + Math.max(0, raw.indexOf(cellText));
        currentRowCells = [renderInlineLine(cellText, cellOffset)];
        attachImagesUpTo(lineEndPos);
        continue;
      }

      if (isTableRowStart) {
        if (!inTable) inTable = true;
        if (currentRowCells.length > 0) {
          tableRows.push(currentRowCells);
        }
        const cellContent = raw.replace(TABLE_CELL_SEP + TABLE_ROW_START, '').replace(TABLE_ROW_START, '');
        const cellText = cleanCellText(cellContent);
        const cellOffset = lineStartPos + Math.max(0, raw.indexOf(cellText));
        currentRowCells = [renderInlineLine(cellText, cellOffset)];
        attachImagesUpTo(lineEndPos);
        continue;
      }

      if (isTableCellSep) {
        if (!inTable) inTable = true;
        const cellContent = raw.replace(TABLE_CELL_SEP, '');
        const cellText = cleanCellText(cellContent);
        const cellOffset = lineStartPos + Math.max(0, raw.indexOf(cellText));
        currentRowCells.push(renderInlineLine(cellText, cellOffset));
        attachImagesUpTo(lineEndPos);
        continue;
      }
    }

    // If not a table structural line, attach any pending images before this line
    attachImagesUpTo(lineStartPos);

    // 3. Table Cell Continuation (Multi-line content in a cell)
    if (inTable) {
      const cleanRaw = raw.replace(/[\x00-\x1f]/g, '').trim();
      const isHeading = (paraFmt?.heading && paraFmt.heading > 0) || detectSectionHeading(cleanRaw) > 0;
      if (hasUpcomingTableElements(i + 1) && !isHeading) {
        if (cleanRaw.length > 0) {
          const cellText = cleanCellText(cleanRaw);
          const cellOffset = lineStartPos + Math.max(0, raw.indexOf(cellText));
          const processedContent = renderInlineLine(cellText, cellOffset);
          if (currentRowCells.length === 0) {
            currentRowCells.push(processedContent);
          } else {
            const lastIdx = currentRowCells.length - 1;
            currentRowCells[lastIdx] = `${currentRowCells[lastIdx]}<br>${processedContent}`;
          }
        }
        attachImagesUpTo(lineEndPos);
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
        code !== 8 &&
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

    let lineContent = raw.substring(k).trim();

    // Blockquote Detection and Normalization
    const rawQuoteMatch = lineContent.match(/^([>》]+)\s*(.*)$/);
    let quotePrefix = '> ';
    if (rawQuoteMatch) {
      const markers = rawQuoteMatch[1]!.replace(/》/g, '>');
      quotePrefix = markers.split('').join(' ') + ' ';
      lineContent = rawQuoteMatch[2]!.trim();
    }
    const isBlockQuote = Boolean(
      paraFmt?.blockquote ||
      rawQuoteMatch ||
      charFormatMap[lineStartPos]?.blockquote
    );

    // Look ahead to check if next non-empty line is also a blockquote
    let nextIsBlockQuote = false;
    for (let n = i + 1; n < lines.length; n++) {
      const nextRaw = lines[n]!.raw.trim();
      if (nextRaw.length === 0) continue;
      if (
        lines[n]!.raw.startsWith(TABLE_HEADER_START) ||
        lines[n]!.raw.startsWith(TABLE_CELL_SEP) ||
        lines[n]!.raw.startsWith(TABLE_ROW_START) ||
        paragraphFormatMap[n]?.heading ||
        detectSectionHeading(nextRaw) > 0
      ) {
        nextIsBlockQuote = false;
        break;
      }
      nextIsBlockQuote = checkIsBlockQuote(n);
      break;
    }

    // 5. Empty Line handling
    if (lineContent.length === 0 || raw.trim() === HEADING_MARK) {
      if (inCodeBlock) codeLines.push('');
      else if (isBlockQuote && nextIsBlockQuote) {
        appendBlock('>\n');
        prevWasEmpty = true;
      } else if (!prevWasEmpty) {
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
          detectContextualList(nextRaw, currentSectionHeading)
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
      const headingBody = lineContent.replace(/^#+\s*/, '').trim();
      // Prevent emitting empty headings or lines consisting only of control characters
      if (!headingBody || /^[\x00-\x1f\s]+$/.test(headingBody)) {
        continue;
      }
      lastListLevel = -1;
      currentSectionHeading = headingBody;
      const headingOffset = lineStartPos + Math.max(0, raw.indexOf(headingBody));
      const headingText = renderInlineLine(headingBody, headingOffset);
      const hPrefix = isBlockQuote ? `${quotePrefix}` : '';
      appendBlock('\n' + hPrefix + '#'.repeat(maxHeading) + ' ' + (headingText || headingBody) + '\n\n');
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
      ctxList?.isList
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

      const itemOffset = raw.indexOf(itemBody);
      const bodyOffset = lineStartPos + (itemOffset >= 0 ? itemOffset : 0);
      const renderedBody = renderInlineLine(itemBody, bodyOffset);

      if (isBlockQuote) {
        const trailing = nextIsBlockQuote ? (level >= 1 ? '  \n' : '\n') : '\n\n';
        appendBlock(`${quotePrefix}${listPrefix}${renderedBody || itemBody}${trailing}`);
      } else {
        if (level >= 1) {
          // Sublist item: two trailing spaces for hard break + double newline for block separation
          appendBlock(`${listPrefix}${renderedBody || itemBody}  \n\n`);
        } else {
          appendBlock(`${listPrefix}${renderedBody || itemBody}\n\n`);
        }
      }
      continue;
    }

    // Reset list state when hitting normal paragraph
    lastListLevel = -1;

    // 9. Normal Paragraph
    const contentOffset = raw.indexOf(lineContent);
    const paraOffset = lineStartPos + (contentOffset >= 0 ? contentOffset : 0);
    const renderedPara = renderInlineLine(lineContent, paraOffset);
    if (isBlockQuote) {
      const trailing = nextIsBlockQuote ? `\n${quotePrefix.trimEnd()}\n` : '\n\n';
      appendBlock(`${quotePrefix}${renderedPara || lineContent}${trailing}`);
    } else {
      appendBlock((renderedPara || lineContent) + '\n\n');
    }
  }

  // Final flushes
  if (inTable) flushTable();
  if (inCodeBlock) flushCodeBlock();

  // Append any images at end of document
  while (imageIndex < imageEntries.length) {
    const entry = imageEntries[imageIndex]!;
    appendImage(entry.order, entry.img);
    imageIndex++;
  }

  // Include full AST debug dump in assets only if requested
  if (options?.includeDebugAst) {
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
        filename: `assets/${cleanTitle}/debug_ast.json`,
        data: new TextEncoder().encode(JSON.stringify(debugDump, null, 2)),
      });
    } catch {
      // ignore debug write error
    }
  }

  // Prepend YAML Frontmatter
  const frontmatter = generateYamlFrontmatter({
    title,
    source_url: window.location.href,
    extracted_at: new Date().toISOString(),
    platform: 'Tencent Docs (腾讯文档)',
    author: creator,
    asset_count: assetMetadata.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });

  let fullMarkdown = `${frontmatter}\n# ${title}\n\n${markdownParts.join('').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  fullMarkdown = fullMarkdown.replace(/>\s*\n\n(?!\s*>)/g, '\n\n');

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
