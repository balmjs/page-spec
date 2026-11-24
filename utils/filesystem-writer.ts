/**
 * File System Access API helper to save PRD bundles, Design bundles, API specs,
 * and SpecLoop QA bugfix packs directly into categorized local project folders:
 *   <project-root>/specs/{prd,design,api,qa}
 * (auto-creates folders, prevents nested specs/specs, and preserves legacy requirements/ projects)
 */

import { base64ToUint8Array } from './dom-helpers';
import { computeMarkdownSpecDiff, type SpecDiffResult } from './spec-diff';

const DB_NAME = 'pagespec_db';
const STORE_NAME = 'handles';
const DIR_KEY = 'requirements_directory_handle';
const ROOT_PREF_STORAGE_KEY = 'pagespec_specs_root_preference';

export type SpecsRootDirPreference = 'auto' | 'specs' | 'requirements';
export type SpecCategorySubdir = 'prd' | 'design' | 'api' | 'qa';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load user preference for specs root folder naming ('auto' | 'specs' | 'requirements').
 */
export async function getSpecsRootPreference(): Promise<SpecsRootDirPreference> {
  try {
    const stored = await browser.storage.local.get(ROOT_PREF_STORAGE_KEY);
    const val = stored?.[ROOT_PREF_STORAGE_KEY];
    if (val === 'specs' || val === 'requirements' || val === 'auto') {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return 'auto';
}

export async function saveSpecsRootPreference(pref: SpecsRootDirPreference): Promise<void> {
  try {
    await browser.storage.local.set({ [ROOT_PREF_STORAGE_KEY]: pref });
  } catch {
    // ignore storage errors
  }
}

/**
 * Check if the current browser environment supports the File System Access API.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Prompt the user to select their local project root folder (or an existing specs/requirements folder).
 */
export async function pickRequirementsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('当前浏览器不支持 File System Access API（建议使用 Chrome / Edge 浏览器）');
  }

  const handle = await (window as any).showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'documents',
  });

  // Persist handle in IndexedDB
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(handle, DIR_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return handle;
}

/**
 * Retrieve the saved directory handle from IndexedDB.
 */
export async function getSavedRequirementsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;

  try {
    const db = await openDatabase();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!handle) return null;

    const queryPerm = await (handle as any).queryPermission({ mode: 'readwrite' });
    if (queryPerm === 'granted') {
      return handle;
    }

    return handle;
  } catch {
    return null;
  }
}

/**
 * Ensure readwrite permission is active, prompting user if necessary.
 */
export async function verifyDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return true;

    const requestPerm = await (handle as any).requestPermission({ mode: 'readwrite' });
    return requestPerm === 'granted';
  } catch {
    return false;
  }
}

/**
 * Clear the saved directory handle.
 */
export async function removeSavedRequirementsDirectory(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(DIR_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore deletion errors
  }
}

