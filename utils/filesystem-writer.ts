/**
 * File System Access API helper to save PRD bundles, Design bundles, and API specs
 * directly into local project requirements/ directories with automatic incremental diff detection.
 */

import { base64ToUint8Array } from './dom-helpers';
import { computeMarkdownSpecDiff, type SpecDiffResult } from './spec-diff';

const DB_NAME = 'pagespec_db';
const STORE_NAME = 'handles';
const DIR_KEY = 'requirements_directory_handle';

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
 * Check if the current browser environment supports the File System Access API.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Prompt the user to select their local project requirements directory.
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

export interface SerializableAsset {
  filename: string; // e.g. "assets/PRD_Title/prototype-001.png"
  base64?: string;
  data?: Uint8Array | number[];
}

export interface DirectoryWriteResult {
  mdFilename: string;
  assetsWritten: number;
  diffFilename?: string;
  diffSummary?: SpecDiffResult;
}

/**
 * Try reading an existing text file from the bound directory (returns null if it doesn't exist).
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
 * Write a text file to the root of dirHandle.
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
 * Write binary assets into nested subdirectories.
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
  markdown: string
): Promise<void> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }
  await writeTextFile(dirHandle, mdFilename, markdown);
}

/**
 * Write extracted PRD Markdown and assets directly to local project directory.
 */
export async function writePrdBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  }
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const mdFilename = `${payload.sanitizedTitle}.md`;
  const diffFilename = `${payload.sanitizedTitle}.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    dirHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );
  const assetsWritten = await writeAssetsToDirectory(dirHandle, payload.assets);

  return { mdFilename, assetsWritten, ...diffInfo };
}

/**
 * Write extracted Design Spec Markdown and artboard assets directly to local project directory.
 */
export async function writeDesignBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  }
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const mdFilename = `${payload.sanitizedTitle}-design.md`;
  const diffFilename = `${payload.sanitizedTitle}-design.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    dirHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );
  const assetsWritten = await writeAssetsToDirectory(dirHandle, payload.assets);

  return { mdFilename, assetsWritten, ...diffInfo };
}

/**
 * Write extracted API Spec directly to local project directory.
 */
export async function writeApiSpecToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
  }
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const mdFilename = `${payload.sanitizedTitle}-api.md`;
  const diffFilename = `${payload.sanitizedTitle}-api.diff.md`;
  const diffInfo = await writeMarkdownWithDiff(
    dirHandle,
    mdFilename,
    diffFilename,
    payload.title || payload.sanitizedTitle,
    payload.markdown
  );

  return { mdFilename, assetsWritten: 0, ...diffInfo };
}
