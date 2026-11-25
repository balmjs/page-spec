import { ref } from 'vue';

export type Locale = 'en' | 'zh-CN';

function syncDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale;
  }
}

export function resolveLocaleFromLanguage(rawLang?: string | null): Locale {
  const normalized = (rawLang || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

export function detectBrowserLocale(): Locale {
  let rawLang = '';
  try {
    if (typeof browser !== 'undefined' && browser.i18n?.getUILanguage) {
      rawLang = browser.i18n.getUILanguage();
    }
  } catch {}
  if (!rawLang) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
        rawLang = chrome.i18n.getUILanguage();
      }
    } catch {}
  }
  if (!rawLang && typeof navigator !== 'undefined') {
    rawLang = navigator.language || navigator.languages?.[0] || '';
  }
  return resolveLocaleFromLanguage(rawLang);
}

export const currentLocale = ref<Locale>(detectBrowserLocale());

export const messages = {
  en: {
    // Header
    offlineBadge: 'Offline',
    connectedBadge: 'SpecLoop',
    offlineBadgeTooltip: '100% local offline extraction mode',
    connectedBadgeTooltip: (url: string) => `Connected to SpecLoop (${url})`,
    detecting: 'Detecting page and frames...',
    unknownHost: 'Unknown Domain',
    currentPage: 'Current Page',
    framesPierced: (n: number) => `Pierced ${n} frames`,
    framesTooltip: (total: number, id: number) => `Detected ${total} frames, current target: #${id}`,
    openInSidePanel: 'Open in side panel',
    switchLangTitle: 'Switch to 简体中文',

    // Directory Bar
    boundDir: (name: string) => `Project Root: ${name}`,
    unboundDir: 'No local project folder bound',
    manageDir: 'Manage',
    setupDir: 'Set Up',

    // Tabs
    tabNavLabel: 'PageSpec sections',
    prdTab: 'PRD',
    designTab: 'Design',
    apiTab: 'API',
    qaTab: 'QA',
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
    smartPrdDesc: (root = 'specs') =>
      `Preserves current session authentication. Automatically pierces nested menu iframes, targets the core body frame, downloads high-res prototypes concurrently, and saves cleanly to ${root}/prd/.`,
    parseEngine: 'Parsing Engine',
    engineAuto: 'Auto Detect (Recommended)',
    engineTencent: 'Tencent Docs AST (Smart Document)',
    engineDom: 'Standard Web DOM',
    autoTrimNoiseLabel: 'Auto-skip noisy sections (Revision History / Changelog)',
    autoTrimmedNotice: (names: string) => `Auto-skipped noisy sections: ${names}`,
    btnWriteDir: (name?: string) => (name ? `Save to Project (${name})` : 'Save to Local Project'),
    btnDownloadZip: 'Download PRD Bundle (.zip)',
    processing: 'Processing...',
    prepPrd: 'Preparing to extract page content and prototype graphics...',
    writingFiles: (root = 'specs') => `Writing Markdown and assets to local ${root}/ directory...`,
    successWrite: (path: string) => `Saved to ${path}`,
    successDownload: 'Bundled! Browser download started',
    docTitle: 'Document Title:',
    localizedAssets: 'Localized Prototypes:',
    assetsCount: (n: number) => `${n} files`,
    isolatedPath: 'Saved Location:',
    downgradeNotice: (n: number) => `Resource fallback notices (${n}):`,
    copyPrompt: 'Copy AI Prompt',
    copiedPrompt: 'Prompt Copied',
    copyFullMarkdown: 'Copy Markdown',
    copiedMarkdown: 'Markdown Copied',
    viewMarkdownPreview: 'View Markdown Preview',
    aiPromptPrd: (relPath: string, title: string) =>
      `@${relPath} Please implement this feature module based on the requirement specification and co-located prototype assets in ./assets/${title}/`,

    // Design Panel
    designTitle: 'UI Design & Artboard Extractor',
    designDesc: (root = 'specs') =>
      `Detects artboards on Lanhu, MasterGo, Modao, or web design galleries. Strips thumbnail CDN resize params to recover original HD images and saves cleanly to ${root}/design/.`,
    rescanArtboards: 'Rescan Artboards',
    scanningArtboards: 'Scanning artboards on current page...',
    searchArtboardsPlaceholder: 'Search artboards by name...',
    artboardsSelectedCount: (sel: number, total: number) => `Selected ${sel} / ${total} artboards`,
    noArtboardsFound: 'No artboards or large design images detected in this frame. Try switching frame or scrolling to load thumbnails.',
    detectedTokens: 'Color Tokens:',
    detectedAnnotations: 'Annotations:',
    btnWriteDesignDir: (name?: string) => (name ? `Save Design to Project (${name})` : 'Save Design to Local Project'),
    btnDownloadDesignZip: 'Download Design Bundle (.zip)',
    successDesignWrite: (path: string) => `Design saved to ${path}`,
    successDesignDownload: 'Design bundle ready! Browser download started',
    exportedArtboards: 'Exported Artboards:',
    aiPromptDesign: (relPath: string, title: string) =>
      `@${relPath} Please implement the UI layout and styling strictly following the artboards in ./assets/${title}/`,

    // API Panel
    targetApiFrame: 'Target API Frame:',
    structuredApiTitle: 'Structured API Spec Extractor',
    structuredApiDesc: (root = 'specs') =>
      `Prioritizes sniffing Swagger / OpenAPI raw JSON specifications to generate high-fidelity Markdown ($ref dereferenced); supports selective endpoint filtering and saves cleanly to ${root}/api/.`,
    rescanEndpoints: 'Rescan Endpoints',
    scanningEndpoints: 'Sniffing OpenAPI endpoints...',
    searchEndpointsPlaceholder: 'Filter by path, summary, or method...',
    allTags: 'All Tags',
    endpointsSelectedCount: (sel: number, total: number) => `Selected ${sel} / ${total} endpoints`,
    selectAll: 'Select All',
    clearSelection: 'Clear',
    noOpenApiListFallback: 'No raw OpenAPI endpoint list sniffed (will extract via Deep DOM parser on click).',
    btnWriteApiDir: (name?: string) => (name ? `Save API to Project (${name})` : 'Save API to Local Project'),
    btnDownloadApiMd: 'Download API Spec (.md)',
    successApiWrite: (path: string) => `API spec saved to ${path}`,
    successApiDownload: 'Extraction complete! API Markdown generated',
    detectedEndpoints: 'Endpoints Exported:',
    endpointsCount: (n: number) => `${n} endpoints`,
    openapiEngine: 'OpenAPI Spec Engine ($ref dereferenced)',
    domEngine: 'Deep DOM Parser',
    aiPromptApi: (relPath: string) =>
      `@${relPath} Please implement the API client requests and TypeScript data types according to these endpoints`,

    // Incremental Diff & Section Trimmer
    diffDetectedTitle: 'Incremental Spec Changes Detected',
    diffStats: (addedSec: number, modSec: number, remSec: number, addL: number, remL: number) =>
      `Sections: +${addedSec} / ~${modSec} / -${remSec} (Lines +${addL} / -${remL})`,
    diffGeneratedFile: (name: string) => `Generated: ${name}`,
    copyDiffPrompt: 'Copy Diff AI Prompt',
    copiedDiffPrompt: 'Diff Prompt Copied',
    aiPromptDiff: (diffPath: string, mainPath: string) =>
      `@${diffPath} @${mainPath} Please review the incremental changes in ${diffPath} and update only the affected code accordingly.`,
    sectionTrimmerTitle: (kept: number, total: number) => `Trim Markdown Sections (${kept}/${total} kept)`,
    noisyBadge: 'Noisy',
    applyTrimOverwrite: 'Apply Trim & Overwrite File',
    applyTrimCopyOnly: 'Apply Trim & Copy',
    trimAppliedSuccess: 'Trimmed Markdown applied!',

    // SpecLoop Interop (v1.2 Opt-in & Bidirectional)
    syncToSpecLoopCheckbox: 'Also sync upload to SpecLoop task (optional)',
    createNewSpecLoopTask: (title?: string) =>
      title ? `+ Create new task "${title}"` : '+ Auto-create new task',
    refreshSpecLoopTasks: 'Refresh SpecLoop tasks',
    sectionAnchorAuto: 'PRD Section Anchor (optional)',
    staleTestsMarked: (n: number) => `${n} QA items flagged stale`,
    exportSpecBundle: 'Export .specbundle.zip',
    pushToSpecLoop: 'Push to SpecLoop',
    pushingToSpecLoop: 'Pushing...',
    pushSpecLoopSuccess: (taskId?: string) =>
      taskId ? `Synced to SpecLoop (${taskId})` : 'Synced to SpecLoop successfully!',
    specLoopSectionTitle: 'SpecLoop Platform Bridge (Optional)',
    specLoopSectionDesc:
      'Optional team integration. When disconnected, PageSpec stays a 100% standalone offline extractor with zero UI clutter.',
    specLoopUrlLabel: 'Server Base URL',
    specLoopUrlPlaceholder: 'https://specloop.yourdomain.com',
    specLoopConnectBtn: 'One-Click Authorize & Connect',
    specLoopConnectedAs: (email: string) => `Connected: ${email}`,
    specLoopDisconnectBtn: 'Disconnect',
    specLoopManualTokenToggle: 'Manual API Token (Advanced)',
    specLoopTokenLabel: 'API Token (PAT)',
    specLoopTokenPlaceholder: 'slp_xxxxxxxx',
    specLoopProjectLabel: 'Default Project Workspace',
    specLoopAllProjects: 'All Projects',
    saveSpecLoopBtn: 'Save & Verify Connection',
    specLoopSavedNotice: 'SpecLoop connected & saved',
    pullSpecsTitle: 'Pull Finalized Task Specs to Local Project',
    pullFullSpecsBtn: (root = 'specs') => `Sync Task Full Specs -> ${root}/`,
    pullSpecsSuccess: (count: number, root: string) => `Synced ${count} spec files into ${root}/`,

    // Live QA Companion (Conditional)
    qaCompanionTitle: 'Live QA Companion (SpecLoop)',
    qaNoTasks: 'No active SpecLoop tasks',
    qaNoTasksHint: 'No active SpecLoop tasks yet. Sync a PRD, Design, or API spec to create one, or click refresh.',
    qaNoItems: 'No QA Test List items yet for this task.',
    qaCaptureFailBtn: 'Fail & Capture Viewport + Errors',
    qaDiagCaptured: (errCount: number, viewport: string) =>
      `Captured viewport (${viewport}) · ${errCount} Console/HTTP errors`,
    qaNotePlaceholder: 'Describe what failed in one sentence...',
    qaSubmitFailBtn: 'Submit Failure to SpecLoop',
    qaFailSubmitted: 'Failure + screenshot sent to SpecLoop!',
    qaUnlockedReleaseNotice: '100% Passed! Ready to approve release in SpecLoop.',
    qaNoFailedItems: 'No failed QA items found for this task.',
    pullQaBugsBtn: (n: number, root = 'specs') => `Pull ${n} Failed QA Bugs -> ${root}/qa/`,
    pullQaBugsSuccess: (n: number, path: string) => `Saved ${n} QA failure bugs to ${path}`,
    copyFixPrompt: 'Copy Bugfix AI Prompt',
    cancelBtn: 'Cancel',

    // Directory Config Panel
    localDirTitle: 'Local Project Root Folder',
    localDirDesc: (root = 'specs') =>
      `Pick your project root directory (e.g. my-app/). PageSpec automatically organizes extracted specs into ${root}/{prd,design,api,qa} with anti-nesting protection.`,
    specsRootLabel: 'Specs Root Directory',
    specsRootScopeProject: (name: string) => `For ${name}`,
    specsRootScopeGlobal: 'Global default',
    specsRootResetDefault: 'Reset',
    specsRootHint: (preview: string) => `Output: ${preview} (supports nested paths like docs/specs)`,
    specsRootPlaceholder: 'specs (or e.g. docs/specs)',
    specsRootErrAbsolute: 'Use a relative path like specs or docs/specs (no leading / or drive letter).',
    specsRootErrTraversal: 'Path cannot contain "." or ".." segments. Enter a relative folder like specs or docs/specs.',
    specsRootErrInvalidChars: 'Contains invalid path characters. Use folder names like specs, docs/specs, or .specs.',
    specsRootErrReserved: 'Contains a reserved system name. Choose another folder name such as specs or page-specs.',
    specsRootConflictTitle: (path: string) => `Existing non-PageSpec folder detected at "${path}/"`,
    specsRootConflictDesc: (entries: string, moreCount: number) =>
      moreCount > 0
        ? `Contains ${entries} and ${moreCount} more items. You can still merge into it, or switch to avoid mixing files:`
        : `Contains ${entries}. You can still merge into it, or switch to avoid mixing files:`,
    currentBinding: 'Bound Project Folder:',
    unbound: '(Not bound yet)',
    browserSupport: 'Browser Support:',
    fsSupportedText: 'Native directory write supported (Chrome / Edge)',
    fsUnsupportedText: 'Not supported (falls back to ZIP download)',
    btnSelectDir: 'Select Project Folder',
    btnReSelectDir: 'Switch Project Folder',
    btnUnbind: 'Unbind',
    workflowTitle: 'Recommended AI Coding Workflow',
    workflowDesc: (root = 'specs') => `Auto-organized under ${root}/{prd,design,api,qa} for instant AI referencing:`,

    // Footer
    footerTitle: 'PageSpec • Pure Offline Spec Extraction',

    // Errors
    errFsUnsupported: 'Current browser does not support direct directory writing. Please use ZIP download.',
    errPermDenied: 'Read/write permission for project directory was not granted. Please authorize again.',
    errNoTab: 'Unable to connect to current active browser tab.',
    errExtractFailed: 'Extraction failed. Please refresh the target page and try again.',
    errSelectDirFailed: 'Failed to select directory.',
    errNoSelection: 'Please select at least one item to extract.',
    errSpecLoopUrlRequired: 'Please enter the SpecLoop server URL first.',
    errSpecLoopUrlInvalid: 'Invalid server URL. Enter e.g. http://localhost:8080 or https://specloop.yourdomain.com',
    errSpecLoopAuthOpenFailed: 'Unable to open the authorization page.',
    errSpecLoopTokenInvalid: 'Token verification failed.',
    errSpecLoopSyncFailed: 'Sync failed.',
    errSpecLoopPartialSync: (err: string) => `Saved locally, but SpecLoop sync failed: ${err}`,
    errQaLoadItems: 'Failed to load QA test list.',
    errQaUpdateStatus: 'Failed to update test item status.',
    errQaSubmitFail: 'Failed to submit failure report.',
    errQaPullBugs: 'Failed to pull QA failures.',
    qaDefaultFailNote: 'Failed during live QA verification (see screenshot and diagnostic log).',
  },
  'zh-CN': {
    // Header
    offlineBadge: '离线提取',
    connectedBadge: 'SpecLoop',
    offlineBadgeTooltip: '100% 本地离线提取模式',
    connectedBadgeTooltip: (url: string) => `已连接 SpecLoop (${url})`,
    detecting: '正在检测页面与框架...',
    unknownHost: '未知域名',
    currentPage: '当前网页',
    framesPierced: (n: number) => `已穿透 ${n} 框架`,
    framesTooltip: (total: number, id: number) => `共检测到 ${total} 个框架，当前选中 frame #${id}`,
    openInSidePanel: '在侧边栏常驻打开',
    switchLangTitle: 'Switch to English',

    // Directory Bar
    boundDir: (name: string) => `项目工程: ${name}`,
    unboundDir: '未绑定本地项目文件夹',
    manageDir: '管理',
    setupDir: '前往设置',

    // Tabs
    tabNavLabel: '功能模块切换',
    prdTab: 'PRD',
    designTab: '设计稿',
    apiTab: 'API',
    qaTab: '实测',
    dirTab: '配置',

    // Frame Card
    targetBodyFrame: '目标正文框架:',
    topWindow: 'Top Window (主窗口)',
    switchFrame: '切换目标 Frame:',
    detectedPlatform: '检测平台:',
    contentDensity: '内容密度评分:',
    scoreUnit: '分',

    // PRD Panel
    smartPrdTitle: '智能 PRD 本地化提取',
    smartPrdDesc: (root = 'specs') =>
      `保留当前登录态，自动穿透嵌套菜单 iframe 并抓取高清原型图，自动保存至项目的 ${root}/prd/ 目录并就近内聚图片资源。`,
    parseEngine: '解析引擎',
    engineAuto: '自动识别 (推荐)',
    engineTencent: '腾讯文档 AST (智能文档)',
    engineDom: '通用网页 DOM',
    autoTrimNoiseLabel: '自动跳过常见噪音章节（如修订历史 / 变更记录）',
    autoTrimmedNotice: (names: string) => `已自动过滤噪音章节: ${names}`,
    btnWriteDir: (name?: string) => (name ? `一键保存至本地项目 (${name})` : '一键保存至本地项目'),
    btnDownloadZip: '下载 PRD 压缩包 (.zip)',
    processing: '正在处理中...',
    prepPrd: '准备提取当前页面内容与原型图...',
    writingFiles: (root = 'specs') => `正在按分层结构写入本地 ${root}/ 目录...`,
    successWrite: (path: string) => `已写入 ${path}`,
    successDownload: '打包完成！已触发浏览器下载',
    docTitle: '文档标题:',
    localizedAssets: '本地化原型图:',
    assetsCount: (n: number) => `${n} 张`,
    isolatedPath: '落盘位置:',
    downgradeNotice: (n: number) => `部分资源降级提示 (${n} 个):`,
    copyPrompt: '复制 AI 提示词',
    copiedPrompt: '提示词已复制',
    copyFullMarkdown: '复制全文',
    copiedMarkdown: 'Markdown已复制',
    viewMarkdownPreview: '查看 Markdown 预览',
    aiPromptPrd: (relPath: string, title: string) =>
      `@${relPath} 请根据该需求规格文档与同级 ./assets/${title}/ 下的原型图实现功能`,

    // Design Panel
    designTitle: '蓝湖 / 在线设计稿高保真提取',
    designDesc: (root = 'specs') =>
      `自动嗅探蓝湖、MasterGo、墨刀等页面的高清画板原图与标注色值，一键自动保存至项目的 ${root}/design/ 目录。`,
    rescanArtboards: '重新扫描画板',
    scanningArtboards: '正在扫描当前页面设计画板...',
    searchArtboardsPlaceholder: '按画板名称搜索过滤...',
    artboardsSelectedCount: (sel: number, total: number) => `已勾选 ${sel} / ${total} 张画板`,
    noArtboardsFound: '当前框架未检测到设计画板或大图（可尝试切换 Frame 或滚动页面加载缩略图后点击重新扫描）。',
    detectedTokens: '捕获色值:',
    detectedAnnotations: '页面标注:',
    btnWriteDesignDir: (name?: string) => (name ? `一键保存设计稿至项目 (${name})` : '一键保存设计稿至本地项目'),
    btnDownloadDesignZip: '下载设计稿资产包 (.zip)',
    successDesignWrite: (path: string) => `设计稿已写入 ${path}`,
    successDesignDownload: '设计稿打包完成！已触发浏览器下载',
    exportedArtboards: '导出画板数:',
    aiPromptDesign: (relPath: string, title: string) =>
      `@${relPath} 请严格对照同级 ./assets/${title}/ 下的设计画板与标注信息，完成页面 UI 布局与样式实现`,

    // API Panel
    targetApiFrame: '目标接口框架:',
    structuredApiTitle: '结构化 API 规范提取',
    structuredApiDesc: (root = 'specs') =>
      `优先嗅探 Swagger / OpenAPI 底层 JSON 直出精简 Markdown（自动解引用 $ref），支持按需勾选接口并自动保存至 ${root}/api/。`,
    rescanEndpoints: '重新嗅探接口',
    scanningEndpoints: '正在嗅探 OpenAPI 接口列表...',
    searchEndpointsPlaceholder: '按路径、接口中文名或方法过滤...',
    allTags: '全部分组 (Tags)',
    endpointsSelectedCount: (sel: number, total: number) => `已勾选 ${sel} / ${total} 个接口`,
    selectAll: '全选',
    clearSelection: '清空',
    noOpenApiListFallback: '未嗅探到底层 OpenAPI 列表（点击下方按钮将自动使用 DOM 深度解析提取当前页）。',
    btnWriteApiDir: (name?: string) => (name ? `一键保存接口文档至项目 (${name})` : '一键保存接口文档至本地项目'),
    btnDownloadApiMd: '下载 API 规范文档 (.md)',
    successApiWrite: (path: string) => `接口文档已写入 ${path}`,
    successApiDownload: '提取完成！已生成 API Markdown',
    detectedEndpoints: '导出接口数:',
    endpointsCount: (n: number) => `${n} 个`,
    openapiEngine: 'OpenAPI 规格引擎 ($ref 已解引用)',
    domEngine: 'DOM 深度解析',
    aiPromptApi: (relPath: string) =>
      `@${relPath} 请根据该接口契约实现相关 API 请求封装与 TypeScript 类型定义`,

    // Incremental Diff & Section Trimmer
    diffDetectedTitle: '检测到本地文档增量变更',
    diffStats: (addedSec: number, modSec: number, remSec: number, addL: number, remL: number) =>
      `章节变更: +${addedSec} 新增 / ~${modSec} 修改 / -${remSec} 删除（行 +${addL} / -${remL}）`,
    diffGeneratedFile: (name: string) => `已同步生成增量差异文件: ${name}`,
    copyDiffPrompt: '复制增量 Diff 提示词',
    copiedDiffPrompt: 'Diff 提示词已复制',
    aiPromptDiff: (diffPath: string, mainPath: string) =>
      `@${diffPath} @${mainPath} 请仔细阅读 ${diffPath} 中的需求/接口增量变更点，仅针对新增与修改的部分更新现有代码。`,
    sectionTrimmerTitle: (kept: number, total: number) => `✂️ 章节精简微调 (保留 ${kept}/${total} 节)`,
    noisyBadge: '建议剔除',
    applyTrimOverwrite: '应用裁剪并覆写本地文件',
    applyTrimCopyOnly: '应用裁剪并复制全文',
    trimAppliedSuccess: '裁剪后的精简文档已更新！',

    // SpecLoop Interop (v1.2 Opt-in & Bidirectional)
    syncToSpecLoopCheckbox: '同时同步上传至 SpecLoop 任务（可选）',
    createNewSpecLoopTask: (title?: string) =>
      title ? `+ 新建任务「${title}」` : '+ 自动新建闭环任务',
    refreshSpecLoopTasks: '刷新 SpecLoop 活跃任务',
    sectionAnchorAuto: '绑定至 PRD 指定章节（可选）',
    staleTestsMarked: (n: number) => `已将 ${n} 条受影响用例标为待复测`,
    exportSpecBundle: '导出 .specbundle.zip',
    pushToSpecLoop: '推送至 SpecLoop',
    pushingToSpecLoop: '同步中...',
    pushSpecLoopSuccess: (taskId?: string) =>
      taskId ? `已同步至 SpecLoop（${taskId}）` : '已成功同步至 SpecLoop！',
    specLoopSectionTitle: 'SpecLoop 协同平台连接（可选）',
    specLoopSectionDesc:
      '面向团队闭环的可选扩展：未连接时 PageSpec 保持 100% 纯粹独立的离线本地提取体验；连接后可按需勾选同步或使用实测伴侣。',
    specLoopUrlLabel: '平台服务地址 (Base URL)',
    specLoopUrlPlaceholder: 'https://specloop.yourdomain.com',
    specLoopConnectBtn: '一键网页登录授权连接',
    specLoopConnectedAs: (email: string) => `已连接账号: ${email}`,
    specLoopDisconnectBtn: '断开连接',
    specLoopManualTokenToggle: '手动填写 API Token（高级）',
    specLoopTokenLabel: 'API Token (PAT)',
    specLoopTokenPlaceholder: 'slp_xxxxxxxx',
    specLoopProjectLabel: '默认关联项目空间',
    specLoopAllProjects: '全部项目空间',
    saveSpecLoopBtn: '保存并校验连接',
    specLoopSavedNotice: 'SpecLoop 已连通并保存',
    pullSpecsTitle: '从 SpecLoop 反向同步至本地项目',
    pullFullSpecsBtn: (root = 'specs') => `同步所选任务全套规格 -> ${root}/`,
    pullSpecsSuccess: (count: number, root: string) => `已同步 ${count} 份规格文档至本地 ${root}/`,

    // Live QA Companion (Conditional)
    qaCompanionTitle: '实测抓虫伴侣 (SpecLoop)',
    qaNoTasks: '当前暂无进行中的任务',
    qaNoTasksHint: '当前暂无进行中的 SpecLoop 任务，可先在 PRD / 设计稿 / API 页同步创建任务，或点击右上角刷新。',
    qaNoItems: '该任务尚未生成测试检验清单。',
    qaCaptureFailBtn: '失败并一键截屏抓报错',
    qaDiagCaptured: (errCount: number, viewport: string) =>
      `已捕获当前视口 (${viewport}) · 采集 ${errCount} 条 Console/接口异常`,
    qaNotePlaceholder: '用一句话描述测试不通过现象...',
    qaSubmitFailBtn: '打回开发并回传截图',
    qaFailSubmitted: '已自动上传现场截图与报错日志并通知开发！',
    qaUnlockedReleaseNotice: '测试清单已 100% 通过！可前往 SpecLoop 点击放行发布。',
    qaNoFailedItems: '该任务目前没有未通过的测试项。',
    pullQaBugsBtn: (n: number, root = 'specs') => `一键拉取 ${n} 条打回 Bug -> ${root}/qa/`,
    pullQaBugsSuccess: (n: number, path: string) => `已将 ${n} 条打回记录与截图写入 ${path}`,
    copyFixPrompt: '复制修复 AI 提示词',
    cancelBtn: '取消',

    // Directory Config Panel
    localDirTitle: '本地项目根目录绑定',
    localDirDesc: (root = 'specs') =>
      `选择项目根目录（如 my-app/）后，自动按 ${root}/{prd,design,api,qa} 分层归档（支持按项目自定义目录名及多级路径，自带防套娃保护）。`,
    specsRootLabel: '规格根目录名',
    specsRootScopeProject: (name: string) => `仅作用于 ${name}`,
    specsRootScopeGlobal: '全局默认',
    specsRootResetDefault: '恢复默认',
    specsRootHint: (preview: string) => `落盘预览：${preview}（支持多级如 docs/specs，留空默认 specs）`,
    specsRootPlaceholder: 'specs（或 docs/specs）',
    specsRootErrAbsolute: '请输入相对路径（如 specs 或 docs/specs），不能以 / 或盘符开头。',
    specsRootErrTraversal: '路径不能包含 "." 或 ".."，请使用 specs、docs/specs 等相对目录。',
    specsRootErrInvalidChars: '包含非法路径字符，请使用如 specs、docs/specs 或 .specs 的目录名。',
    specsRootErrReserved: '包含系统保留目录名，请更换为 specs 或 page-specs 等名称。',
    specsRootConflictTitle: (path: string) => `检测到已有非 PageSpec 目录 "${path}/"`,
    specsRootConflictDesc: (entries: string, moreCount: number) =>
      moreCount > 0
        ? `内含 ${entries} 等共多处非规格文件。可继续合并写入，或一键改名避让：`
        : `内含 ${entries}。可继续合并写入，或一键改名避让：`,
    currentBinding: '当前绑定工程:',
    unbound: '（尚未绑定）',
    browserSupport: '浏览器支持:',
    fsSupportedText: '支持原生目录直写 (Chrome / Edge)',
    fsUnsupportedText: '不支持 (降级为 ZIP 下载)',
    btnSelectDir: '选择本地项目文件夹',
    btnReSelectDir: '切换项目文件夹',
    btnUnbind: '解除绑定',
    workflowTitle: 'AI Coding 推荐工作流',
    workflowDesc: (root = 'specs') => `自动归类至 ${root}/{prd,design,api,qa}，在 Cursor / Claude Code 中直接引用：`,

    // Footer
    footerTitle: 'PageSpec • 纯离线需求与设计提取',

    // Errors
    errFsUnsupported: '当前浏览器不支持目录直接写入，请使用 ZIP 下载',
    errPermDenied: '未获得本地项目目录的读写授权，请重新点击授权',
    errNoTab: '无法连接到当前激活的网页标签',
    errExtractFailed: '提取失败，请刷新目标页面后重试',
    errSelectDirFailed: '选择目录失败',
    errNoSelection: '请至少勾选 1 项需要提取的内容',
    errSpecLoopUrlRequired: '请先输入 SpecLoop 服务地址',
    errSpecLoopUrlInvalid: '服务地址格式无效，请输入如 http://localhost:8080 或 https://specloop.yourdomain.com',
    errSpecLoopAuthOpenFailed: '无法打开授权页',
    errSpecLoopTokenInvalid: 'Token 校验未通过',
    errSpecLoopSyncFailed: '同步失败',
    errSpecLoopPartialSync: (err: string) => `本地已保存，但同步 SpecLoop 失败: ${err}`,
    errQaLoadItems: '加载测试清单失败',
    errQaUpdateStatus: '更新状态失败',
    errQaSubmitFail: '提交失败打回记录出错',
    errQaPullBugs: '拉取失败',
    qaDefaultFailNote: '实测未通过（详见现场截图与报错日志）',
  },
};

export async function initLocale(): Promise<Locale> {
  try {
    const stored = await browser.storage.local.get('pagespec_locale');
    const saved = stored?.pagespec_locale;
    if (saved === 'zh-CN' || saved === 'en') {
      currentLocale.value = saved;
      syncDocumentLang(saved);
      return currentLocale.value;
    }
  } catch {}

  const detected = detectBrowserLocale();
  currentLocale.value = detected;
  syncDocumentLang(detected);
  return currentLocale.value;
}

export async function setLocale(lang: Locale): Promise<void> {
  currentLocale.value = lang;
  syncDocumentLang(lang);
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