async function directoryExists(
  parentHandle: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await parentHandle.getDirectoryHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedCategoryDirectory {
  categoryHandle: FileSystemDirectoryHandle;
  specsRootHandle: FileSystemDirectoryHandle;
  resolvedRootName: string; // e.g. 'specs' or 'requirements'
  displayRelativeDir: string; // e.g. 'specs/prd'
}

/**
 * Smartly resolve and auto-create <project-root>/{specs|requirements}/{prd|design|api|qa}:
 * - Anti-nesting guard: if user selected `specs/` or `requirements/` itself, use it directly.
 * - Legacy compat: when preference='auto', keep existing `requirements/` if `specs/` does not exist.
 */
export async function resolveCategoryDirectory(
  boundHandle: FileSystemDirectoryHandle,
  category: SpecCategorySubdir,
  preference: SpecsRootDirPreference = 'auto'
): Promise<ResolvedCategoryDirectory> {
  const handleNameLower = boundHandle.name.toLowerCase();

  let specsRootHandle: FileSystemDirectoryHandle;
  let resolvedRootName: string;

  if (handleNameLower === 'specs' || handleNameLower === 'requirements') {
    specsRootHandle = boundHandle;
    resolvedRootName = boundHandle.name;
  } else {
    let targetRootName = preference === 'requirements' ? 'requirements' : 'specs';
    if (preference === 'auto') {
      const hasSpecs = await directoryExists(boundHandle, 'specs');
      const hasLegacyReq = !hasSpecs && (await directoryExists(boundHandle, 'requirements'));
      targetRootName = hasLegacyReq ? 'requirements' : 'specs';
    }
    specsRootHandle = await boundHandle.getDirectoryHandle(targetRootName, { create: true });
    resolvedRootName = targetRootName;
  }

  const categoryHandle = await specsRootHandle.getDirectoryHandle(category, { create: true });

  return {
    categoryHandle,
    specsRootHandle,
    resolvedRootName,
    displayRelativeDir: `${resolvedRootName}/${category}`,
  };
}

export interface SerializableAsset {
  filename: string; // e.g. "assets/PRD_Title/prototype-001.png"
  base64?: string;
  data?: Uint8Array | number[];
}

export interface DirectoryWriteResult {
  mdFilename: string;
  assetsWritten: number;
  resolvedRootName: string;
  displayRelativeDir: string;
  relativeMdPath: string;
  relativeDiffPath?: string;
  diffFilename?: string;
  diffSummary?: SpecDiffResult;
}

/**
 * Try reading an existing text file from a directory (returns null if it doesn't exist).
 */
async function readExistingTextFile(
  dirHandle: FileSystemDirectoryHandle,
  filename: string
): Promise<string | null> {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * Write a text file to a directory.
 */
async function writeTextFile(
  dirHandle: FileSystemDirectoryHandle,
  filename: string,
  content: string
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Recursively get or create nested file handle under a root directory handle.
 */
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

/**
 * Write binary assets into nested subdirectories co-located within the category directory.
 */
async function writeAssetsToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  assets: Array<SerializableAsset>
): Promise<number> {
  let assetsWritten = 0;
  if (!assets || assets.length === 0) return 0;

  for (const asset of assets) {
    try {
      const assetFileHandle = await getNestedFileHandle(dirHandle, asset.filename);
      const assetWritable = await (assetFileHandle as any).createWritable();

      let dataBuffer: Uint8Array;
      if (asset.base64) {
        dataBuffer = base64ToUint8Array(asset.base64);
      } else if (asset.data instanceof Uint8Array) {
        dataBuffer = asset.data;
      } else if (Array.isArray(asset.data)) {
        dataBuffer = new Uint8Array(asset.data);
      } else {
        throw new Error('Asset has no valid data or base64 payload');
      }

      await assetWritable.write(dataBuffer);
      await assetWritable.close();
      assetsWritten++;
    } catch (err) {
      console.warn(`[PageSpec] Failed to write asset ${asset.filename}:`, err);
    }
  }
  return assetsWritten;
}

/**
 * Helper: write Markdown with automatic incremental diff detection against existing local file.
 */
async function writeMarkdownWithDiff(
  dirHandle: FileSystemDirectoryHandle,
  mdFilename: string,
  diffFilename: string,
  title: string,
  newMarkdown: string
): Promise<{ diffFilename?: string; diffSummary?: SpecDiffResult }> {
  const oldMarkdown = await readExistingTextFile(dirHandle, mdFilename);
  await writeTextFile(dirHandle, mdFilename, newMarkdown);

  if (oldMarkdown !== null) {
    const diff = computeMarkdownSpecDiff(oldMarkdown, newMarkdown, title, mdFilename);
    if (diff.hasChanges) {
      await writeTextFile(dirHandle, diffFilename, diff.diffMarkdown);
      return { diffFilename, diffSummary: diff };
    }
  }
  return {};
}

/**
 * Overwrite an existing Markdown file (e.g. after interactive section trimming).
 */
export async function overwriteMarkdownInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  mdFilename: string,
  markdown: string,
  category?: SpecCategorySubdir,
  preference?: SpecsRootDirPreference
): Promise<void> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }
  if (category) {
    const pref = preference ?? (await getSpecsRootPreference());
    const resolved = await resolveCategoryDirectory(dirHandle, category, pref);
    await writeTextFile(resolved.categoryHandle, mdFilename, markdown);
  } else {
    await writeTextFile(dirHandle, mdFilename, markdown);
  }
}

