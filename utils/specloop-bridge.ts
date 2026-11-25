/**
 * SpecLoop Bridge Utilities (v1.2)
 * Handles optional SpecLoop server configuration, one-click extension handshake,
 * dynamic project/task listing, SpecBundle export/push, and live QA companion APIs.
 */

import { buildSpecBundleArchive, type SpecBundleManifest } from '../core/bundler/zip-builder';
import { base64ToUint8Array } from './dom-helpers';
import type { SerializableAsset } from './filesystem-writer';

export interface SpecLoopConfig {
  baseUrl: string;
  apiToken: string;
  defaultTaskId: string;
  defaultProjectId: string;
  userEmail?: string;
  userDisplayName?: string;
}

export interface SpecLoopProjectSummary {
  id: string;
  slug: string;
  name: string;
  workflowMode: string;
  defaultReleaseBranch?: string;
}

export interface SpecLoopTaskSummary {
  id: string;
  projectId: string;
  title: string;
  sanitizedTitle: string;
  currentStage: string;
  failedTestCount?: number;
  passedTestCount?: number;
  totalTestCount?: number;
  prdSections?: string[];
}

export interface SpecLoopTestItem {
  id: string;
  taskId: string;
  category: string;
  boundSection?: string;
  title: string;
  steps: string;
  expectedResult: string;
  priority: string;
  status: 'pending' | 'passed' | 'failed' | 'stale';
  testerNote?: string;
  screenshotUrl?: string;
  pageUrl?: string;
  checkedBy?: string;
  checkedAt?: string;
}

export interface QaDiagnosticEntry {
  kind: 'console' | 'exception' | 'http';
  message: string;
  timestamp: string;
}

export interface QaDiagnosticSnapshot {
  url: string;
  title: string;
  viewport: string;
  userAgent: string;
  errors: QaDiagnosticEntry[];
}

const STORAGE_KEY = 'pagespec_specloop_config';
const PENDING_AUTH_KEY = 'pagespec_pending_auth_origin';
export const PAGESPEC_VERSION =
  (typeof browser !== 'undefined' && browser.runtime?.getManifest?.()?.version) || '1.2.0';

