/**
 * SpecLoop Bridge Utilities
 * Handles optional SpecLoop server configuration and standardized SpecBundle export / HTTP push.
 */

import { buildSpecBundleArchive, type SpecBundleManifest } from '../core/bundler/zip-builder';
import { base64ToUint8Array } from './dom-helpers';
import type { SerializableAsset } from './filesystem-writer';

export interface SpecLoopConfig {
  baseUrl: string;
  apiToken: string;
  defaultTaskId: string;
}

const STORAGE_KEY = 'pagespec_specloop_config';
export const PAGESPEC_VERSION = '1.1.0';

export async function getSpecLoopConfig(): Promise<SpecLoopConfig> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const cfg = stored?.[STORAGE_KEY] as Partial<SpecLoopConfig> | undefined;
    return {
      baseUrl: cfg?.baseUrl || '',
      apiToken: cfg?.apiToken || '',
      defaultTaskId: cfg?.defaultTaskId || '',
    };
  } catch {
    return { baseUrl: '', apiToken: '', defaultTaskId: '' };
  }
}

export async function saveSpecLoopConfig(config: SpecLoopConfig): Promise<void> {
  const cleaned: SpecLoopConfig = {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    apiToken: config.apiToken.trim(),
    defaultTaskId: config.defaultTaskId.trim(),
  };
  await browser.storage.local.set({ [STORAGE_KEY]: cleaned });
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
}): Promise<{ ok: boolean; taskId?: string; message?: string; error?: string }> {
  const baseUrl = params.config.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: '未配置 SpecLoop 服务器地址，请先在「目录配置」中填写' };
  }

  const endpoint = `${baseUrl}/api/v1/import/pagespec`;
  const res: any = await browser.runtime.sendMessage({
    type: 'PUSH_TO_SPECLOOP',
    endpoint,
    apiToken: params.config.apiToken,
    payload: {
      taskId: params.taskId || params.config.defaultTaskId || undefined,
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
