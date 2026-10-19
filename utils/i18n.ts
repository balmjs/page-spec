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
    prdTab: 'PRD Bundle',
    apiTab: 'API Spec',
    dirTab: 'Directory',

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

    // API Panel
    targetApiFrame: 'Target API Frame:',
    structuredApiTitle: 'Structured API Spec Extractor',
    structuredApiDesc:
      'Prioritizes sniffing Swagger / OpenAPI raw JSON specifications to generate high-fidelity Markdown (auto-dereferencing $ref and flattening schema tables); compatible with Knife4j, Apifox, and Redoc.',
    btnWriteApiDir: (name?: string) => (name ? `Save to requirements (${name})` : 'Save to requirements folder'),
    btnDownloadApiMd: 'Download API Spec (.md)',
    successApiWrite: (name: string) => `Saved to local requirements [${name}]`,
    successApiDownload: 'Extraction complete! API Markdown generated',
    detectedEndpoints: 'Endpoints Found:',
    endpointsCount: (n: number) => `${n} endpoints`,
    openapiEngine: 'OpenAPI Spec Engine ($ref dereferenced)',
    domEngine: 'Deep DOM Parser',
    aiPromptApi: (title: string) =>
      `@requirements/${title}-api.md Please implement the API client requests and data types according to these endpoints`,

    // Directory Config Panel
    localDirTitle: 'Local Project requirements Folder',
    localDirDesc:
      'Bind your local frontend project requirements folder. When extracting on any PRD or API page, PageSpec will directly write Markdown and assets into your workspace without manual unzipping.',
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
    prdTab: 'PRD 需求包',
    apiTab: 'API 规范',
    dirTab: '目录配置',

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

    // API Panel
    targetApiFrame: '目标接口框架:',
    structuredApiTitle: '结构化 API 规范提取',
    structuredApiDesc:
      '优先嗅探 Swagger / OpenAPI 底层 JSON 规范直出高保真 Markdown（自动解引用 $ref 并打平属性表格）；兼容 Knife4j、Apifox、Redoc。',
    btnWriteApiDir: (name?: string) => (name ? `一键写入 requirements (${name})` : '写入本地 requirements 目录'),
    btnDownloadApiMd: '下载 API 规范文档 (.md)',
    successApiWrite: (name: string) => `成功写入本地目录 [${name}]`,
    successApiDownload: '提取完成！已生成 API Markdown',
    detectedEndpoints: '检测接口数:',
    endpointsCount: (n: number) => `${n} 个`,
    openapiEngine: 'OpenAPI 规格引擎 ($ref 已解引用)',
    domEngine: 'DOM 深度解析',
    aiPromptApi: (title: string) =>
      `@requirements/${title}-api.md 请根据该接口定义实现相关 API 请求与数据类型`,

    // Directory Config Panel
    localDirTitle: '本地工程 requirements 目录',
    localDirDesc:
      '绑定你本地前端项目的 requirements 文件夹。之后在任何需求页面点击提取，插件将直接在本地工程中生成 Markdown 与原型图，无需每次手动解压压缩包。',
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
    footerTitle: 'PageSpec • 纯离线需求提取',

    // Errors
    errFsUnsupported: '当前浏览器不支持目录直接写入，请使用下载方式',
    errPermDenied: '未获得对本地 requirements 目录的读写授权，请重新点击并授权',
    errNoTab: '无法连接到当前激活的网页标签',
    errExtractFailed: '提取失败，请刷新目标页面后重试',
    errSelectDirFailed: '选择目录失败',
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

  // Detect browser or client default language
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

export function t<K extends keyof typeof messages['en']>(key: K): (typeof messages['en'])[K] {
  const loc = currentLocale.value;
  const dict = messages[loc] || messages['en'];
  return (dict[key] ?? messages['en'][key]) as (typeof messages['en'])[K];
}
