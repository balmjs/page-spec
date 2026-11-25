/**
 * File System Access API helper to save PRD bundles, Design bundles, API specs,
 * and SpecLoop QA bugfix packs directly into categorized local project folders:
 *   <project-root>/<specs-root>/{prd,design,api,qa}
 * Default <specs-root> is `specs`, customizable per project (including nested relative paths
 * such as `docs/specs`), with anti-nesting protection and non-destructive conflict probing.
 */

import { base64ToUint8Array } from './dom-helpers';
import { computeMarkdownSpecDiff, type SpecDiffResult } from './spec-diff';

const DB_NAME = 'pagespec_db';
const STORE_NAME = 'handles';
// Keep historical IndexedDB key unchanged so existing users retain their bound folder handle on upgrade.
const DIR_KEY = 'requirements_directory_handle';

export const GLOBAL_ROOT_DIR_STORAGE_KEY = 'pagespec_specs_root_dir';
export const PROJECT_ROOT_OVERRIDES_STORAGE_KEY = 'pagespec_specs_root_overrides';
export const DEFAULT_SPECS_ROOT_DIR = 'specs';
export const SPECS_ROOT_PRESETS = ['specs', 'docs/specs', 'page-specs', '.specs'] as const;

export type SpecCategorySubdir = 'prd' | 'design' | 'api' | 'qa';

const KNOWN_CATEGORY_DIRS: ReadonlySet<string> = new Set(['prd', 'design', 'api', 'qa']);
const IGNORED_CONFLICT_FILES: ReadonlySet<string> = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  '.gitkeep',
  'readme.md',
]);
const INVALID_SEGMENT_CHARS = /[<>:"\\|?*\x00-\x1f]/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export interface SpecsRootSettings {
  defaultRootDir: string;
  projectOverrides: Record<string, string>;
}

export type SpecsRootValidationErrorCode =
  | 'absolute'
  | 'traversal'
  | 'invalid_chars'
  | 'reserved_segment';

export interface SpecsRootValidationResult {
  valid: boolean;
  normalized: string;
  segments: string[];
  errorCode?: SpecsRootValidationErrorCode;
}

export interface SpecsRootConflictReport {
  status: 'clean' | 'pagespec_existing' | 'conflict' | 'permission_needed' | 'invalid';
  resolvedRootPath: string;
  nonSpecEntries: string[];
  totalNonSpecCount: number;
  suggestedAlternatives: string[];
}

/**
 * Validate and normalize a user-specified specs root directory path.
 * Accepts single folder names (`specs`, `page-specs`, `.specs`) and nested relative paths (`docs/specs`).
 * Empty input falls back to DEFAULT_SPECS_ROOT_DIR (`specs`).
 */
export function validateSpecsRootDir(raw: string): SpecsRootValidationResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return {
      valid: true,
      normalized: DEFAULT_SPECS_ROOT_DIR,
      segments: [DEFAULT_SPECS_ROOT_DIR],
    };
  }

  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    trimmed.startsWith('~/') ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    return {
      valid: false,
      normalized: DEFAULT_SPECS_ROOT_DIR,
      segments: [DEFAULT_SPECS_ROOT_DIR],
      errorCode: 'absolute',
    };
  }

  const cleaned = trimmed.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (!cleaned) {
    return {
      valid: true,
      normalized: DEFAULT_SPECS_ROOT_DIR,
      segments: [DEFAULT_SPECS_ROOT_DIR],
    };
  }

  const segments = cleaned.split('/');
  for (const seg of segments) {
    if (!seg) {
      return {
        valid: false,
        normalized: DEFAULT_SPECS_ROOT_DIR,
        segments: [DEFAULT_SPECS_ROOT_DIR],
        errorCode: 'invalid_chars',
      };
    }
    if (seg === '.' || seg === '..') {
      return {
        valid: false,
        normalized: DEFAULT_SPECS_ROOT_DIR,
        segments: [DEFAULT_SPECS_ROOT_DIR],
        errorCode: 'traversal',
      };
    }
    if (INVALID_SEGMENT_CHARS.test(seg) || seg.endsWith('.') || seg.endsWith(' ')) {
      return {
        valid: false,
        normalized: DEFAULT_SPECS_ROOT_DIR,
        segments: [DEFAULT_SPECS_ROOT_DIR],
        errorCode: 'invalid_chars',
      };
    }
    if (WINDOWS_RESERVED_NAME.test(seg)) {
      return {
        valid: false,
        normalized: DEFAULT_SPECS_ROOT_DIR,
        segments: [DEFAULT_SPECS_ROOT_DIR],
        errorCode: 'reserved_segment',
      };
    }
  }

  return {
    valid: true,
    normalized: segments.join('/'),
    segments,
  };
}

