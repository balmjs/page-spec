import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractPrdBundle } from '../core/extractors/prd-extractor';
import { extractApiDocumentation, listAvailableApiEndpoints } from '../core/extractors/api-extractor';
import { listDesignArtboards, extractDesignBundle } from '../core/extractors/design-extractor';
import { buildZipArchive } from '../core/bundler/zip-builder';
import { evaluateCurrentFrameContent } from '../core/extractors/frame-scorer';
import { uint8ArrayToBase64 } from '../utils/dom-helpers';
import { autoTrimNoisySections } from '../utils/markdown-trimmer';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    // 1. Listen for SpecLoop one-click browser auth handshake completion on top window
    if (window === window.top) {
      window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'SPECLOOP_WEBAPP') {
          return;
        }
        if (event.data.type === 'SPECLOOP_EXTENSION_AUTH_GRANTED' && event.data.apiToken) {
          browser.runtime
            .sendMessage({
              type: 'SAVE_SPECLOOP_HANDSHAKE',
              origin: window.location.origin,
              baseUrl: event.data.baseUrl || window.location.origin,
              apiToken: event.data.apiToken,
              userEmail: event.data.userEmail || '',
              userDisplayName: event.data.userDisplayName || '',
              defaultProjectId: event.data.defaultProjectId || '',
            })
            .then((res: any) => {
              window.postMessage(
                {
                  source: 'PAGESPEC_EXTENSION',
                  type: 'SPECLOOP_EXTENSION_AUTH_ACK',
                  ok: Boolean(res?.ok),
                  error: res?.error,
                },
                window.location.origin
              );
            })
            .catch(() => {});
        }
      });
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

      // List Design Artboards on current frame (Mode 1.5 - Design)
      if (message.type === 'LIST_DESIGN_ARTBOARDS') {
        try {
          const scanResult = listDesignArtboards();
          sendResponse({ ok: true, data: scanResult });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
        return true;
      }

      // Extract Design Artboards Bundle
      if (message.type === 'EXTRACT_DESIGN') {
        const saveMode = message.saveMode || 'zip'; // 'zip' | 'directory'
        const selectedIds = Array.isArray(message.selectedIds) ? message.selectedIds : undefined;

        (async () => {
          try {
            const result = await extractDesignBundle((current, total, msg) => {
              browser.runtime
                .sendMessage({
                  type: 'EXTRACTION_PROGRESS',
                  mode: 'design',
                  current,
                  total,
                  message: msg,
                })
                .catch(() => {});
            }, selectedIds);

            const serializableAssets = result.assets.map((a) => ({
              filename: a.filename,
              base64: uint8ArrayToBase64(a.data),
            }));

            if (saveMode === 'zip') {
              const zipBlob = buildZipArchive({
                markdown: result.markdown,
                markdownFilename: `${result.sanitizedTitle}.md`,
                assets: result.assets,
              });

              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Url = reader.result as string;
                const filename = `${result.sanitizedTitle}-design.zip`;

                browser.runtime.sendMessage({
                  type: 'TRIGGER_DOWNLOAD',
                  url: base64Url,
                  filename,
                });

                sendResponse({
                  ok: true,
                  title: result.title,
                  sanitizedTitle: result.sanitizedTitle,
                  platform: result.platform,
                  markdown: result.markdown,
                  markdownPreview: result.markdown.slice(0, 3000),
                  assets: serializableAssets,
                  totalAssets: result.assets.length,
                  artboardsCount: result.artboardsCount,
                  warnings: result.warnings,
                });
              };
              reader.readAsDataURL(zipBlob);
            } else {
              sendResponse({
                ok: true,
                title: result.title,
                sanitizedTitle: result.sanitizedTitle,
                platform: result.platform,
                markdown: result.markdown,
                markdownPreview: result.markdown.slice(0, 3000),
                assets: serializableAssets,
                totalAssets: result.assets.length,
                artboardsCount: result.artboardsCount,
                warnings: result.warnings,
              });
            }
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      // Extract PRD Bundle (Mode 1)
      if (message.type === 'EXTRACT_PRD') {
        const saveMode = message.saveMode || 'zip'; // 'zip' | 'directory'
        const engineMode = message.engineMode || 'auto'; // 'auto' | 'tencent' | 'dom'
        const autoTrimNoise = message.autoTrimNoise !== false;

        (async () => {
          try {
            const result = await extractPrdBundle((current, total, msg) => {
              browser.runtime
                .sendMessage({
                  type: 'EXTRACTION_PROGRESS',
                  mode: 'prd',
                  current,
                  total,
                  message: msg,
                })
                .catch(() => {});
            }, engineMode);

            let finalMarkdown = result.markdown;
            let trimmedHeadings: string[] = [];
            if (autoTrimNoise) {
              const trimmed = autoTrimNoisySections(result.markdown);
              finalMarkdown = trimmed.markdown;
              trimmedHeadings = trimmed.removedHeadings;
            }

            // Convert assets into serializable format with Base64
            const serializableAssets = result.assets.map((a) => ({
              filename: a.filename,
              base64: uint8ArrayToBase64(a.data),
            }));

            if (saveMode === 'zip') {
              const zipBlob = buildZipArchive({
                markdown: finalMarkdown,
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
                  rawMarkdown: result.markdown,
                  markdown: finalMarkdown,
                  markdownPreview: finalMarkdown.slice(0, 3000),
                  assets: serializableAssets,
                  totalAssets: result.assets.length,
                  trimmedHeadings,
                  warnings: result.warnings,
                });
              };
              reader.readAsDataURL(zipBlob);
            } else {
              sendResponse({
                ok: true,
                title: result.title,
                sanitizedTitle: result.sanitizedTitle,
                rawMarkdown: result.markdown,
                markdown: finalMarkdown,
                markdownPreview: finalMarkdown.slice(0, 3000),
                assets: serializableAssets,
                totalAssets: result.assets.length,
                trimmedHeadings,
                warnings: result.warnings,
              });
            }
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      // List Available API Endpoints on current frame
      if (message.type === 'LIST_API_ENDPOINTS') {
        (async () => {
          try {
            const listResult = await listAvailableApiEndpoints();
            sendResponse({ ok: true, data: listResult });
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      // Extract API Documentation (Mode 2)
      if (message.type === 'EXTRACT_API') {
        const saveMode = message.saveMode || 'download'; // 'download' | 'directory'
        const selectedKeys = Array.isArray(message.selectedKeys) ? message.selectedKeys : undefined;

        (async () => {
          try {
            const result = await extractApiDocumentation((current, total, msg) => {
              browser.runtime
                .sendMessage({
                  type: 'EXTRACTION_PROGRESS',
                  mode: 'api',
                  current,
                  total,
                  message: msg,
                })
                .catch(() => {});
            }, selectedKeys);

            if (saveMode === 'download') {
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
