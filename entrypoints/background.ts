import { defineBackground } from 'wxt/utils/define-background';

export interface BestFrameResult {
  bestFrameId: number;
  bestScore: number;
  bestTitle: string;
  bestUrl: string;
  platformBadge?: string;
  totalFrames: number;
}

export default defineBackground(() => {
  // 1. Download & Frame Orchestration
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    // Trigger Browser Download
    if (message.type === 'TRIGGER_DOWNLOAD') {
      const { url, filename } = message;
      browser.downloads
        .download({
          url,
          filename,
          saveAs: false,
        })
        .then((downloadId) => {
          sendResponse({ ok: true, downloadId });
        })
        .catch((err) => {
          console.error('[PageSpec] Download failed:', err);
          sendResponse({ ok: false, error: err?.message || String(err) });
        });
      return true;
    }

    // Open SidePanel
    if (message.type === 'OPEN_SIDEPANEL') {
      if (typeof chrome !== 'undefined' && 'sidePanel' in chrome && (chrome.sidePanel as any)?.open) {
        chrome.windows.getCurrent((win: chrome.windows.Window) => {
          if (win?.id) {
            (chrome.sidePanel as any).open({ windowId: win.id });
          }
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    // Proxy image download across domains to bypass CORS restrictions
    if (message.type === 'FETCH_IMAGE_DATA') {
      const { url } = message;
      (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const mime = resp.headers.get('content-type') || blob.type || 'image/png';
          const buffer = await blob.arrayBuffer();
          const data = Array.from(new Uint8Array(buffer));
          sendResponse({ ok: true, data, mime });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Detect Best PRD Frame in Active Tab
    if (message.type === 'DETECT_BEST_PRD_FRAME') {
      const tabId = message.tabId;
      (async () => {
        try {
          interface ScoredFrameItem {
            frameId: number;
            score: number;
            title: string;
            url: string;
            platformBadge?: string;
          }

          let frames: any[] = [];
          if (browser.webNavigation && browser.webNavigation.getAllFrames) {
            try {
              const allFrames = await browser.webNavigation.getAllFrames({ tabId });
              frames = allFrames || [{ frameId: 0 }];
            } catch {
              frames = [{ frameId: 0 }];
            }
          } else {
            frames = [{ frameId: 0 }];
          }

          if (frames.length === 0) {
            frames = [{ frameId: 0 }];
          }

          // Query score across all frames
          const scorePromises: Promise<ScoredFrameItem>[] = frames.map(async (f) => {
            try {
              const res: any = await browser.tabs.sendMessage(
                tabId,
                { type: 'QUERY_FRAME_SCORE' },
                { frameId: f.frameId }
              );
              if (res && typeof res.score === 'number') {
                return {
                  frameId: f.frameId,
                  score: res.score,
                  title: res.title || '',
                  url: res.url || '',
                  platformBadge: res.platformBadge,
                };
              }
            } catch {
              // Frame might not have script injected or is cross-origin restricted
            }
            return {
              frameId: f.frameId,
              score: 0,
              title: '',
              url: f.url || '',
              platformBadge: undefined,
            };
          });

          const results = await Promise.all(scorePromises);

          let best: ScoredFrameItem = results[0] || { frameId: 0, score: 0, title: '', url: '' };
          for (const item of results) {
            if (item.score > best.score) {
              best = item;
            }
          }

          sendResponse({
            ok: true,
            data: {
              bestFrameId: best.frameId,
              bestScore: best.score,
              bestTitle: best.title,
              bestUrl: best.url,
              platformBadge: best.platformBadge,
              totalFrames: frames.length,
            } as BestFrameResult,
          });
        } catch (err: any) {
          sendResponse({
            ok: false,
            error: err?.message || String(err),
            data: {
              bestFrameId: 0,
              bestScore: 0,
              bestTitle: '',
              bestUrl: '',
              totalFrames: 1,
            },
          });
        }
      })();
      return true;
    }

    return false;
  });
});
