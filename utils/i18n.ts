import { ref } from 'vue';

export type Locale = 'en' | 'zh-CN';

export const currentLocale = ref<Locale>('en');

export const messages = {
  en: {
    // Header
    offlineBadge: 'Offline',
    detecting: 'Detecting page and frames...',
    unknownHost: 'Unknown Domain',
    currentPage: 'Current Page',
    framesPierced: (n: number) => `Pierced ${n} frames`,
    singleFrame: 'Single Frame',
    framesTooltip: (total: number, id: number) => `Detected ${total} frames, current target: #${id}`,
    openInSidePanel: 'Open in side panel',
    switchLangTitle: 'Switch to 简体中文',

    // Directory Bar
    boundDir: (name: string) => `Project: requirements (${name})`,
    unboundDir: 'No local requirements folder bound',
    manageDir: 'Manage',
    setupDir: 'Set Up',

    // Tabs
    prdTab: 'PRD',
    designTab: 'Design',
    apiTab: 'API Spec',
    dirTab: 'Settings',

    // Frame Card
    targetBodyFrame: 'Target Body Frame:',
    topWindow: 'Top Window',
    switchFrame: 'Switch Target Frame:',
    detectedPlatform: 'Detected Platform:',
    contentDensity: 'Content Density Score:',
    scoreUnit: 'pts',

    // PRD Panel
    smartPrdTitle: 'Smart PRD Local Extractor',
    smartPrdDesc:
      'Preserves current session authentication. Automatically pierces nested menu iframes, targets the core body frame, downloads high-res prototypes concurrently, and rewrites asset paths as isolated local relative references.',
    parseEngine: 'Parsing Engine',
    engineAuto: 'Auto Detect (Recommended)',
    engineTencent: 'Tencent Docs AST (Smart Document)',
    engineDom: 'Standard Web DOM',
    autoTrimNoiseLabel: 'Auto-skip noisy sections (Revision History / Changelog)',
    autoTrimmedNotice: (names: string) => `Auto-skipped noisy sections: ${names}`,
    btnWriteDir: (name?: string) => (name ? `Save to requirements (${name})` : 'Save to requirements folder'),
    btnDownloadZip: 'Download PRD Bundle (.zip)',
    processing: 'Processing...',
    prepPrd: 'Preparing to extract page content and prototype graphics...',
    writingFiles: 'Writing Markdown and assets to local requirements directory...',
    successWrite: (name: string) => `Saved to local requirements [${name}]`,
    successDownload: 'Bundled! Browser download started',
    docTitle: 'Document Title:',
    localizedAssets: 'Localized Prototypes:',
    assetsCount: (n: number) => `${n} files`,
    isolatedPath: 'Asset Isolation Path:',
    downgradeNotice: (n: number) => `Resource fallback notices (${n}):`,
    copyPrompt: 'Copy AI Prompt',
    copiedPrompt: 'Prompt Copied',
    copyFullMarkdown: 'Copy Markdown',
    copiedMarkdown: 'Markdown Copied',
    viewMarkdownPreview: 'View Markdown Preview',
    aiPromptPrd: (title: string) =>
      `@requirements/${title}.md Please implement this feature module based on the requirement specification and prototype assets in assets/${title}/`,

    // Design Panel (Lanhu / MasterGo / Figma / Generic)
    designTitle: 'UI Design & Artboard Extractor',
    designDesc:
      'Detects artboards on Lanhu, MasterGo, Modao, or web design galleries. Strips thumbnail CDN resize params to recover original HD images and captures annotations/tokens.',
    rescanArtboards: 'Rescan Artboards',
    scanningArtboards: 'Scanning artboards on current page...',
    searchArtboardsPlaceholder: 'Search artboards by name...',
    artboardsSelectedCount: (sel: number, total: number) => `Selected ${sel} / ${total} artboards`,
    noArtboardsFound: 'No artboards or large design images detected in this frame. Try switching frame or scrolling to load thumbnails.',
    detectedTokens: 'Color Tokens:',
    detectedAnnotations: 'Annotations:',
    btnWriteDesignDir: (name?: string) => (name ? `Save Design to requirements (${name})` : 'Save Design to requirements folder'),
    btnDownloadDesignZip: 'Download Design Bundle (.zip)',
    successDesignWrite: (name: string) => `Design saved to local requirements [${name}]`,
    successDesignDownload: 'Design bundle ready! Browser download started',
    exportedArtboards: 'Exported Artboards:',
    aiPromptDesign: (title: string) =>
      `@requirements/${title}-design.md Please implement the UI layout and styling strictly following the artboards in assets/${title}/`,

    // API Panel
    targetApiFrame: 'Target API Frame:',
    structuredApiTitle: 'Structured API Spec Extractor',
    structuredApiDesc:
      'Prioritizes sniffing Swagger / OpenAPI raw JSON specifications to generate high-fidelity Markdown (auto-dereferencing $ref and flattening schema tables); supports selective endpoint filtering.',
    rescanEndpoints: 'Rescan Endpoints',
    scanningEndpoints: 'Sniffing OpenAPI endpoints...',
    searchEndpointsPlaceholder: 'Filter by path, summary, or method...',
    allTags: 'All Tags',
    endpointsSelectedCount: (sel: number, total: number) => `Selected ${sel} / ${total} endpoints`,
    selectAll: 'Select All',
    clearSelection: 'Clear',
    noOpenApiListFallback: 'No raw OpenAPI endpoint list sniffed (will extract via Deep DOM parser on click).',
    btnWriteApiDir: (name?: string) => (name ? `Save to requirements (${name})` : 'Save to requirements folder'),
    btnDownloadApiMd: 'Download API Spec (.md)',
    successApiWrite: (name: string) => `Saved to local requirements [${name}]`,
    successApiDownload: 'Extraction complete! API Markdown generated',
    detectedEndpoints: 'Endpoints Exported:',
    endpointsCount: (n: number) => `${n} endpoints`,
    openapiEngine: 'OpenAPI Spec Engine ($ref dereferenced)',
    domEngine: 'Deep DOM Parser',
    aiPromptApi: (title: string) =>
      `@requirements/${title}-api.md Please implement the API client requests and data types according to these endpoints`,

    // Incremental Diff & Section Trimmer
    diffDetectedTitle: 'Incremental Spec Changes Detected',
    diffStats: (addedSec: number, modSec: number, remSec: number, addL: number, remL: number) =>
      `Sections: +${addedSec} / ~${modSec} / -${remSec} (Lines +${addL} / -${remL})`,
    diffGeneratedFile: (name: string) => `Generated: ${name}`,
    copyDiffPrompt: 'Copy Diff AI Prompt',
    copiedDiffPrompt: 'Diff Prompt Copied',
    aiPromptDiff: (diffFile: string, mainFile: string) =>
      `@requirements/${diffFile} @requirements/${mainFile} Please review the incremental changes in ${diffFile} and update only the affected code accordingly.`,
    sectionTrimmerTitle: (kept: number, total: number) => `Trim Markdown Sections (${kept}/${total} kept)`,
    noisyBadge: 'Noisy',
    applyTrimOverwrite: 'Apply Trim & Overwrite File',
    applyTrimCopyOnly: 'Apply Trim & Copy',
    trimAppliedSuccess: 'Trimmed Markdown applied!',

    // SpecLoop Interop
    exportSpecBundle: 'Export .specbundle.zip',
    pushToSpecLoop: 'Push to SpecLoop',
    pushingToSpecLoop: 'Pushing...',
    pushSpecLoopSuccess: (taskId?: string) =>
      taskId ? `Pushed to SpecLoop (Task: ${taskId})` : 'Pushed to SpecLoop successfully!',
    specLoopSectionTitle: 'SpecLoop Platform Bridge (Optional)',
    specLoopSectionDesc:
      'Configure your self-hosted SpecLoop server to push third-party PRDs, Lanhu designs, and API specs directly into your team closed-loop workspace.',
    specLoopUrlLabel: 'Server Base URL',
    specLoopUrlPlaceholder: 'https://specloop.yourdomain.com',
    specLoopTokenLabel: 'API Token (Optional)',
    specLoopTokenPlaceholder: 'Bearer token if enabled',
    specLoopTaskIdLabel: 'Default Task ID (Optional)',
    specLoopTaskIdPlaceholder: 'e.g. TASK-2026-001 (leave blank to auto-create)',
    saveSpecLoopBtn: 'Save SpecLoop Config',
    specLoopSavedNotice: 'SpecLoop config saved',

    // Directory Config Panel
    localDirTitle: 'Local Project requirements Folder',
    localDirDesc:
      'Bind your local frontend project requirements folder. When extracting on any PRD, Design, or API page, PageSpec will directly write Markdown, Diffs, and assets into your workspace.',
    currentBinding: 'Current Bound Directory:',
    unbound: '(Not bound yet)',
    browserSupport: 'Browser Support:',
    fsSupportedText: 'Native directory write supported (Chrome / Edge)',
    fsUnsupportedText: 'Not supported (falls back to ZIP download)',
    btnSelectDir: 'Select requirements Folder',
    btnReSelectDir: 'Reselect Directory',
    btnUnbind: 'Unbind',
    workflowTitle: 'Recommended AI Coding Workflow',
    workflowDesc: 'Once saved to requirements/, use directly in Cursor or Claude Code:',

    // Footer
    footerTitle: 'PageSpec • Pure Offline Spec Extraction',

    // Errors
    errFsUnsupported: 'Current browser does not support direct directory writing. Please use ZIP download.',
    errPermDenied: 'Read/write permission for requirements directory was not granted. Please click and authorize.',
    errNoTab: 'Unable to connect to current active browser tab.',
    errExtractFailed: 'Extraction failed. Please refresh the target page and try again.',
    errSelectDirFailed: 'Failed to select directory.',
    errNoSelection: 'Please select at least one item to extract.',
  },
  'zh-CN': {
    // Header
    offlineBadge: '离线提取',
    detecting: '正在检测页面与框架...',
    unknownHost: '未知域名',
    currentPage: '当前网页',
    framesPierced: (n: number) => `已穿透 ${n} 框架`,
    singleFrame: '单框架',
    framesTooltip: (total: number, id: number) => `共检测到 ${total} 个框架，当前选中 frame #${id}`,
    openInSidePanel: '在侧边栏常驻打开',
    switchLangTitle: 'Switch to English',

    // Directory Bar
    boundDir: (name: string) => `工程目录: requirements (${name})`,
    unboundDir: '未绑定本地 requirements 目录',
    manageDir: '管理',
    setupDir: '前往设置',

    // Tabs
    prdTab: 'PRD 需求',
    designTab: '设计稿',
    apiTab: 'API 规范',
    dirTab: '目录与配置',

    // Frame Card
    targetBodyFrame: '目标正文框架:',
    topWindow: 'Top Window (主窗口)',
    switchFrame: '切换目标 Frame:',
    detectedPlatform: '检测平台:',
    contentDensity: '内容密度评分:',
    scoreUnit: '分',

    // PRD Panel
    smartPrdTitle: '智能 PRD 本地化提取',
    smartPrdDesc:
      '保留当前会话鉴权态。自动穿透嵌套菜单 iframe，锁定正文框架，并发抓取高分辨率原型图并隔离重写为本地相对路径。',
    parseEngine: '解析引擎',
    engineAuto: '自动识别 (推荐)',
    engineTencent: '腾讯文档 AST (智能文档)',
    engineDom: '通用网页 DOM',
    autoTrimNoiseLabel: '自动跳过常见噪音章节（如修订历史 / 变更记录）',
    autoTrimmedNotice: (names: string) => `已自动过滤噪音章节: ${names}`,
    btnWriteDir: (name?: string) => (name ? `一键写入本地 requirements (${name})` : '写入本地 requirements 目录'),
    btnDownloadZip: '下载 PRD 压缩包 (.zip)',
    processing: '正在处理中...',
    prepPrd: '准备提取当前页面内容与原型图...',
    writingFiles: '正在将 Markdown 与图片写入本地 requirements 目录...',
    successWrite: (name: string) => `成功写入本地目录 [${name}]`,
    successDownload: '打包完成！已触发浏览器下载',
    docTitle: '文档标题:',
    localizedAssets: '本地化原型图:',
    assetsCount: (n: number) => `${n} 张`,
    isolatedPath: '资源隔离路径:',
    downgradeNotice: (n: number) => `部分资源降级提示 (${n} 个):`,
    copyPrompt: '复制 AI 提示词',
    copiedPrompt: '提示词已复制',
    copyFullMarkdown: '复制全文',
    copiedMarkdown: 'Markdown已复制',
    viewMarkdownPreview: '查看 Markdown 预览',
    aiPromptPrd: (title: string) =>
      `@requirements/${title}.md 请根据该需求文档与对应 assets/${title}/ 原型图，实现此功能模块`,

    // Design Panel
    designTitle: '蓝湖 / 在线设计稿高保真提取',
    designDesc:
      '自动嗅探蓝湖、MasterGo、墨刀或页面中的设计画板，剥离缩略图 CDN 参数还原高清原图，支持按需勾选画板并同步提取页面标注与色值。',
    rescanArtboards: '重新扫描画板',
    scanningArtboards: '正在扫描当前页面设计画板...',
    searchArtboardsPlaceholder: '按画板名称搜索过滤...',
    artboardsSelectedCount: (sel: number, total: number) => `已勾选 ${sel} / ${total} 张画板`,
    noArtboardsFound: '当前框架未检测到设计画板或大图（可尝试切换 Frame 或滚动页面加载缩略图后点击重新扫描）。',
    detectedTokens: '捕获色值:',
    detectedAnnotations: '页面标注:',
    btnWriteDesignDir: (name?: string) => (name ? `一键写入设计稿至 requirements (${name})` : '写入设计稿至本地 requirements'),
    btnDownloadDesignZip: '下载设计稿资产包 (.zip)',
    successDesignWrite: (name: string) => `设计稿已写入本地目录 [${name}]`,
    successDesignDownload: '设计稿打包完成！已触发浏览器下载',
    exportedArtboards: '导出画板数:',
    aiPromptDesign: (title: string) =>
      `@requirements/${title}-design.md 请严格对照 assets/${title}/ 下的设计画板与标注信息，完成页面 UI 布局与样式实现`,

    // API Panel
    targetApiFrame: '目标接口框架:',
    structuredApiTitle: '结构化 API 规范提取',
    structuredApiDesc:
      '优先嗅探 Swagger / OpenAPI 底层 JSON 规范直出高保真 Markdown（自动解引用 $ref 并打平属性表格）；支持按需搜索勾选所需接口子集。',
    rescanEndpoints: '重新嗅探接口',
    scanningEndpoints: '正在嗅探 OpenAPI 接口列表...',
    searchEndpointsPlaceholder: '按路径、接口中文名或方法过滤...',
    allTags: '全部分组 (Tags)',
    endpointsSelectedCount: (sel: number, total: number) => `已勾选 ${sel} / ${total} 个接口`,
    selectAll: '全选',
    clearSelection: '清空',
    noOpenApiListFallback: '未嗅探到底层 OpenAPI 列表（点击下方按钮将自动使用 DOM 深度解析提取当前页）。',
    btnWriteApiDir: (name?: string) => (name ? `一键写入 requirements (${name})` : '写入本地 requirements 目录'),
    btnDownloadApiMd: '下载 API 规范文档 (.md)',
    successApiWrite: (name: string) => `成功写入本地目录 [${name}]`,
    successApiDownload: '提取完成！已生成 API Markdown',
    detectedEndpoints: '导出接口数:',
    endpointsCount: (n: number) => `${n} 个`,
    openapiEngine: 'OpenAPI 规格引擎 ($ref 已解引用)',
    domEngine: 'DOM 深度解析',
    aiPromptApi: (title: string) =>
      `@requirements/${title}-api.md 请根据该接口定义实现相关 API 请求与数据类型`,

    // Incremental Diff & Section Trimmer
    diffDetectedTitle: '检测到本地文档增量变更',
    diffStats: (addedSec: number, modSec: number, remSec: number, addL: number, remL: number) =>
      `章节变更: +${addedSec} 新增 / ~${modSec} 修改 / -${remSec} 删除（行 +${addL} / -${remL}）`,
    diffGeneratedFile: (name: string) => `已同步生成增量差异文件: ${name}`,
    copyDiffPrompt: '复制增量 Diff 提示词',
    copiedDiffPrompt: 'Diff 提示词已复制',
    aiPromptDiff: (diffFile: string, mainFile: string) =>
      `@requirements/${diffFile} @requirements/${mainFile} 请仔细阅读 ${diffFile} 中的需求/接口增量变更点，仅针对新增与修改的部分更新现有代码。`,
    sectionTrimmerTitle: (kept: number, total: number) => `✂️ 章节精简微调 (保留 ${kept}/${total} 节)`,
    noisyBadge: '建议剔除',
    applyTrimOverwrite: '应用裁剪并覆写本地文件',
    applyTrimCopyOnly: '应用裁剪并复制全文',
    trimAppliedSuccess: '裁剪后的精简文档已更新！',

    // SpecLoop Interop
    exportSpecBundle: '导出 .specbundle.zip',
    pushToSpecLoop: '推送至 SpecLoop',
    pushingToSpecLoop: '推送中...',
    pushSpecLoopSuccess: (taskId?: string) =>
      taskId ? `已推送至 SpecLoop（任务号: ${taskId}）` : '已成功推送至 SpecLoop 协同平台！',
    specLoopSectionTitle: 'SpecLoop 协同平台直推配置（可选）',
    specLoopSectionDesc:
      '配置你自建的 SpecLoop 闭环平台地址后，可将腾讯文档 PRD、蓝湖设计图与 Swagger 接口一键推送入库（不配置时保持 100% 纯离线本地使用）。',
    specLoopUrlLabel: '平台服务地址 (Base URL)',
    specLoopUrlPlaceholder: 'https://specloop.yourdomain.com',
    specLoopTokenLabel: 'API Token（可选）',
    specLoopTokenPlaceholder: '如开启鉴权请填写 Token',
    specLoopTaskIdLabel: '默认关联任务 ID（可选）',
    specLoopTaskIdPlaceholder: '如 TASK-2026-001（留空则自动新建任务）',
    saveSpecLoopBtn: '保存 SpecLoop 配置',
    specLoopSavedNotice: 'SpecLoop 配置已保存',

    // Directory Config Panel
    localDirTitle: '本地工程 requirements 目录',
    localDirDesc:
      '绑定你本地前端项目的 requirements 文件夹。之后在任何需求、设计稿或接口页面点击提取，插件将直接在本地工程中生成 Markdown、增量 Diff 与图片资源。',
    currentBinding: '当前绑定目录:',
    unbound: '（尚未绑定）',
    browserSupport: '浏览器支持:',
    fsSupportedText: '支持原生目录直写 (Chrome / Edge)',
    fsUnsupportedText: '不支持 (降级为 ZIP 下载)',
    btnSelectDir: '选择 requirements 文件夹',
    btnReSelectDir: '重新选择目录',
    btnUnbind: '解除绑定',
    workflowTitle: 'AI Coding 工作流推荐',
    workflowDesc: '落盘至 requirements/ 目录后，直接在 Cursor 或 Claude Code 中使用：',

    // Footer
    footerTitle: 'PageSpec • 纯离线需求与设计提取',

    // Errors
    errFsUnsupported: '当前浏览器不支持目录直接写入，请使用下载方式',
    errPermDenied: '未获得对本地 requirements 目录的读写授权，请重新点击并授权',
    errNoTab: '无法连接到当前激活的网页标签',
    errExtractFailed: '提取失败，请刷新目标页面后重试',
    errSelectDirFailed: '选择目录失败',
    errNoSelection: '请至少勾选 1 项需要提取的内容',
  },
};

export async function initLocale(): Promise<Locale> {
  try {
    const stored = await browser.storage.local.get('pagespec_locale');
    if (stored && stored.pagespec_locale) {
      currentLocale.value = stored.pagespec_locale as Locale;
      return currentLocale.value;
    }
  } catch {}

  const rawLang =
    (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'en';

  currentLocale.value = rawLang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  return currentLocale.value;
}

export async function setLocale(lang: Locale): Promise<void> {
  currentLocale.value = lang;
  try {
    await browser.storage.local.set({ pagespec_locale: lang });
  } catch (err) {
    console.warn('[PageSpec] Failed to save locale setting:', err);
  }
}

export function toggleLocale(): Locale {
  const next: Locale = currentLocale.value === 'zh-CN' ? 'en' : 'zh-CN';
  setLocale(next);
  return next;
}

export function t<K extends keyof (typeof messages)['en']>(key: K): (typeof messages)['en'][K] {
  const loc = currentLocale.value;
  const dict = messages[loc] || messages['en'];
  return (dict[key] ?? messages['en'][key]) as (typeof messages)['en'][K];
}
