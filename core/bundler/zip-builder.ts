import { zipSync, strToU8 } from 'fflate';

export interface BundleAsset {
  filename: string; // e.g. "assets/prototype-001.png"
  data: Uint8Array;
}

export interface ZipBundleOptions {
  markdown: string;
  markdownFilename?: string; // defaults to "index.md"
  assets: BundleAsset[];
}

/**
 * Build a ZIP archive in memory using fflate.
 */
export function buildZipArchive(options: ZipBundleOptions): Blob {
  const { markdown, markdownFilename = 'index.md', assets } = options;

  const zipFiles: Record<string, Uint8Array> = {
    [markdownFilename]: strToU8(markdown),
  };

  for (const asset of assets) {
    // Ensure relative path formatting
    const cleanPath = asset.filename.startsWith('/') ? asset.filename.slice(1) : asset.filename;
    zipFiles[cleanPath] = asset.data;
  }

  const zipped = zipSync(zipFiles, { level: 6 });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