/**
 * Write extracted PRD Markdown and co-located assets into <project-root>/{specs|requirements}/prd/.
 */
export async function writePrdBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  },
  preference?: SpecsRootDirPreference
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const pref = preference ?? (await getSpecsRootPreference());
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'prd',
    pref
  );

  const mdFilename = `${payload.sanitizedTitle}.md`;
  const diffFilename = `${payload.sanitizedTitle}.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    categoryHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );
  const assetsWritten = await writeAssetsToDirectory(categoryHandle, payload.assets);

  return {
    mdFilename,
    assetsWritten,
    resolvedRootName,
    displayRelativeDir,
    relativeMdPath: `${displayRelativeDir}/${mdFilename}`,
    relativeDiffPath: diffInfo.diffFilename
      ? `${displayRelativeDir}/${diffInfo.diffFilename}`
      : undefined,
    ...diffInfo,
  };
}

/**
 * Write extracted Design Spec Markdown and artboard assets into <project-root>/{specs|requirements}/design/.
 */
export async function writeDesignBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  },
  preference?: SpecsRootDirPreference
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const pref = preference ?? (await getSpecsRootPreference());
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'design',
    pref
  );

  const mdFilename = `${payload.sanitizedTitle}.md`;
  const diffFilename = `${payload.sanitizedTitle}.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    categoryHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );
  const assetsWritten = await writeAssetsToDirectory(categoryHandle, payload.assets);

  return {
    mdFilename,
    assetsWritten,
    resolvedRootName,
    displayRelativeDir,
    relativeMdPath: `${displayRelativeDir}/${mdFilename}`,
    relativeDiffPath: diffInfo.diffFilename
      ? `${displayRelativeDir}/${diffInfo.diffFilename}`
      : undefined,
    ...diffInfo,
  };
}

/**
 * Write extracted API Spec into <project-root>/{specs|requirements}/api/.
 */
export async function writeApiSpecToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
  },
  preference?: SpecsRootDirPreference
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const pref = preference ?? (await getSpecsRootPreference());
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'api',
    pref
  );

  const mdFilename = `${payload.sanitizedTitle}.md`;
  const diffFilename = `${payload.sanitizedTitle}.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    categoryHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );

  return {
    mdFilename,
    assetsWritten: 0,
    resolvedRootName,
    displayRelativeDir,
    relativeMdPath: `${displayRelativeDir}/${mdFilename}`,
    relativeDiffPath: diffInfo.diffFilename
      ? `${displayRelativeDir}/${diffInfo.diffFilename}`
      : undefined,
    ...diffInfo,
  };
}

/**
 * Write QA failure bugfix bundle pulled from SpecLoop into <project-root>/{specs|requirements}/qa/.
 */
export async function writeQaFixesBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  },
  preference?: SpecsRootDirPreference
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const pref = preference ?? (await getSpecsRootPreference());
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'qa',
    pref
  );

  const mdFilename = `${payload.sanitizedTitle}-bugs.md`;
  const diffFilename = `${payload.sanitizedTitle}-bugs.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    categoryHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );
  const assetsWritten = await writeAssetsToDirectory(categoryHandle, payload.assets);

  return {
    mdFilename,
    assetsWritten,
    resolvedRootName,
    displayRelativeDir,
    relativeMdPath: `${displayRelativeDir}/${mdFilename}`,
    relativeDiffPath: diffInfo.diffFilename
      ? `${displayRelativeDir}/${diffInfo.diffFilename}`
      : undefined,
    ...diffInfo,
  };
}
