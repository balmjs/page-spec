/**
 * File System Access API helper to save PRD bundles and API specs
 * directly into local project requirements/ directories.
 */

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

    // Check existing permission
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

import { base64ToUint8Array } from './dom-helpers';

export interface SerializableAsset {
  filename: string; // e.g. "assets/PRD_Title/prototype-001.png"
  base64?: string;
  data?: Uint8Array | number[];
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
 * Write extracted PRD Markdown and assets directly to local project directory.
 */
export async function writePrdBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  }
): Promise<{ mdFilename: string; assetsWritten: number }> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  // 1. Write Markdown file
  const mdFilename = `${payload.sanitizedTitle}.md`;
  const mdFileHandle = await dirHandle.getFileHandle(mdFilename, { create: true });
  const mdWritable = await (mdFileHandle as any).createWritable();
  await mdWritable.write(payload.markdown);
  await mdWritable.close();

  // 2. Write assets if any exist
  let assetsWritten = 0;
  if (payload.assets && payload.assets.length > 0) {
    for (const asset of payload.assets) {
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
  }

  return { mdFilename, assetsWritten };
}

/**
 * Write extracted API Spec directly to local project directory.
 */
export async function writeApiSpecToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    sanitizedTitle: string;
    markdown: string;
  }
): Promise<{ mdFilename: string }> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const mdFilename = `${payload.sanitizedTitle}-api.md`;
  const mdFileHandle = await dirHandle.getFileHandle(mdFilename, { create: true });
  const mdWritable = await (mdFileHandle as any).createWritable();
  await mdWritable.write(payload.markdown);
  await mdWritable.close();

  return { mdFilename };
}