export function normalizeSpecsRootDir(raw?: string): string {
  const res = validateSpecsRootDir(raw || '');
  return res.valid ? res.normalized : DEFAULT_SPECS_ROOT_DIR;
}

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
 * Load global default specs root directory and per-project overrides.
 */
export async function getSpecsRootSettings(): Promise<SpecsRootSettings> {
  try {
    const stored = await browser.storage.local.get([
      GLOBAL_ROOT_DIR_STORAGE_KEY,
      PROJECT_ROOT_OVERRIDES_STORAGE_KEY,
    ]);
    const defaultRootDir = normalizeSpecsRootDir(
      typeof stored?.[GLOBAL_ROOT_DIR_STORAGE_KEY] === 'string'
        ? stored[GLOBAL_ROOT_DIR_STORAGE_KEY]
        : DEFAULT_SPECS_ROOT_DIR
    );
    const rawOverrides = stored?.[PROJECT_ROOT_OVERRIDES_STORAGE_KEY];
    const projectOverrides: Record<string, string> = {};
    if (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
      for (const [projectName, dirVal] of Object.entries(rawOverrides)) {
        if (projectName && typeof dirVal === 'string') {
          const check = validateSpecsRootDir(dirVal);
          if (check.valid) {
            projectOverrides[projectName] = check.normalized;
          }
        }
      }
    }
    return { defaultRootDir, projectOverrides };
  } catch {
    return { defaultRootDir: DEFAULT_SPECS_ROOT_DIR, projectOverrides: {} };
  }
}

/**
 * Compute effective specs root directory for a given project name.
 */
export function getEffectiveSpecsRootDir(
  projectName: string | undefined,
  settings: SpecsRootSettings
): string {
  if (projectName && settings.projectOverrides[projectName]) {
    return settings.projectOverrides[projectName];
  }
  return settings.defaultRootDir || DEFAULT_SPECS_ROOT_DIR;
}

/**
 * Persist specs root directory:
 * - If projectName is provided, stores a per-project override (or removes override if matching global default).
 * - If projectName is omitted, updates the global default root directory.
 */
export async function saveSpecsRootDir(
  rootDir: string,
  projectName?: string
): Promise<SpecsRootSettings> {
  const normalized = normalizeSpecsRootDir(rootDir);
  const current = await getSpecsRootSettings();

  if (projectName) {
    const nextOverrides = { ...current.projectOverrides };
    if (normalized === current.defaultRootDir) {
      delete nextOverrides[projectName];
    } else {
      nextOverrides[projectName] = normalized;
    }
    const next: SpecsRootSettings = {
      defaultRootDir: current.defaultRootDir,
      projectOverrides: nextOverrides,
    };
    try {
      await browser.storage.local.set({ [PROJECT_ROOT_OVERRIDES_STORAGE_KEY]: nextOverrides });
    } catch {
      // ignore storage errors
    }
    return next;
  }

  const next: SpecsRootSettings = {
    defaultRootDir: normalized,
    projectOverrides: current.projectOverrides,
  };
  try {
    await browser.storage.local.set({ [GLOBAL_ROOT_DIR_STORAGE_KEY]: normalized });
  } catch {
    // ignore storage errors
  }
  return next;
}

/**
 * Remove a per-project override so the project falls back to the global default.
 */
export async function clearProjectSpecsRootOverride(
  projectName: string
): Promise<SpecsRootSettings> {
  const current = await getSpecsRootSettings();
  const nextOverrides = { ...current.projectOverrides };
  delete nextOverrides[projectName];
  const next: SpecsRootSettings = {
    defaultRootDir: current.defaultRootDir,
    projectOverrides: nextOverrides,
  };
  try {
    await browser.storage.local.set({ [PROJECT_ROOT_OVERRIDES_STORAGE_KEY]: nextOverrides });
  } catch {
    // ignore storage errors
  }
  return next;
}

