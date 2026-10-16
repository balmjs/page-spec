import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractPrdBundle } from '../core/extractors/prd-extractor';
import { extractApiDocumentation } from '../core/extractors/api-extractor';
import { buildZipArchive } from '../core/bundler/zip-builder';
import { evaluateCurrentFrameContent } from '../core/extractors/frame-scorer';
import { uint8ArrayToBase64 } from '../utils/dom-helpers';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    // 1. Inject Main World script for OpenAPI/Swagger sniffing
    try {
      const script = document.createElement('script');
      script.src = browser.runtime.getURL('/injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch {
      // ignore script injection failures on restricted domains
    }

    // 2. Listen for requests from Popup / SidePanel / Background
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      // Ping check
      if (message.type === 'PING') {
        sendResponse({
          ok: true,
          url: window.location.href,
          title: document.title,
          isTop: window === window.top,
        });
        return true;
      }

      // Query Frame Content Density & PRD Score
      if (message.type === 'QUERY_FRAME_SCORE') {
        try {
          const scoreResult = evaluateCurrentFrameContent();
          sendResponse(scoreResult);
        } catch (err: any) {
          sendResponse({
            score: 0,
            wordCount: 0,
            imageCount: 0,
            headingsCount: 0,
            title: document.title || '',
            url: window.location.href,
            isTopFrame: window === window.top,
            error: err?.message || String(err),
          });
        }
        return true;
      }

      // Extract PRD Bundle (Mode 1)
      if (message.type === 'EXTRACT_PRD') {
        const saveMode = message.saveMode || 'zip'; // 'zip' | 'directory'
        const engineMode = message.engineMode || 'auto'; // 'auto' | 'tencent' | 'dom'

        (async () => {
          try {
            const result = await extractPrdBundle((current, total, msg) => {
              browser.runtime.sendMessage({
                type: 'EXTRACTION_PROGRESS',
                mode: 'prd',
                current,
                total,
                message: msg,
              }).catch(() => {});
            }, engineMode);

            // Convert assets into serializable format with Base64
            const serializableAssets = result.assets.map((a) => ({
              filename: a.filename,
              base64: uint8ArrayToBase64(a.data),
            }));

            if (saveMode === 'zip') {
              // Build ZIP archive and trigger browser download
              const zipBlob = buildZipArchive({
                markdown: result.markdown,
                markdownFilename: `${result.sanitizedTitle}.md`,
                assets: result.assets,
              });

              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Url = reader.result as string;
                const filename = `${result.sanitizedTitle}-prd.zip`;

                browser.runtime.sendMessage({
                  type: 'TRIGGER_DOWNLOAD',
                  url: base64Url,
                  filename,
                });

                sendResponse({
                  ok: true,
                  title: result.title,
                  sanitizedTitle: result.sanitizedTitle,
                  markdown: result.markdown,
                  markdownPreview: result.markdown.slice(0, 3000),
                  totalAssets: result.assets.length,
                  warnings: result.warnings,
                });
              };
              reader.readAsDataURL(zipBlob);
            } else {
              // Direct directory mode: return raw serializable assets
              sendResponse({
                ok: true,
                title: result.title,
                sanitizedTitle: result.sanitizedTitle,
                markdown: result.markdown,
                markdownPreview: result.markdown.slice(0, 3000),
                assets: serializableAssets,
                totalAssets: result.assets.length,
                warnings: result.warnings,
              });
            }
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      // Extract API Documentation (Mode 2)
      if (message.type === 'EXTRACT_API') {
        const saveMode = message.saveMode || 'download'; // 'download' | 'directory'

        (async () => {
          try {
            const result = await extractApiDocumentation((current, total, msg) => {
              browser.runtime.sendMessage({
                type: 'EXTRACTION_PROGRESS',
                mode: 'api',
                current,
                total,
                message: msg,
              }).catch(() => {});
            });

            if (saveMode === 'download') {
              // Trigger direct Markdown download
              const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Url = reader.result as string;
                const filename = `${result.sanitizedTitle}-api.md`;

                browser.runtime.sendMessage({
                  type: 'TRIGGER_DOWNLOAD',
                  url: base64Url,
                  filename,
                });

                sendResponse({
                  ok: true,
                  title: result.title,
                  sanitizedTitle: result.sanitizedTitle,
                  markdown: result.markdown,
                  markdownPreview: result.markdown.slice(0, 3000),
                  endpointsCount: result.endpointsCount,
                  format: result.format,
                });
              };
              reader.readAsDataURL(blob);
            } else {
              // Direct directory mode
              sendResponse({
                ok: true,
                title: result.title,
                sanitizedTitle: result.sanitizedTitle,
                markdown: result.markdown,
                markdownPreview: result.markdown.slice(0, 3000),
                endpointsCount: result.endpointsCount,
                format: result.format,
              });
            }
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      return false;
    });
  },
});
