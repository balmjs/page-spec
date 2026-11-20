import { zipSync, strToU8 } from 'fflate';

export interface BundleAsset {
  filename: string; // e.g. "assets/PRD_Title/prototype-001.png"
  data: Uint8Array;
}

export interface ZipBundleOptions {
  markdown: string;
  markdownFilename?: string; // defaults to "index.md"
  assets: BundleAsset[];
  extraFiles?: Array<{ filename: string; content: string }>;
}

export interface SpecBundleManifest {
  schemaVersion: '1.0';
  generator: 'PageSpec';
  generatorVersion: string;
  type: 'prd' | 'design' | 'api';
  title: string;
  sanitizedTitle: string;
  sourceUrl: string;
  extractedAt: string;
  markdownFile: string;
  diffFile?: string;
  assetsCount: number;
  endpointsCount?: number;
  artboardsCount?: number;
  platform?: string;
}

export interface SpecBundleOptions extends ZipBundleOptions {
  manifest: SpecBundleManifest;
}

/**
 * Build a ZIP archive in memory using fflate.
 */
export function buildZipArchive(options: ZipBundleOptions): Blob {
  const { markdown, markdownFilename = 'index.md', assets, extraFiles = [] } = options;

  const zipFiles: Record<string, Uint8Array> = {
    [markdownFilename]: strToU8(markdown),
  };

  for (const extra of extraFiles) {
    const cleanName = extra.filename.startsWith('/') ? extra.filename.slice(1) : extra.filename;
    zipFiles[cleanName] = strToU8(extra.content);
  }

  for (const asset of assets) {
    // Ensure relative path formatting
    const cleanPath = asset.filename.startsWith('/') ? asset.filename.slice(1) : asset.filename;
    zipFiles[cleanPath] = asset.data;
  }

  const zipped = zipSync(zipFiles, { level: 6 });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/**
 * Build a standardized .specbundle.zip archive with manifest.json for SpecLoop interoperability.
 */
export function buildSpecBundleArchive(options: SpecBundleOptions): Blob {
  const manifestJson = JSON.stringify(options.manifest, null, 2);
  return buildZipArchive({
    markdown: options.markdown,
    markdownFilename: options.markdownFilename || options.manifest.markdownFile,
    assets: options.assets,
    extraFiles: [
      { filename: 'manifest.json', content: manifestJson },
      ...(options.extraFiles || []),
    ],
  });
}