export async function getSpecsRootDirForProject(projectName?: string): Promise<string> {
  const settings = await getSpecsRootSettings();
  return getEffectiveSpecsRootDir(projectName, settings);
}

/**
 * Check if the current browser environment supports the File System Access API.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Prompt the user to select their local project root folder (or target specs folder directly).
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

async function inspectTargetSegments(
  boundHandle: FileSystemDirectoryHandle,
  segments: string[]
): Promise<{
  status: 'clean' | 'pagespec_existing' | 'conflict';
  nonSpecEntries: string[];
  totalNonSpecCount: number;
}> {
  const lastSegment = segments[segments.length - 1] || DEFAULT_SPECS_ROOT_DIR;
  let targetHandle: FileSystemDirectoryHandle = boundHandle;

  if (boundHandle.name.toLowerCase() !== lastSegment.toLowerCase()) {
    for (const seg of segments) {
      try {
        targetHandle = await targetHandle.getDirectoryHandle(seg, { create: false });
      } catch (err: any) {
        if (err?.name === 'TypeMismatchError') {
          return {
            status: 'conflict',
            nonSpecEntries: [seg],
            totalNonSpecCount: 1,
          };
        }
        return {
          status: 'clean',
          nonSpecEntries: [],
          totalNonSpecCount: 0,
        };
      }
    }
  }

  let hasKnownCategory = false;
  const nonSpecEntries: string[] = [];
  let totalNonSpecCount = 0;

  try {
    for await (const entry of (targetHandle as any).values()) {
      const name = String(entry?.name || '');
      if (!name) continue;
      const lower = name.toLowerCase();
      if (entry.kind === 'directory' && KNOWN_CATEGORY_DIRS.has(lower)) {
        hasKnownCategory = true;
        continue;
      }
      if (entry.kind === 'file' && IGNORED_CONFLICT_FILES.has(lower)) {
        continue;
      }
      totalNonSpecCount++;
      if (nonSpecEntries.length < 5) {
        nonSpecEntries.push(entry.kind === 'directory' ? `${name}/` : name);
      }
    }
  } catch {
    return { status: 'clean', nonSpecEntries: [], totalNonSpecCount: 0 };
  }

  if (totalNonSpecCount > 0) {
    return { status: 'conflict', nonSpecEntries, totalNonSpecCount };
  }
  return {
    status: hasKnownCategory ? 'pagespec_existing' : 'clean',
    nonSpecEntries: [],
    totalNonSpecCount: 0,
  };
}

/**
 * Non-destructive read-only probe checking whether `<boundHandle>/<specsRootDir>`
 * already contains non-PageSpec files/folders (e.g. RSpec / OpenSpec / custom specs).
 * Never prompts the user for permission; returns `permission_needed` if read permission isn't granted yet.
 */
export async function inspectSpecsRootConflict(
  boundHandle: FileSystemDirectoryHandle,
  rawRootDir: string
): Promise<SpecsRootConflictReport> {
  const validation = validateSpecsRootDir(rawRootDir);
  if (!validation.valid) {
    return {
      status: 'invalid',
      resolvedRootPath: DEFAULT_SPECS_ROOT_DIR,
      nonSpecEntries: [],
      totalNonSpecCount: 0,
      suggestedAlternatives: [],
    };
  }

  try {
    const readPerm = await (boundHandle as any).queryPermission({ mode: 'read' });
    if (readPerm !== 'granted') {
      return {
        status: 'permission_needed',
        resolvedRootPath: validation.normalized,
        nonSpecEntries: [],
        totalNonSpecCount: 0,
        suggestedAlternatives: [],
      };
    }
  } catch {
    return {
      status: 'permission_needed',
      resolvedRootPath: validation.normalized,
      nonSpecEntries: [],
      totalNonSpecCount: 0,
      suggestedAlternatives: [],
    };
  }

  const probe = await inspectTargetSegments(boundHandle, validation.segments);
  if (probe.status !== 'conflict') {
    return {
      status: probe.status,
      resolvedRootPath: validation.normalized,
      nonSpecEntries: [],
      totalNonSpecCount: 0,
      suggestedAlternatives: [],
    };
  }

  // Filter presets to suggest conflict-free alternatives first
  const candidatePresets = SPECS_ROOT_PRESETS.filter(
    (p) => p.toLowerCase() !== validation.normalized.toLowerCase()
  );
  const checked = await Promise.all(
    candidatePresets.map(async (preset) => {
      const res = await inspectTargetSegments(boundHandle, preset.split('/'));
      return { preset, isFree: res.status !== 'conflict' };
    })
  );
  const freeAlternatives = checked.filter((c) => c.isFree).map((c) => c.preset);

  return {
    status: 'conflict',
    resolvedRootPath: validation.normalized,
    nonSpecEntries: probe.nonSpecEntries,
    totalNonSpecCount: probe.totalNonSpecCount,
    suggestedAlternatives: freeAlternatives.length > 0 ? freeAlternatives : [...candidatePresets],
  };
}

