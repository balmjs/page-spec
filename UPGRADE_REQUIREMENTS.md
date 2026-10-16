# PageSpec v1.1 架构修复与核心升级需求规格书 (Upgrade Requirements Specification)

> **目标读者**：负责执行代码升级的 AI Coding Agent (Gemini)  
> **项目技术栈**：WXT (`^0.21.4`) + Vue 3 (Composition API, `<script setup lang="ts">`) + TypeScript + Tailwind CSS + `@mozilla/readability` + `turndown` + `fflate`  
> **核心原则**：保持 **100% 纯离线提取（Zero AI Token）**，不引入任何外部后端服务或大模型 API；所有改动需通过 `pnpm typecheck` (`vue-tsc --noEmit`) 与 `pnpm build` 验证。

---

## 一、 缺陷与优化项全景矩阵 (Defect & Optimization Matrix)

| 编号 | 优先级 | 模块 / 涉及文件 | 缺陷或痛点本质 | 升级目标 |
| :--- | :---: | :--- | :--- | :--- |
| **BUG-01** | **P0** | [`core/extractors/prd-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/prd-extractor.ts#L239-L299)<br>[`utils/dom-helpers.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/dom-helpers.ts#L62-L99) | `container.cloneNode(true)` 后才对 `<canvas>` 调 `toBlob()` 且对节点调 `getBoundingClientRect()`。离屏克隆节点的 `getBoundingClientRect()` 恒为 `0x0`，且克隆 `<canvas>` 会丢失全部像素，导致导出空白图片或误删有效节点。 | 在克隆前的 **Live DOM** 阶段完成尺寸测量、噪音标记与 `<canvas>` 位图抓取，克隆节点仅做标签替换。 |
| **BUG-02** | **P0** | [`utils/filesystem-writer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/filesystem-writer.ts#L123-L166)<br>[`core/extractors/prd-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/prd-extractor.ts#L365-L366)<br>[`core/extractors/tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts#L570-L571) | 所有 PRD 的图片均写入 `requirements/assets/prototype-001.png`，提取第 2 篇文档时会覆盖第 1 篇的图片；腾讯文档提取无条件写入 `assets/debug_ast.json` 污染生产目录。 | 采用 **根目录 `<sanitizedTitle>.md` + 子目录 `./assets/<sanitizedTitle>/prototype-001.<ext>`** 隔离不同文档资源；ZIP 包内同样使用 `<sanitizedTitle>.md`；默认关闭 `debug_ast.json` 落盘。 |
| **BUG-03** | **P0** | [`entrypoints/injected.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/injected.ts#L1-L35)<br>[`core/extractors/api-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/api-extractor.ts#L220-L249) | `content.ts` 注入了 `injected.js` 监听 `SNIFF_OPENAPI_SPEC`，但 `api-extractor.ts` 从未发送该消息；且对 `#swagger-ui` (`<div>`) 调 `JSON.parse()` 必抛异常，导致 OpenAPI 引擎形同虚设。 | 打通 `api-extractor.ts` 与 `injected.ts` 的 `window.postMessage` 双向通信，并增强 Swagger UI 2/3/4/5、Redoc、Knife4j、Apifox 的内存对象与接口嗅探。 |
| **BUG-04** | **P1** | [`core/extractors/api-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/api-extractor.ts#L15-L126) | `convertOpenApiJsonToMarkdown` 未解析 `$ref` 引用（直接输出 `{"$ref": "#/components/schemas/..."}`），未兼容 Swagger 2.0 `in: "body"` 参数，且 path 级与 operation 级 `parameters` 未合并。 | 实现带循环引用保护的 `$ref` 解引用器；将 Request Body 与 Response Schema 渲染为 **扁平化点路径属性表格 (`data.list[].id`) + 自动合成的 Example JSON**。 |
| **BUG-05** | **P1** | [`core/extractors/smartpage-dom-preprocessor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/smartpage-dom-preprocessor.ts#L136-L161)<br>[`core/extractors/smartpage-dom-preprocessor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/smartpage-dom-preprocessor.ts#L369-L375)<br>[`core/extractors/tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts#L295-L314) | 预处理器硬编码了单一业务 PRD 文案（如 `优化预览弹窗宽度\|打开预览弹窗...`）；`normalizeVideoAttachments` 遍历 `*` 删除匹配 `00:28` 的节点时会误删父级容器。 | 移除硬编码业务词条，改为基于 `data-ps-subitem` 缩进层级的通用子列表转换；视频时长徽标清理严格限定在无子节点的叶子元素 (`el.children.length === 0`)。 |
| **BUG-06** | **P1** | [`core/extractors/tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts#L529-L595)<br>[`core/extractors/tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts#L690-L729)<br>[`core/extractors/frame-scorer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/frame-scorer.ts#L38-L50) | 1. 腾讯文档图片下载使用串行 `for` 循环而非并发池，且缺失 `webp`/`gif` 扩展名识别；<br>2. `renderInlineLine` 遇到 `HYPERLINK` 或 `\x13` 直接提前返回，丢失整行加粗/行内代码样式；<br>3. `frame-scorer.ts` 对所有腾讯文档同源子 iframe 均返回 `9999` 分，可能误选空白辅助 iframe。 | 1. 抽离公共 `asyncPool` 与 `getExtensionFromMimeOrUrl` 至 `utils/dom-helpers.ts`，支持 5 并发下载；<br>2. 先按 `charFormatMap` 渲染非控制字符区间或分段处理超链接；<br>3. 腾讯文档评分区分主窗口/含编辑器容器的 frame 与普通辅助子 frame。 |
| **BUG-07** | **P1** | [`components/PageSpecPanel.vue`](file:///Users/elf-mouse/www/balmjs/page-spec/components/PageSpecPanel.vue#L84-L318)<br>[`entrypoints/background.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/background.ts#L69-L161) | 1. SidePanel 常驻模式下切换标签页或 URL 跳转不会刷新状态；<br>2. `onMessage` 监听器未在 `onUnmounted` 卸载；<br>3. `handleExtractApi` 在已绑定目录时漏调 `verifyDirectoryPermission`，且权限请求若放在耗时消息之后会丢失浏览器 User Gesture 激活态。 | 1. 监听 `tabs.onActivated` 与 `tabs.onUpdated` 自动刷新目标页与 frame 探测；<br>2. 在点击事件最开头同步完成目录句柄获取与 `verifyDirectoryPermission`；<br>3. 组件销毁时清理监听器。 |
| **OPT-08** | **P2** | [`entrypoints/background.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/background.ts#L50-L66)<br>[`entrypoints/content.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/content.ts#L75-L123)<br>[`utils/filesystem-writer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/filesystem-writer.ts#L123-L166) | 跨上下文传输二进制图片时使用 `Array.from(new Uint8Array(buffer))` 转为 JSON 数字数组，体积膨胀约 8 倍，大图易引发 IPC 卡顿或内存峰值。 | 引入 `uint8ArrayToBase64` / `base64ToUint8Array` 工具函数，跨消息通道统一使用 Base64 字符串传输二进制资产。 |
| **OPT-09** | **P2** | [`components/PageSpecPanel.vue`](file:///Users/elf-mouse/www/balmjs/page-spec/components/PageSpecPanel.vue#L441-L651) | `content.ts` 返回了 `warnings` 与 `markdownPreview`，但 UI 完全未展示；多 iframe 页面无法手动切换目标 frame。 | 新增：**手动切换目标 Frame 下拉框**、**提取结果警告折叠面板**、**Markdown 预览与一键复制（含复制 `@requirements/<title>.md` AI 提示词）**。 |

---

## 二、 详细技术改造方案 (Detailed Implementation Specs)

### 2.1 公共工具函数抽离与增强 (`utils/dom-helpers.ts`)

#### 问题分析
1. [`isSignificantVisualElement`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/dom-helpers.ts#L62-L99) 直接在传入的 `el` 上调用 `getBoundingClientRect()`。当 `el` 来自 `container.cloneNode(true)` 时，`getBoundingClientRect()` 永远返回 `{ width: 0, height: 0 }`。
2. `asyncPool` 和 `getExtensionFromMimeOrUrl` 目前定义在 `prd-extractor.ts` 内部，`tencent-doc-extractor.ts` 无法复用。
3. 缺少高效的 `Uint8Array <-> Base64` 转换工具。

#### 改造要求
在 [`utils/dom-helpers.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/dom-helpers.ts) 中：
1. 新增 `asyncPool`、`getExtensionFromMimeOrUrl`、`uint8ArrayToBase64`、`base64ToUint8Array`。
2. 升级 `isSignificantVisualElement(el: Element, minSize = 32)`：优先读取 Live DOM 阶段写入的 `data-ps-width` / `data-ps-height` 属性或 ` data-ps-ignore` 标记，再回退到 `naturalWidth` / `getBoundingClientRect()`。

```ts
// utils/dom-helpers.ts 新增与修改部分

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

    const clean = p.then(
      () => executing.delete(clean),
      () => executing.delete(clean)
    );
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
```

在 `isSignificantVisualElement` 中优先读取 `data-ps-ignore` 和缓存尺寸：
```ts
export function isSignificantVisualElement(el: Element, minSize = 32): boolean {
  if (el.getAttribute('data-ps-ignore') === 'true') {
    return false;
  }
  const cachedW = parseFloat(el.getAttribute('data-ps-width') || '0');
  const cachedH = parseFloat(el.getAttribute('data-ps-height') || '0');

  if (el instanceof HTMLImageElement) {
    const width = cachedW || el.naturalWidth || el.width || el.getBoundingClientRect().width;
    const height = cachedH || el.naturalHeight || el.height || el.getBoundingClientRect().height;

    if ((width > 0 && width < minSize) || (height > 0 && height < minSize)) {
      return false;
    }

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
```

---

### 2.2 修复克隆前 Live DOM 视觉测量、Canvas 位图捕获与硬编码规则 (`core/extractors/smartpage-dom-preprocessor.ts` & `core/extractors/prd-extractor.ts`)

#### 问题分析
1. **BUG-01**：在 [`core/extractors/prd-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/prd-extractor.ts#L239-L242) 中，`container.cloneNode(true)` 之后，`cloned` 中的 `<canvas>` 是空白画布，且 `img.currentSrc` 与 `getBoundingClientRect()` 在离屏节点上失效。
2. **BUG-05**：[`core/extractors/smartpage-dom-preprocessor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/smartpage-dom-preprocessor.ts#L155-L160) 中：
   ```ts
   const all = Array.from(root.querySelectorAll('*'));
   for (const el of all) {
     if (/^\s*\d{2}:\d{2}(?::\d{2})?\s*$/.test(el.textContent || '')) {
       el.remove();
     }
   }
   ```
   若外层容器只有一个含 `00:28` 的子节点，外层容器自身的 `textContent` 也会匹配该正则，从而把整个父容器删掉。
3. **BUG-05**：[`smartpage-dom-preprocessor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/smartpage-dom-preprocessor.ts#L371-L374) 硬编码了 `优化预览弹窗宽度|打开预览弹窗|点击标题预览文章|修复投稿详情|打开投稿详情`。并且 `markLiveDomForSmartpage` 标记了 `data-ps-subitem="true"`（第 76 行），但在 `preprocessSmartpageDom` 中却**从未使用** `data-ps-subitem`！

#### 改造要求

1. **在 `markLiveDomForSmartpage` 中记录视觉元素真实尺寸、解析后的图片 URL 及 Canvas 引用映射**：
   修改 `markLiveDomForSmartpage` 返回值类型为：
   ```ts
   export interface LiveDomCaptureResult {
     cleanup: () => void;
     canvasMap: Map<string, HTMLCanvasElement>;
   }
   ```
   在遍历 Live DOM 时：
   - 对 `IMG`：记录 `rect = el.getBoundingClientRect()`，写入 `data-ps-width` / `data-ps-height`；调用 `resolveImageSource(img)` 将真实绝对地址写入 `data-ps-resolved-src`；若 `!isSignificantVisualElement(img)` 则标记 `data-ps-ignore="true"`。
   - 对 `CANVAS`：记录 `data-ps-width` / `data-ps-height`；若满足 `isSignificantVisualElement(canvas)`，分配唯一 ID `data-ps-canvas-id="canvas-1"` 并将真实 `HTMLCanvasElement` 存入 `canvasMap`。
   - 对 `SVG`：仅针对顶层 `<svg>`（即 `!el.parentElement?.closest('svg')`），记录 `data-ps-width` / `data-ps-height`。
   - 在 `cleanup()` 中一并清理 `data-ps-width`、`data-ps-height`、`data-ps-resolved-src`、`data-ps-ignore`、`data-ps-canvas-id`。

2. **在 `preprocessSmartpageDom` 中消费 `data-ps-subitem="true"` 并修复 `normalizeVideoAttachments`**：
   - 在 `normalizeVideoAttachments` 中，仅当 `el.children.length === 0` 时才移除纯时长文本节点（`^\s*\d{2}:\d{2}(?::\d{2})?\s*$`）。
   - 在 `normalizeListStructures` 中，处理带有 `data-ps-subitem="true"` 的块级节点：若其内部尚未被转化为 `<li>`，将其包装为带缩进标记的子列表项（或在文本前注入缩进标记），并在 `postprocessMarkdown` 中移除第 371-374 行的硬编码业务正则。

3. **在 `prd-extractor.ts` 中使用 `canvasMap` 和命名空间资产路径 (`assets/<cleanTitle>/prototype-xxx.ext`)**：
   - 处理 `target.type === 'canvas'` 时，通过 `clonedCanvas.getAttribute('data-ps-canvas-id')` 从 `canvasMap` 取出 **Live Canvas** 调用 `canvasToBlob(liveCanvas)`。
   - 处理 `target.type === 'img'` 时，优先读取 `img.getAttribute('data-ps-resolved-src') || resolveImageSource(img)`。
   - 收集 `svgs` 时，过滤掉嵌套在其他 `<svg>` 内部的子 `<svg>`：`Array.from(cloned.querySelectorAll('svg')).filter(s => !s.parentElement?.closest('svg'))`。
   - **资产命名空间隔离（解决 BUG-02）**：
     ```ts
     const filename = `assets/${cleanTitle}/prototype-${String(assetCounter).padStart(3, '0')}.${ext}`;
     const localPath = `./${filename}`;
     ```
   - 当 `totalAssets === 0` 时，避免在 `finally` 中出现 `currentDone / 0` (`NaN%`)：使用 `Math.max(1, totalAssets)`。

---

### 2.3 腾讯文档提取器并发优化、行内链接样式保留与 AST 调试开关 (`core/extractors/tencent-doc-extractor.ts` & `core/extractors/frame-scorer.ts`)

#### 问题分析
1. **串行下载图片 (`BUG-06`)**：[`tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts#L529-L595) 使用普通 `for` 循环逐张下载图片，若 PRD 有 30 张原型图会非常缓慢；且第 567 行扩展名判断仅支持 `jpg` / `svg` / `png`，将 `webp` 和 `gif` 强行存成 `.png`。
2. **超链接导致整行样式丢失 (`BUG-06`)**：[`tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts#L690-L693)：
   ```ts
   function renderInlineLine(text: string, lineStartPos: number): string {
     if (!text) return '';
     if (text.includes('HYPERLINK') || text.includes('\x13')) return processLinks(text);
   ```
   只要段落内含有一个链接或 `@提及`，整行的 `charFormatMap`（加粗、斜体、删除线、行内代码）全部被跳过。
3. **无条件生成 `assets/debug_ast.json` 与资产路径冲突 (`BUG-02`)**：第 570 行同样写死 `assets/prototype-xxx`，第 1213-1216 行每次都会往 `assets` 塞入 `assets/debug_ast.json`。
4. **硬编码上下文列表 (`BUG-05`)**：第 304 行硬编码了 `/^(?:完全选中|未选中|部分选中|部分勾选|全部勾选|默认选中|完全勾选)[:：]/`。
5. **腾讯文档多 Frame 评分无区分度 (`BUG-06`)**：[`frame-scorer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/frame-scorer.ts#L39-L50) 对所有匹配 `isTencentDoc(url)` 的 frame 一律返回 `score: 9999`，若页面内嵌了同域名的其他辅助 iframe，可能误命中。

#### 改造要求
1. **并发下载与统一扩展名推断**：
   - 在 `tencent-doc-extractor.ts` 中复用 `utils/dom-helpers.ts` 的 `asyncPool(5, imageEntries, ...)` 与 `getExtensionFromMimeOrUrl(mime, img.url)`。
   - 为保证并发下载后图片编号依然按文档内出现位置严格递增，先在遍历前按 `imageEntries` 索引预分配序号 `const assetNum = idx + 1`，文件名统一采用命名空间路径：
     ```ts
     const filename = `assets/${cleanTitle}/prototype-${String(assetNum).padStart(3, '0')}.${ext}`;
     const localPath = `./${filename}`;
     ```
2. **保留含超链接行的行内加粗/代码样式**：
   - 修改 `renderInlineLine(text: string, lineStartPos: number)`：
     不要因为包含 `HYPERLINK` 或 `\x13` 就跳过 `charFormatMap`。先识别出 `text` 中的控制指令区间（如 `(?:\x13)?(?:HYPERLINK|MENTION\w*)\s+\S+[^\x14\x15]*\x14([^\x15]*)\x15`），对非控制指令的普通文本字符及 `\x14...\x15` 内的显示文本正常应用 `charFormatMap` 的 `bold` / `italic` / `strike` / `code`，最后调用 `processLinks` 完成 Markdown 链接替换。
3. **移除硬编码业务词条 & 控制 `debug_ast.json`**：
   - 将 `detectContextualList` 改为通用模式匹配（例如同一章节下连续出现多个以短标签 `^[^。；;！!?？\n]{2,10}[:：]\s*\S+` 开头的平行条目，或直接交由缩进/列表属性判断，删除硬编码的“完全选中/未选中”特定业务正则）。
   - 给 `extractTencentDocBundle` 增加可选参数 `options?: { includeDebugAst?: boolean }`（默认为 `false`）。仅当 `options?.includeDebugAst === true` 时才写入 `assets/${cleanTitle}/debug_ast.json`，并将 Frontmatter 中的 `asset_count` 设为实际图片资产数 `assetMetadata.length`。
4. **优化 `frame-scorer.ts` 中的腾讯文档评分**：
   ```ts
   if (isTencentDoc(url)) {
     const hasDocEditor = Boolean(
       document.querySelector('#pages, .blankpage-editor, .smartpage-editor, .dui-editor, #weworkContainer, canvas')
     );
     const urlHasDocId = /[?&](?:id|p)=[^&]+/.test(url) || /\/(?:doc|page|sheet|slide)\/[a-zA-Z0-9_-]+/.test(url);
     const score = (isTopFrame ? 5000 : 3000) + (hasDocEditor ? 4000 : 0) + (urlHasDocId ? 999 : 0);
     return {
       score,
       wordCount: 1500,
       imageCount: 1,
       headingsCount: 1,
       title: rawTitle || '腾讯文档',
       url,
       isTopFrame,
       platformBadge: '腾讯文档 (Canvas/API)',
     };
   }
   ```

---

### 2.4 OpenAPI 嗅探器接线、`$ref` 解引用与扁平化表格生成 (`entrypoints/injected.ts` & `core/extractors/api-extractor.ts`)

#### 问题分析
1. **BUG-03**：`entrypoints/injected.ts` 从未被调用。且现代 Swagger UI 3/4/5 将規格存储在 `window.ui.specSelectors.specJson().toJS()` 中，而 `window.ui.spec()` 往往返回内部 state 而非纯 JSON。
2. **BUG-04**：`convertOpenApiJsonToMarkdown` 遇到 `$ref: "#/components/schemas/OrderDTO"` 时原样输出，AI 无法获知字段定义；Swagger 2.0 的 `in: "body"` 请求体参数被当作普通行写入 Request Parameters 表格，丢失 `schema`；Path 级 `parameters` 与 Operation 级 `parameters` 用了 `op.parameters || pathItem.parameters` 而非合并去重。

#### 改造要求

##### 1. 升级 [`entrypoints/injected.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/injected.ts)
支持从主流 API 文档框架的全局变量或同源 API 文档地址中提取 OpenAPI / Swagger JSON：

```ts
// entrypoints/injected.ts
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => {
  async function sniffOpenApiSpec(): Promise<any | null> {
    const w = window as any;
    try {
      // 1. Swagger UI 3.x / 4.x / 5.x (Immutable.js store or plain object)
      if (w.ui?.specSelectors?.specJson) {
        const specJson = w.ui.specSelectors.specJson();
        if (specJson?.toJS) return specJson.toJS();
        if (specJson && typeof specJson === 'object' && (specJson.paths || specJson.openapi || specJson.swagger)) {
          return specJson;
        }
      }
      if (typeof w.ui?.spec === 'function') {
        const s = w.ui.spec();
        if (s?.toJS) return s.toJS();
        if (s?.json) return s.json?.toJS ? s.json.toJS() : s.json;
        if (s?.paths) return s;
      }

      // 2. Redoc
      if (w.__REDOC_STATE__?.rawSpec) return w.__REDOC_STATE__.rawSpec;
      if (w.__redoc_state?.spec?.data) return w.__redoc_state.spec.data;

      // 3. Swagger UI 2.x
      if (w.swaggerUi?.api?.swaggerObject) return w.swaggerUi.api.swaggerObject;

      // 4. Stoplight Elements / Scalar / RapiDoc
      const rapidoc = document.querySelector('rapi-doc') as any;
      if (rapidoc?.resolvedSpec) return rapidoc.resolvedSpec;

      // 5. Inspect PerformanceResourceTiming for already-fetched OpenAPI JSON endpoints
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const specResource = resources
        .map((r) => r.name)
        .reverse()
        .find((url) =>
          /\/(?:v[23]\/api-docs|swagger\.json|openapi\.json|api-docs\.json)(?:\?.*)?$/i.test(url) &&
          !url.includes('swagger-resources')
        );

      if (specResource) {
        const resp = await fetch(specResource, { credentials: 'include' });
        if (resp.ok) {
          const data = await resp.json();
          if (data && (data.paths || data.openapi || data.swagger)) {
            return data;
          }
        }
      }
    } catch {
      // ignore sniffing errors
    }
    return null;
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'PAGESPEC_CONTENT') {
      return;
    }

    if (event.data.type === 'SNIFF_OPENAPI_SPEC') {
      const spec = await sniffOpenApiSpec();
      window.postMessage(
        {
          source: 'PAGESPEC_PAGE',
          type: 'SNIFF_OPENAPI_SPEC_RESPONSE',
          requestId: event.data.requestId,
          spec,
        },
        '*'
      );
    }
  });
});
```

##### 2. 在 [`core/extractors/api-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/api-extractor.ts) 中对接 `SNIFF_OPENAPI_SPEC`
实现 `requestOpenApiSpecFromMainWorld(timeoutMs = 2000): Promise<any | null>`，在 `extractApiDocumentation` 开头优先调用它；若未获取到，再检查页面内的 `<script type="application/json">`（注意剔除 `#swagger-ui` 这个 HTML `<div>` 选择器，避免无效 `JSON.parse`）。

```ts
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
```

##### 3. 实现 `$ref` 解引用、点路径属性展平表格 (`flattenSchemaToRows`) 与 Example JSON 合成 (`synthesizeExampleFromSchema`)
在 [`core/extractors/api-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/api-extractor.ts) 中实现以下核心函数：

- **`resolveRefPointer(ref: string, rootSpec: any): any`**：
  支持 `#/components/schemas/XXX`、`#/definitions/XXX`、`#/components/parameters/XXX`、`#/components/requestBodies/XXX`、`#/components/responses/XXX`（含对 `~1` -> `/`、`~0` -> `~` 的 JSON Pointer 转义解码）。
- **`dereferenceSchema(schema: any, rootSpec: any, seenRefs = new Set<string>(), depth = 0): any`**：
  - 当 `depth > 8` 时停止递归直接返回；
  - 若存在 `schema.$ref`：若 `seenRefs.has(schema.$ref)`，返回 `{ type: 'object', description: `[Circular: ${schema.$ref.split('/').pop()}]` }`；否则将 `schema.$ref` 加入当前分支的 `new Set(seenRefs)` 并递归解析目标对象；
  - 若存在 `allOf`（数组）：合并所有子项的 `properties`、`required` 与 `description`。
  - 若存在 `oneOf` / `anyOf`：默认展开第一个分支或合并各分支属性并在类型列标注 `oneOf`。
- **`flattenSchemaToRows(schema: any, rootSpec: any, prefix = '', seenRefs = new Set<string>(), depth = 0): SchemaFieldRow[]`**：
  ```ts
  export interface SchemaFieldRow {
    path: string;       // e.g. "data.list[].userId"
    type: string;       // e.g. "integer(int64)" | "string" | "array<object>"
    required: boolean;
    description: string;
  }
  ```
  - 对 `object` 的 `properties` 遍历生成行；若属性本身是嵌套 `object` 或 `array`（且 `depth < 5`），先输出父节点行，再以 `${fieldPath}.` 或 `${fieldPath}[].` 为 `prefix` 递归输出子节点行。
  - 若属性含 `enum`，在 `description` 末尾追加 `可选值: \`a\`, \`b\``；若含 `default`，追加 `默认值: \`x\``。
- **`synthesizeExampleFromSchema(schema: any, rootSpec: any, seenRefs = new Set<string>(), depth = 0): any`**：
  - 优先使用字段自带的 `example` 或 `default` 或 `enum[0]`；
  - 否则按 `type` / `format` 生成合理示例值（`string` + `date-time` -> `"2026-01-01T00:00:00Z"`，`integer` -> `0`，`boolean` -> `true`，`array` -> `[synthesizeExampleFromSchema(items)]`）。
- **兼容 Swagger 2.0 与 OpenAPI 3.0 的参数与请求体**：
  - 合并参数：`const rawParams = [...((pathItem as any).parameters || []), ...(op.parameters || [])]`，先对每个 parameter 执行 `dereferenceSchema(p, spec)`。
  - 将 `in !== 'body'` 的参数渲染到 `### Request Parameters` 表格。
  - 请求体来源：优先取 OpenAPI 3.x 的 `dereferenceSchema(op.requestBody, spec)`，其次取 Swagger 2.0 中 `in === 'body'` 的 `param.schema`。
  - 对 Request Body 和每个 `2xx` Response：输出 **扁平化字段表格 (`| Field | Type | Required | Description |`)** + **Example JSON 代码块**（不再直接倾倒未解析的原始 JSON Schema 树）。

---

### 2.5 本地目录与 ZIP 包结构统一 (`utils/filesystem-writer.ts` & `entrypoints/content.ts`)

#### 问题分析
1. **BUG-02**：在 [`utils/filesystem-writer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/filesystem-writer.ts#L147-L152) 中：
   ```ts
   const assetsDirHandle = await dirHandle.getDirectoryHandle('assets', { create: true });
   for (const asset of payload.assets) {
     const pureName = asset.filename.replace(/^assets\//, '');
     const assetFileHandle = await assetsDirHandle.getFileHandle(pureName, { create: true });
   ```
   `getFileHandle(pureName)` 不支持包含 `/` 的子路径（如 `PRD-A/prototype-001.png`），直接传入包含 `/` 的名称会抛出 `TypeError: TheName provided is not a valid filename`。
2. 在 [`entrypoints/content.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/content.ts#L85) 中，ZIP 打包写死了 `markdownFilename: 'index.md'`，与直写目录模式生成的 `${result.sanitizedTitle}.md` 不一致。

#### 改造要求
1. **在 [`utils/filesystem-writer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/filesystem-writer.ts) 中新增递归子目录创建辅助函数 `getNestedFileHandle`**：
   ```ts
   async function getNestedFileHandle(
     rootDirHandle: FileSystemDirectoryHandle,
     relativePath: string
   ): Promise<FileSystemFileHandle> {
     const parts = relativePath.replace(/^\.?\/+/, '').split('/').filter(Boolean);
     if (parts.length === 0) {
       throw new Error(`Invalid asset path: ${relativePath}`);
     }
     let currentDir = rootDirHandle;
     for (let i = 0; i < parts.length - 1; i++) {
       currentDir = await currentDir.getDirectoryHandle(parts[i]!, { create: true });
     }
     const fileName = parts[parts.length - 1]!;
     return currentDir.getFileHandle(fileName, { create: true });
   }
   ```
2. **升级 `writePrdBundleToDirectory` 支持 Base64 / `Uint8Array` / `number[]` 与嵌套子目录**：
   ```ts
   export interface SerializableAsset {
     filename: string; // e.g. "assets/PRD_Title/prototype-001.png"
     base64?: string;
     data?: Uint8Array | number[];
   }
   ```
   遍历 `payload.assets` 时调用 `await getNestedFileHandle(dirHandle, asset.filename)`，若 `asset.base64` 存在则通过 `base64ToUint8Array(asset.base64)` 还原为 `Uint8Array` 写入磁盘。
3. **在 [`entrypoints/content.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/content.ts#L83-L87) 中统一 ZIP 内的 Markdown 文件名**：
   ```ts
   const zipBlob = buildZipArchive({
     markdown: result.markdown,
     markdownFilename: `${result.sanitizedTitle}.md`,
     assets: result.assets,
   });
   ```

---

### 2.6 IPC 二进制传输优化与 Frame 列表返回 (`entrypoints/background.ts` & `entrypoints/content.ts`)

#### 问题分析
1. **OPT-08**：`background.ts` 的 `FETCH_IMAGE_DATA` 与 `content.ts` 的 `serializableAssets` 均使用 `Array.from(new Uint8Array(buffer))`，将每个字节变成 JSON 数字元素，内存与序列化开销极大。
2. **OPT-09**：`background.ts` 的 `DETECT_BEST_PRD_FRAME` 只返回单一 `bestFrameId`，前端无法展示候选 Frame 列表供用户手动切换。

#### 改造要求
1. **升级 `entrypoints/background.ts`**：
   - 在 `FETCH_IMAGE_DATA` 中使用 `uint8ArrayToBase64(new Uint8Array(buffer))` 返回 `base64` 字段（同时保留对旧字段的兼容或统一在调用方使用 `base64ToUint8Array(bgRes.base64)`）。
   - 在 `BestFrameResult` 接口中增加候选框架列表 `frames: ScoredFrameItem[]`：
     ```ts
     export interface ScoredFrameItem {
       frameId: number;
       score: number;
       title: string;
       url: string;
       isTopFrame?: boolean;
       platformBadge?: string;
     }

     export interface BestFrameResult {
       bestFrameId: number;
       bestScore: number;
       bestTitle: string;
       bestUrl: string;
       platformBadge?: string;
       totalFrames: number;
       frames: ScoredFrameItem[];
     }
     ```
     在 `DETECT_BEST_PRD_FRAME` 中将 `results` 按 `score` 降序排列后放入 `data.frames` 返回给前端。
2. **升级 `entrypoints/content.ts`**：
   - 将 `serializableAssets` 改为：
     ```ts
     const serializableAssets = result.assets.map((a) => ({
       filename: a.filename,
       base64: uint8ArrayToBase64(a.data),
     }));
     ```

---

### 2.7 SidePanel 实时同步、权限预检修复与交互体验升级 (`components/PageSpecPanel.vue`)

#### 问题分析
1. **BUG-07（User Gesture 权限丢失与漏检）**：
   - `handleExtractApi` 在 `mode === 'directory'` 且 `targetDir` 已存在时，**漏掉了 `verifyDirectoryPermission(targetDir)`**。
   - 在 Chrome 中，`handle.requestPermission({ mode: 'readwrite' })` 必须在用户点击手势（Transient User Activation）有效期内同步触发，一旦在它之前执行了耗时异步操作则可能报错。当前 `handleExtractPrd` 虽然在 `tabs.sendMessage` 前调用了 `verifyDirectoryPermission`，但 `handleExtractApi` 漏掉了这一步。
2. **BUG-07（SidePanel 状态滞后与内存泄漏）**：
   - 当插件以侧边栏模式 (`props.isSidepanel === true`) 打开时，用户切换浏览器 Tab 或在当前 Tab 内点击链接跳转，面板的 `pageTitle`、`pageUrl`、`bestFrame`、`lastPrdResult` 不会更新。
   - `onMounted` 中注册的 `browser.runtime.onMessage.addListener` 未在 `onUnmounted` 中移除。
3. **OPT-09（缺失的关键 UI 能力）**：
   - 未展示 `lastPrdResult.warnings`（当部分图片鉴权失败降级时用户毫不知情）。
   - 未展示 `markdownPreview`，也没有一键复制 Markdown 或复制 `@requirements/<sanitizedTitle>.md` AI 提示词的快捷按钮。
   - 当 `bestFrame.totalFrames > 1` 时，用户无法手动下拉切换要提取的子 `frameId`。

#### 改造要求
在 [`components/PageSpecPanel.vue`](file:///Users/elf-mouse/www/balmjs/page-spec/components/PageSpecPanel.vue) 中实施以下改动：

1. **权限校验统一前置**：
   提取公共函数 `ensureTargetDirectoryReady(): Promise<FileSystemDirectoryHandle>`，在 `handleExtractPrd('directory')` 和 `handleExtractApi('directory')` 的最开头调用（在 `browser.tabs.query` 之前执行）：
   ```ts
   async function ensureTargetDirectoryReady(): Promise<FileSystemDirectoryHandle> {
     if (!isFsSupported.value) {
       throw new Error('当前浏览器不支持目录直接写入，请使用下载方式');
     }
     let targetDir = savedDirHandle.value;
     if (!targetDir) {
       targetDir = await pickRequirementsDirectory();
       savedDirHandle.value = targetDir;
       dirName.value = targetDir.name;
     } else {
       const hasPerm = await verifyDirectoryPermission(targetDir);
       if (!hasPerm) {
         throw new Error('未获得对本地 requirements 目录的读写授权');
       }
     }
     return targetDir;
   }
   ```

2. **监听标签页切换与导航更新，并在 `onUnmounted` 清理所有监听器**：
   - 新增 `selectedFrameId = ref<number>(0)`，当 `detectFrames` 完成时默认设为 `res.data.bestFrameId`。
   - 提取 `refreshActiveTabContext()` 函数：查询当前窗口激活的 Tab，更新 `pageTitle`、`pageUrl`，清空旧的 `extractionError`，并调用 `detectFrames(activeTabId)`。
   - 在 `onMounted` 中注册：
     - `browser.runtime.onMessage.addListener(handleRuntimeMessage)`
     - `browser.tabs?.onActivated?.addListener(handleTabActivated)`
     - `browser.tabs?.onUpdated?.addListener(handleTabUpdated)`（当 `changeInfo.status === 'complete'` 且是当前窗口激活 Tab 时触发刷新）
   - 在 `onUnmounted` 中移除上述三个监听器。

3. **新增手动 Frame 选择器**：
   - 在“目标正文框架”卡片中，若 `bestFrame.frames && bestFrame.frames.length > 1`，渲染一个 `<select v-model="selectedFrameId">`，列出所有候选 Frame（展示 `#frameId - title/url (score 分)`），并在发送 `EXTRACT_PRD` / `EXTRACT_API` 消息时使用 `selectedFrameId.value`。

4. **新增 Warnings 告警折叠区、Markdown 预览折叠区与一键复制按钮**：
   - 在 `lastPrdResult` 与 `lastApiResult` 状态中保存完整的 `markdown`、`sanitizedTitle`、`markdownPreview`、`warnings`。
   - 在结果卡片中提供：
     - **“复制 AI 提示词 (`@requirements/...`)”** 按钮：一键复制 `@requirements/${res.sanitizedTitle}.md 请根据该需求文档与对应 ./assets/${res.sanitizedTitle}/ 原型图实现功能`（API 模式复制 `@requirements/${res.sanitizedTitle}-api.md`），并在按钮上显示 2 秒“已复制”反馈。
     - **“复制全文 Markdown”** 按钮：一键将提取出的 `markdown` 写入剪贴板。
     - **可展开的 Markdown 预览框 (`<details>`)**：展示 `markdownPreview`。
     - **Warnings 列表（当 `warnings.length > 0` 时展示琥珀色提示框）**：展示哪些图片抓取降级或失败。

---

## 三、 执行顺序与验收清单 (Execution & Verification Checklist)

请按以下顺序逐步修改代码，每完成一步确保类型与引用完整：

- [ ] **Step 1**: 升级 [`utils/dom-helpers.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/dom-helpers.ts) — 添加 `asyncPool`、`getExtensionFromMimeOrUrl`、`uint8ArrayToBase64`、`base64ToUint8Array`，并改造 `isSignificantVisualElement` 支持读取 `data-ps-*` 缓存尺寸与忽略标记。
- [ ] **Step 2**: 升级 [`core/extractors/smartpage-dom-preprocessor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/smartpage-dom-preprocessor.ts) — 在 `markLiveDomForSmartpage` 中完成 Live DOM 尺寸测量、真实图片地址解析与 `canvasMap` 采集；修复 `normalizeVideoAttachments` 仅删除叶子时长节点；消费 `data-ps-subitem`；移除 `postprocessMarkdown` 中的硬编码业务词条。
- [ ] **Step 3**: 升级 [`core/extractors/prd-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/prd-extractor.ts) — 接入 `canvasMap` 导出真实 Canvas 位图，过滤嵌套子 `<svg>`，并将本地资产路径改为 `assets/${cleanTitle}/prototype-xxx.${ext}`。
- [ ] **Step 4**: 升级 [`core/extractors/tencent-doc-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/tencent-doc-extractor.ts) 与 [`core/extractors/frame-scorer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/frame-scorer.ts) — 使用 `asyncPool(5, ...)` 并发下载图片、统一扩展名识别、将图片路径改为 `assets/${cleanTitle}/prototype-xxx.${ext}`、修复含 `HYPERLINK` 行的 `charFormatMap` 样式丢失、移除硬编码业务词条、默认关闭 `debug_ast.json` 注入、优化腾讯文档多 frame 评分。
- [ ] **Step 5**: 升级 [`entrypoints/injected.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/injected.ts) 与 [`core/extractors/api-extractor.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/core/extractors/api-extractor.ts) — 打通 `SNIFF_OPENAPI_SPEC` 消息通信，实现带循环保护的 `$ref` 解引用器、Swagger 2.0 `in: "body"` 兼容、扁平化点路径字段表格 (`flattenSchemaToRows`) 与自动合成 Example JSON (`synthesizeExampleFromSchema`)。
- [ ] **Step 6**: 升级 [`utils/filesystem-writer.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/utils/filesystem-writer.ts)、[`entrypoints/background.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/background.ts) 与 [`entrypoints/content.ts`](file:///Users/elf-mouse/www/balmjs/page-spec/entrypoints/content.ts) — 支持递归创建 `assets/<sanitizedTitle>/` 子目录，ZIP 内 Markdown 命名为 `<sanitizedTitle>.md`，IPC 改用 Base64 字符串传输二进制资产，并在 `DETECT_BEST_PRD_FRAME` 中返回完整候选 `frames` 列表。
- [ ] **Step 7**: 升级 [`components/PageSpecPanel.vue`](file:///Users/elf-mouse/www/balmjs/page-spec/components/PageSpecPanel.vue) — 补齐 API 提取的目录权限预检、添加 SidePanel 标签页/导航切换监听与 `onUnmounted` 清理、支持手动切换目标 Frame、展示提取 `warnings`、支持 Markdown 预览及一键复制 Markdown / AI 提示词。
- [ ] **Step 8**: 运行 `pnpm typecheck` 与 `pnpm build`，确保零 TypeScript 错误且 Chrome MV3 构建产物正常生成。
