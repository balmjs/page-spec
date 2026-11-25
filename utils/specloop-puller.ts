/**
 * SpecLoop Reverse Puller (v1.2)
 * Pulls finalized PRD / Design / API specs and Stage 4 QA failure bugfix packs
 * directly from SpecLoop into the local bound project specs/{prd,design,api,qa} folders.
 */

import {
  writePrdBundleToDirectory,
  writeDesignBundleToDirectory,
  writeApiSpecToDirectory,
  writeQaFixesBundleToDirectory,
  normalizeSpecsRootDir,
  type SerializableAsset,
} from './filesystem-writer';
import { specLoopApiRequest, type SpecLoopConfig } from './specloop-bridge';

export interface PullFullSpecsResult {
  ok: boolean;
  writtenPaths: string[];
  assetsWritten: number;
  resolvedRootName?: string;
  prompt?: string;
  error?: string;
}

export interface PullQaFailuresResult {
  ok: boolean;
  failedCount: number;
  relativeMdPath?: string;
  assetsWritten: number;
  prompt?: string;
  error?: string;
}

interface RemoteSpecPayload {
  taskId: string;
  title: string;
  sanitizedTitle: string;
  prd?: {
    markdown: string;
    assets?: SerializableAsset[];
  };
  design?: {
    markdown: string;
    assets?: SerializableAsset[];
  };
  api?: {
    markdown: string;
  };
}

interface RemoteQaFailuresPayload {
  taskId: string;
  title: string;
  sanitizedTitle: string;
  failedCount: number;
  markdown: string;
  assets: SerializableAsset[];
}

/**
 * Pull full finalized PRD + Design + API specifications of a SpecLoop task into local specs/.
 */
export async function pullTaskFullSpecsToLocal(params: {
  dirHandle: FileSystemDirectoryHandle;
  config: SpecLoopConfig;
  taskId: string;
  specsRootDir?: string;
}): Promise<PullFullSpecsResult> {
  const res = await specLoopApiRequest<RemoteSpecPayload>({
    config: params.config,
    method: 'GET',
    path: `/api/v1/tasks/${encodeURIComponent(params.taskId)}/specs-payload`,
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      writtenPaths: [],
      assetsWritten: 0,
      error: res.error || '拉取任务规格包失败',
    };
  }

  const payload = res.data;
  const writtenPaths: string[] = [];
  let assetsWritten = 0;
  let resolvedRootName = normalizeSpecsRootDir(params.specsRootDir);

  if (payload.prd?.markdown?.trim()) {
    const r = await writePrdBundleToDirectory(
      params.dirHandle,
      {
        title: payload.title,
        sanitizedTitle: payload.sanitizedTitle,
        markdown: payload.prd.markdown,
        assets: payload.prd.assets || [],
      },
      params.specsRootDir
    );
    writtenPaths.push(r.relativeMdPath);
    assetsWritten += r.assetsWritten;
    resolvedRootName = r.resolvedRootName;
  }

  if (payload.design?.markdown?.trim()) {
    const r = await writeDesignBundleToDirectory(
      params.dirHandle,
      {
        title: payload.title,
        sanitizedTitle: payload.sanitizedTitle,
        markdown: payload.design.markdown,
        assets: payload.design.assets || [],
      },
      params.specsRootDir
    );
    writtenPaths.push(r.relativeMdPath);
    assetsWritten += r.assetsWritten;
    resolvedRootName = r.resolvedRootName;
  }

  if (payload.api?.markdown?.trim()) {
    const r = await writeApiSpecToDirectory(
      params.dirHandle,
      {
        title: payload.title,
        sanitizedTitle: payload.sanitizedTitle,
        markdown: payload.api.markdown,
      },
      params.specsRootDir
    );
    writtenPaths.push(r.relativeMdPath);
    resolvedRootName = r.resolvedRootName;
  }

  const refs = writtenPaths.map((p) => `@${p}`).join(' ');
  const prompt = refs
    ? `${refs} 请严格按照以上 SpecLoop 定稿的需求、设计画板与接口规格实现功能`
    : undefined;

  return {
    ok: true,
    writtenPaths,
    assetsWritten,
    resolvedRootName,
    prompt,
  };
}

/**
 * Pull Stage 4 QA failure items and captured screenshots directly into local specs/qa/.
 */
export async function pullTaskQaFailuresToLocal(params: {
  dirHandle: FileSystemDirectoryHandle;
  config: SpecLoopConfig;
  taskId: string;
  specsRootDir?: string;
}): Promise<PullQaFailuresResult> {
  const res = await specLoopApiRequest<RemoteQaFailuresPayload>({
    config: params.config,
    method: 'GET',
    path: `/api/v1/tasks/${encodeURIComponent(params.taskId)}/qa-failures-payload`,
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      failedCount: 0,
      assetsWritten: 0,
      error: res.error || '拉取测试打回包失败',
    };
  }

  const payload = res.data;
  if (!payload.failedCount || !payload.markdown?.trim()) {
    return {
      ok: true,
      failedCount: 0,
      assetsWritten: 0,
    };
  }

  const r = await writeQaFixesBundleToDirectory(
    params.dirHandle,
    {
      title: payload.title,
      sanitizedTitle: payload.sanitizedTitle,
      markdown: payload.markdown,
      assets: payload.assets || [],
    },
    params.specsRootDir
  );

  const prompt = `@${r.relativeMdPath} @${r.resolvedRootName}/prd/${payload.sanitizedTitle}.md 请逐条排查并修复测试打回的失败项（结合 ${r.displayRelativeDir}/assets/${payload.sanitizedTitle}/ 下的报错截图与控制台日志）。`;

  return {
    ok: true,
    failedCount: payload.failedCount,
    relativeMdPath: r.relativeMdPath,
    assetsWritten: r.assetsWritten,
    prompt,
  };
}
