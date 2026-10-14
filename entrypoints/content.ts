import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractPrdBundle } from '../core/extractors/prd-extractor';
import { extractApiDocumentation } from '../core/extractors/api-extractor';
import { buildZipArchive } from '../core/bundler/zip-builder';
import { executeMcpTool } from '../core/webmcp/mcp-provider';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // 1. Inject Main World script for WebMCP & OpenAPI sniffing
    try {
      const script = document.createElement('script');
      script.src = browser.runtime.getURL('/injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch {
      // ignore script injection failures on restricted domains
    }

    // 2. Handle communication with In-page WebMCP
    window.addEventListener('message', async (event) => {
      if (event.source !== window || !event.data || event.data.source !== 'PAGESPEC_PAGE') {
        return;
      }

      if (event.data.type === 'CALL_MCP_TOOL') {
        const { requestId, toolName } = event.data;
        try {
          const res = await executeMcpTool(toolName);
          window.postMessage(
            {
              source: 'PAGESPEC_CONTENT',
              type: 'MCP_TOOL_RESPONSE',
              requestId,
              result: res,
            },
            '*'
          );
        } catch (err: any) {
          window.postMessage(
            {
              source: 'PAGESPEC_CONTENT',
              type: 'MCP_TOOL_RESPONSE',
              requestId,
              error: err?.message || String(err),
            },
            '*'
          );
        }
      }
    });

    // 3. Listen for requests from Popup / SidePanel / Background
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      // Ping check
      if (message.type === 'PING') {
        sendResponse({
          ok: true,
          url: window.location.href,
          title: document.title,
        });
        return true;
      }

      // Execute MCP Tool directly (e.g. from Background MCP Bridge)
      if (message.type === 'EXECUTE_MCP_TOOL') {
        executeMcpTool(message.toolName)
          .then((res) => sendResponse({ ok: true, data: res }))
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true;
      }

      // Extract PRD Bundle (Mode 1)
      if (message.type === 'EXTRACT_PRD') {
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
            });

            // Build ZIP archive
            const zipBlob = buildZipArchive({
              markdown: result.markdown,
              markdownFilename: 'index.md',
              assets: result.assets,
            });

            // Convert to base64 Data URL for background download
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
                markdownPreview: result.markdown.slice(0, 3000),
                totalAssets: result.assets.length,
                warnings: result.warnings,
              });
            };
            reader.readAsDataURL(zipBlob);
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      // Extract API Documentation (Mode 2)
      if (message.type === 'EXTRACT_API') {
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
                markdownPreview: result.markdown.slice(0, 3000),
                endpointsCount: result.endpointsCount,
                format: result.format,
              });
            };
            reader.readAsDataURL(blob);
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