export function normalizeSpecLoopBaseUrl(raw: string): { baseUrl: string; origin: string } | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(\/|$)/i.test(
      candidate
    );
    candidate = `${isLocalHost ? 'http' : 'https'}://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.origin || parsed.origin === 'null') return null;

    // Strip hash/query and any accidental SpecLoop SPA route suffix
    let pathname = parsed.pathname.replace(/\/+$/, '');
    if (/^\/(auth|board|tasks|projects|admin|login|api)(\/|$)/i.test(pathname)) {
      pathname = '';
    }
    return {
      baseUrl: `${parsed.origin}${pathname}`,
      origin: parsed.origin,
    };
  } catch {
    return null;
  }
}

export function isSpecLoopConnected(config?: Partial<SpecLoopConfig> | null): boolean {
  return Boolean(config?.baseUrl?.trim() && config?.apiToken?.trim());
}

export async function getSpecLoopConfig(): Promise<SpecLoopConfig> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const cfg = stored?.[STORAGE_KEY] as Partial<SpecLoopConfig> | undefined;
    return {
      baseUrl: cfg?.baseUrl || '',
      apiToken: cfg?.apiToken || '',
      defaultTaskId: cfg?.defaultTaskId || '',
      defaultProjectId: cfg?.defaultProjectId || '',
      userEmail: cfg?.userEmail || '',
      userDisplayName: cfg?.userDisplayName || '',
    };
  } catch {
    return {
      baseUrl: '',
      apiToken: '',
      defaultTaskId: '',
      defaultProjectId: '',
      userEmail: '',
      userDisplayName: '',
    };
  }
}

export async function saveSpecLoopConfig(config: SpecLoopConfig): Promise<void> {
  const normalized = normalizeSpecLoopBaseUrl(config.baseUrl);
  const cleaned: SpecLoopConfig = {
    baseUrl: normalized ? normalized.baseUrl : config.baseUrl.trim().replace(/\/+$/, ''),
    apiToken: config.apiToken.trim(),
    defaultTaskId: config.defaultTaskId.trim(),
    defaultProjectId: (config.defaultProjectId || '').trim(),
    userEmail: config.userEmail?.trim() || '',
    userDisplayName: config.userDisplayName?.trim() || '',
  };
  await browser.storage.local.set({ [STORAGE_KEY]: cleaned });
}

export async function disconnectSpecLoop(): Promise<SpecLoopConfig> {
  const current = await getSpecLoopConfig();
  const next: SpecLoopConfig = {
    baseUrl: current.baseUrl,
    apiToken: '',
    defaultTaskId: '',
    defaultProjectId: '',
    userEmail: '',
    userDisplayName: '',
  };
  await saveSpecLoopConfig(next);
  return next;
}

export async function specLoopApiRequest<T = any>(params: {
  config: SpecLoopConfig;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
}): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const baseUrl = params.config.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: '未配置 SpecLoop 服务器地址' };
  }

  const normalizedPath = params.path.startsWith('/') ? params.path : `/${params.path}`;
  const url = `${baseUrl}${normalizedPath}`;

  const res: any = await browser.runtime.sendMessage({
    type: 'SPECLOOP_API_REQUEST',
    url,
    method: params.method || 'GET',
    apiToken: params.config.apiToken,
    body: params.body,
  });

  return res || { ok: false, error: '无法连接到后台通信代理' };
}

/**
 * Open SpecLoop's passwordless extension handshake page to obtain a scoped PAT without copy-pasting.
 */
export async function startSpecLoopAuthHandshake(
  baseUrl: string
): Promise<{ ok: boolean; normalizedBaseUrl?: string; error?: string }> {
  const parsed = normalizeSpecLoopBaseUrl(baseUrl);
  if (!parsed) {
    return {
      ok: false,
      error: '服务地址格式无效，请输入完整地址（如 http://localhost:8080 或 https://specloop.yourdomain.com）',
    };
  }

  const authUrl = `${parsed.baseUrl}/#/auth/extension-connect?client=pagespec&version=${encodeURIComponent(PAGESPEC_VERSION)}`;

  // Record expected origin directly in extension storage so handshake verification works reliably
  try {
    await browser.storage.local.set({ [PENDING_AUTH_KEY]: parsed.origin });
  } catch (err: any) {
    return { ok: false, error: `写入授权状态失败：${err?.message || String(err)}` };
  }

  // Open auth tab directly from Popup/SidePanel without relying on MV3 Service Worker message wake-up
  try {
    if (browser.tabs?.create) {
      await browser.tabs.create({ url: authUrl });
      return { ok: true, normalizedBaseUrl: parsed.baseUrl };
    }
  } catch {
    // fall through to background / window.open fallback
  }

  try {
    const res: any = await browser.runtime.sendMessage({
      type: 'OPEN_SPECLOOP_AUTH_TAB',
      baseUrl: parsed.baseUrl,
      version: PAGESPEC_VERSION,
    });
    if (res?.ok) {
      return { ok: true, normalizedBaseUrl: parsed.baseUrl };
    }
  } catch {
    // fall through to window.open
  }

  try {
    const win = window.open(authUrl, '_blank', 'noopener');
    if (win) {
      return { ok: true, normalizedBaseUrl: parsed.baseUrl };
    }
  } catch {
    // ignore
  }

  return { ok: false, error: `无法自动打开授权页，请手动访问：${authUrl}` };
}

/**
 * Verify SpecLoop connection & token health via GET /api/v1/auth/me.
 */
export async function verifySpecLoopConnection(config: SpecLoopConfig): Promise<{
  ok: boolean;
  email?: string;
  displayName?: string;
  error?: string;
}> {
  const res = await specLoopApiRequest<{ user?: { email: string; displayName?: string } }>({
    config,
    method: 'GET',
    path: '/api/v1/auth/me',
  });
  if (!res.ok) {
    return { ok: false, error: res.error || '连接校验失败' };
  }
  const user = res.data?.user || (res.data as any);
  return {
    ok: true,
    email: user?.email,
    displayName: user?.displayName || user?.display_name,
  };
}

/**
 * Fetch available projects from SpecLoop.
 */