export interface ResolvedCategoryDirectory {
  categoryHandle: FileSystemDirectoryHandle;
  specsRootHandle: FileSystemDirectoryHandle;
  resolvedRootName: string; // e.g. 'specs' or 'docs/specs'
  displayRelativeDir: string; // e.g. 'specs/prd' or 'docs/specs/prd'
}

/**
 * Resolve and auto-create `<project-root>/<specs-root>/{prd|design|api|qa}`:
 * - Supports nested relative root paths (e.g. `docs/specs`, `.specs`, `page-specs`).
 * - Anti-nesting guard: if the user directly bound the target leaf folder (e.g. `specs/`), uses it directly.
 */
export async function resolveCategoryDirectory(
  boundHandle: FileSystemDirectoryHandle,
  category: SpecCategorySubdir,
  customRootDir?: string
): Promise<ResolvedCategoryDirectory> {
  const normalized = normalizeSpecsRootDir(customRootDir);
  const segments = normalized.split('/');
  const lastSegment = segments[segments.length - 1] || DEFAULT_SPECS_ROOT_DIR;

  let specsRootHandle: FileSystemDirectoryHandle;
  let resolvedRootName: string;

  if (boundHandle.name.toLowerCase() === lastSegment.toLowerCase()) {
    specsRootHandle = boundHandle;
    resolvedRootName = boundHandle.name;
  } else {
    let currentDir = boundHandle;
    for (const seg of segments) {
      currentDir = await currentDir.getDirectoryHandle(seg, { create: true });
    }
    specsRootHandle = currentDir;
    resolvedRootName = normalized;
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
  specsRootDir?: string
): Promise<void> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }
  if (category) {
    const targetRoot = specsRootDir ?? (await getSpecsRootDirForProject(dirHandle.name));
    const resolved = await resolveCategoryDirectory(dirHandle, category, targetRoot);
    await writeTextFile(resolved.categoryHandle, mdFilename, markdown);
  } else {
    await writeTextFile(dirHandle, mdFilename, markdown);
  }
}

/**
 * Write extracted PRD Markdown and co-located assets into `<project-root>/<specs-root>/prd/`.
 */
export async function writePrdBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  },
  specsRootDir?: string
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const targetRoot = specsRootDir ?? (await getSpecsRootDirForProject(dirHandle.name));
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'prd',
    targetRoot
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
 * Write extracted Design Spec Markdown and artboard assets into `<project-root>/<specs-root>/design/`.
 */
export async function writeDesignBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  },
  specsRootDir?: string
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const targetRoot = specsRootDir ?? (await getSpecsRootDirForProject(dirHandle.name));
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'design',
    targetRoot
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
 * Write extracted API Spec into `<project-root>/<specs-root>/api/`.
 */
export async function writeApiSpecToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
  },
  specsRootDir?: string
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const targetRoot = specsRootDir ?? (await getSpecsRootDirForProject(dirHandle.name));
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'api',
    targetRoot
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
 * Write QA failure bugfix bundle pulled from SpecLoop into `<project-root>/<specs-root>/qa/`.
 */
export async function writeQaFixesBundleToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  payload: {
    title?: string;
    sanitizedTitle: string;
    markdown: string;
    assets: Array<SerializableAsset>;
  },
  specsRootDir?: string
): Promise<DirectoryWriteResult> {
  const hasPermission = await verifyDirectoryPermission(dirHandle);
  if (!hasPermission) {
    throw new Error('未获得对本地目录的读写权限，请重新授权');
  }

  const targetRoot = specsRootDir ?? (await getSpecsRootDirForProject(dirHandle.name));
  const { categoryHandle, resolvedRootName, displayRelativeDir } = await resolveCategoryDirectory(
    dirHandle,
    'qa',
    targetRoot
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