export async function fetchSpecLoopProjects(
  config: SpecLoopConfig
): Promise<{ ok: boolean; projects: SpecLoopProjectSummary[]; error?: string }> {
  const res = await specLoopApiRequest<{ projects?: any[] }>({
    config,
    method: 'GET',
    path: '/api/v1/projects',
  });
  if (!res.ok) {
    return { ok: false, projects: [], error: res.error };
  }
  const rawList = Array.isArray(res.data?.projects)
    ? res.data.projects
    : Array.isArray(res.data)
      ? res.data
      : [];
  const projects: SpecLoopProjectSummary[] = rawList.map((p: any) => ({
    id: p.id,
    slug: p.slug || p.id,
    name: p.name,
    workflowMode: p.workflowMode || p.workflow_mode || 'agile',
    defaultReleaseBranch: p.defaultReleaseBranch || p.default_release_branch || 'release',
  }));
  return { ok: true, projects };
}

/**
 * Fetch active tasks in SpecLoop for dynamic task picker dropdown.
 */
export async function fetchSpecLoopTasks(
  config: SpecLoopConfig,
  projectId?: string
): Promise<{ ok: boolean; tasks: SpecLoopTaskSummary[]; error?: string }> {
  const qs = new URLSearchParams({ activeOnly: 'true' });
  const targetProject = projectId || config.defaultProjectId;
  if (targetProject) {
    qs.set('projectId', targetProject);
  }
  const res = await specLoopApiRequest<{ tasks?: any[] }>({
    config,
    method: 'GET',
    path: `/api/v1/tasks?${qs.toString()}`,
  });
  if (!res.ok) {
    return { ok: false, tasks: [], error: res.error };
  }
  const rawList = Array.isArray(res.data?.tasks)
    ? res.data.tasks
    : Array.isArray(res.data)
      ? res.data
      : [];
  const tasks: SpecLoopTaskSummary[] = rawList.map((t: any) => ({
    id: t.id,
    projectId: t.projectId || t.project_id || '',
    title: t.title,
    sanitizedTitle: t.sanitizedTitle || t.sanitized_title || t.title,
    currentStage: t.currentStage || t.current_stage || 'pm_draft',
    failedTestCount: t.failedTestCount ?? t.failed_test_count ?? 0,
    passedTestCount: t.passedTestCount ?? t.passed_test_count ?? 0,
    totalTestCount: t.totalTestCount ?? t.total_test_count ?? 0,
    prdSections: Array.isArray(t.prdSections) ? t.prdSections : undefined,
  }));
  return { ok: true, tasks };
}

/**
 * Fetch Stage 4 QA Test List for a given SpecLoop task.
 */
export async function fetchTaskTestItems(
  config: SpecLoopConfig,
  taskId: string
): Promise<{ ok: boolean; items: SpecLoopTestItem[]; error?: string }> {
  const res = await specLoopApiRequest<{ items?: any[] }>({
    config,
    method: 'GET',
    path: `/api/v1/tasks/${encodeURIComponent(taskId)}/test-items`,
  });
  if (!res.ok) {
    return { ok: false, items: [], error: res.error };
  }
  const rawList = Array.isArray(res.data?.items)
    ? res.data.items
    : Array.isArray(res.data)
      ? res.data
      : [];
  const items: SpecLoopTestItem[] = rawList.map((i: any) => ({
    id: i.id,
    taskId: i.taskId || i.task_id || taskId,
    category: i.category || '正向主流程',
    boundSection: i.boundSection || i.bound_section || '',
    title: i.title,
    steps: i.steps || '',
    expectedResult: i.expectedResult || i.expected_result || '',
    priority: i.priority || 'P1',
    status: i.status || 'pending',
    testerNote: i.testerNote || i.tester_note || '',
    screenshotUrl: i.screenshotUrl || i.screenshot_url || '',
    pageUrl: i.pageUrl || i.page_url || '',
    checkedBy: i.checkedBy || i.checked_by || '',
    checkedAt: i.checkedAt || i.checked_at || '',
  }));
  return { ok: true, items };
}

/**
 * Update a single Stage 4 QA test item status (with optional auto-captured screenshot + diagnostics).
 */
export async function updateTaskTestItemStatus(params: {
  config: SpecLoopConfig;
  taskId: string;
  itemId: string;
  status: 'passed' | 'failed' | 'pending';
  testerNote?: string;
  screenshotBase64?: string;
  pageUrl?: string;
  consoleErrors?: QaDiagnosticEntry[];
}): Promise<{ ok: boolean; item?: SpecLoopTestItem; unlockedRelease?: boolean; error?: string }> {
  const res = await specLoopApiRequest<any>({
    config: params.config,
    method: 'PATCH',
    path: `/api/v1/tasks/${encodeURIComponent(params.taskId)}/test-items/${encodeURIComponent(params.itemId)}`,
    body: {
      status: params.status,
      testerNote: params.testerNote,
      screenshotBase64: params.screenshotBase64,
      pageUrl: params.pageUrl,
      consoleErrors: params.consoleErrors,
    },
  });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  return {
    ok: true,
    item: res.data?.item,
    unlockedRelease: Boolean(res.data?.unlockedRelease),
  };
}

export function createSpecBundleManifest(params: {
  type: 'prd' | 'design' | 'api';
  title: string;
  sanitizedTitle: string;
  sourceUrl: string;
  markdownFile: string;
  diffFile?: string;
  assetsCount: number;
  endpointsCount?: number;
  artboardsCount?: number;
  platform?: string;
}): SpecBundleManifest {
  return {
    schemaVersion: '1.0',
    generator: 'PageSpec',
    generatorVersion: PAGESPEC_VERSION,
    type: params.type,
    title: params.title,
    sanitizedTitle: params.sanitizedTitle,
    sourceUrl: params.sourceUrl,
    extractedAt: new Date().toISOString(),
    markdownFile: params.markdownFile,
    ...(params.diffFile ? { diffFile: params.diffFile } : {}),
    assetsCount: params.assetsCount,
    ...(params.endpointsCount !== undefined ? { endpointsCount: params.endpointsCount } : {}),
    ...(params.artboardsCount !== undefined ? { artboardsCount: params.artboardsCount } : {}),
    ...(params.platform ? { platform: params.platform } : {}),
  };
}

/**
 * Trigger browser download of a standardized `.specbundle.zip` archive (contains manifest.json + spec + assets).
 */
export async function downloadSpecBundleZip(params: {
  manifest: SpecBundleManifest;
  markdown: string;
  diffMarkdown?: string;
  assets: SerializableAsset[];
}): Promise<void> {
  const binaryAssets = params.assets.map((a) => ({
    filename: a.filename,
    data: a.base64
      ? base64ToUint8Array(a.base64)
      : a.data instanceof Uint8Array
        ? a.data
        : new Uint8Array(a.data || []),
  }));

  const extraFiles =
    params.diffMarkdown && params.manifest.diffFile
      ? [{ filename: params.manifest.diffFile, content: params.diffMarkdown }]
      : [];

  const blob = buildSpecBundleArchive({
    manifest: params.manifest,
    markdown: params.markdown,
    markdownFilename: params.manifest.markdownFile,
    assets: binaryAssets,
    extraFiles,
  });

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${params.manifest.sanitizedTitle}-${params.manifest.type}.specbundle.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/**
 * Push a standardized SpecBundle payload directly to a configured SpecLoop server via Background Service Worker.
 */
export async function pushSpecBundleToSpecLoop(params: {
  config: SpecLoopConfig;
  manifest: SpecBundleManifest;
  markdown: string;
  diffMarkdown?: string;
  assets: SerializableAsset[];
  taskId?: string;
  projectId?: string;
  sectionAnchor?: string;
}): Promise<{ ok: boolean; taskId?: string; staleTestCount?: number; message?: string; error?: string }> {
  const baseUrl = params.config.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: '未配置 SpecLoop 服务器地址，请先在「目录与配置」中填写' };
  }

  const endpoint = `${baseUrl}/api/v1/import/pagespec`;
  const res: any = await browser.runtime.sendMessage({
    type: 'PUSH_TO_SPECLOOP',
    endpoint,
    apiToken: params.config.apiToken,
    payload: {
      taskId: params.taskId !== undefined ? params.taskId || undefined : params.config.defaultTaskId || undefined,
      projectId: params.projectId || params.config.defaultProjectId || undefined,
      sectionAnchor: params.sectionAnchor || undefined,
      manifest: params.manifest,
      markdown: params.markdown,
      diffMarkdown: params.diffMarkdown || undefined,
      assets: params.assets.map((a) => ({
        filename: a.filename,
        base64: a.base64 || '',
      })),
    },
  });

  return res || { ok: false, error: '无法连接到后台推送服务' };
}
