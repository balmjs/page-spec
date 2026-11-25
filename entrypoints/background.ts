import { defineBackground } from 'wxt/utils/define-background';
import { uint8ArrayToBase64 } from '../utils/dom-helpers';

export interface ScoredFrameItem {
  frameId: number;
  score: number;
  title: string;
  url: string;
  isTopFrame?: boolean;
  platformBadge?: string;
}

export interface BestFrameResult {
  bestFrameId: number;
  bestScore: number;
  bestTitle: string;
  bestUrl: string;
  platformBadge?: string;
  totalFrames: number;
  frames: ScoredFrameItem[];
}

const SPECLOOP_STORAGE_KEY = 'pagespec_specloop_config';
const PENDING_AUTH_KEY = 'pagespec_pending_auth_origin';

function safeOrigin(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin && u.origin !== 'null' ? u.origin : '';
  } catch {
    return '';
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      (async () => {
        try {
          if (typeof chrome !== 'undefined' && 'sidePanel' in chrome && (chrome.sidePanel as any)?.open) {
            const win = await chrome.windows.getCurrent();
            if (win?.id) {
              await (chrome.sidePanel as any).open({ windowId: win.id });
            }
          }
          sendResponse({ ok: true });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // On-demand MAIN world OpenAPI / Swagger sniffer (runs ONLY when user scans/extracts API tab)
    if (message.type === 'SNIFF_OPENAPI_IN_FRAME') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
      const frameId = typeof message.frameId === 'number' ? message.frameId : (sender?.frameId ?? 0);
      (async () => {
        if (!tabId || typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
          sendResponse({ ok: true, spec: null });
          return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            world: 'MAIN',
            func: async () => {
              const w = window as any;
              try {
                if (w.ui?.specSelectors?.specJson) {
                  const specJson = w.ui.specSelectors.specJson();
                  if (specJson?.toJS) return specJson.toJS();
                  if (specJson && typeof specJson === 'object' && (specJson.paths || specJson.openapi || specJson.swagger)) {
                    return specJson;
                  }
                }
                if (typeof w.ui?.spec === 'function') {
                  const s = w.ui.spec();
                  if (s?.toJS) return s.toJS();
                  if (s?.json) return s.json?.toJS ? s.json.toJS() : s.json;
                  if (s?.paths) return s;
                }
                if (w.__REDOC_STATE__?.rawSpec) return w.__REDOC_STATE__.rawSpec;
                if (w.__redoc_state?.spec?.data) return w.__redoc_state.spec.data;
                if (w.swaggerUi?.api?.swaggerObject) return w.swaggerUi.api.swaggerObject;
                const rapidoc = document.querySelector('rapi-doc') as any;
                if (rapidoc?.resolvedSpec) return rapidoc.resolvedSpec;

                const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
                const specResource = resources
                  .map((r) => r.name)
                  .reverse()
                  .find(
                    (url) =>
                      /\/(?:v[23]\/api-docs|swagger\.json|openapi\.json|api-docs\.json)(?:\?.*)?$/i.test(url) &&
                      !url.includes('swagger-resources')
                  );

                if (specResource) {
                  const resp = await fetch(specResource, { credentials: 'include' });
                  if (resp.ok) {
                    const data = await resp.json();
                    if (data && (data.paths || data.openapi || data.swagger)) {
                      return data;
                    }
                  }
                }
              } catch {
                // ignore sniffing errors
              }
              return null;
            },
          });
          sendResponse({ ok: true, spec: results?.[0]?.result ?? null });
        } catch {
          sendResponse({ ok: true, spec: null });
        }
      })();
      return true;
    }

    // On-demand QA diagnostic ring buffer installer (runs ONLY when SpecLoop QA Companion is active)
    if (message.type === 'ARM_QA_DIAGNOSTICS') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
      (async () => {
        if (!tabId || typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
          sendResponse({ ok: false });
          return;
        }
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            world: 'MAIN',
            func: () => {
              const MAX_DIAGNOSTICS = 10;
              const w = window as any;
              if (w.__PAGESPEC_DIAG_RING__) return true;

              const ring: Array<{ kind: 'console' | 'exception' | 'http'; message: string; timestamp: string }> = [];
              const pushEntry = (kind: 'console' | 'exception' | 'http', message: string) => {
                ring.push({
                  kind,
                  message: message.slice(0, 320),
                  timestamp: new Date().toISOString(),
                });
                if (ring.length > MAX_DIAGNOSTICS) {
                  ring.shift();
                }
              };

              const origError = console.error;
              console.error = function (...args: any[]) {
                try {
                  const msg = args
                    .map((a) => {
                      if (a instanceof Error) return a.stack || a.message;
                      if (typeof a === 'string') return a;
                      try {
                        return JSON.stringify(a);
                      } catch {
                        return String(a);
                      }
                    })
                    .join(' ');
                  pushEntry('console', msg);
                } catch {
                  // ignore ring errors
                }
                return origError.apply(console, args);
              };

              window.addEventListener('error', (ev) => {
                if (ev?.message) {
                  pushEntry('exception', `${ev.message} (${ev.filename || ''}:${ev.lineno || 0})`);
                }
              });

              window.addEventListener('unhandledrejection', (ev) => {
                const reason = ev?.reason;
                const msg =
                  reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
                pushEntry('exception', `UnhandledRejection: ${msg}`);
              });

              const origFetch = window.fetch;
              if (typeof origFetch === 'function') {
                window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
                  const started = Date.now();
                  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
                  let pathname = '';
                  try {
                    const rawUrl =
                      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                    pathname = new URL(rawUrl, window.location.href).pathname;
                  } catch {
                    pathname = '[url]';
                  }
                  try {
                    const resp = await origFetch.apply(window, [input, init] as any);
                    if (resp.status >= 400) {
                      pushEntry('http', `${method} ${pathname} -> HTTP ${resp.status} (${Date.now() - started}ms)`);
                    }
                    return resp;
                  } catch (err: any) {
                    pushEntry('http', `${method} ${pathname} -> NETWORK_ERROR (${err?.message || 'failed'})`);
                    throw err;
                  }
                };
              }

              w.__PAGESPEC_DIAG_RING__ = ring;
              return true;
            },
          });
          sendResponse({ ok: true });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    // Read active tab environment snapshot + QA diagnostic ring buffer on demand
    if (message.type === 'READ_QA_DIAGNOSTICS') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
      (async () => {
        if (!tabId || typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
          sendResponse({ ok: false });
          return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            world: 'MAIN',
            func: () => {
              const w = window as any;
              return {
                url: window.location.href,
                title: document.title || '',
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                userAgent: navigator.userAgent.slice(0, 140),
                errors: Array.isArray(w.__PAGESPEC_DIAG_RING__) ? [...w.__PAGESPEC_DIAG_RING__] : [],
              };
            },
          });
          const data = results?.[0]?.result;
          sendResponse(data ? { ok: true, data } : { ok: false });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Capture Visible Active Tab PNG Screenshot (for QA Companion one-click bug snapshot, uses existing activeTab)
    if (message.type === 'CAPTURE_VISIBLE_TAB') {
      (async () => {
        try {
          const dataUrl = await browser.tabs.captureVisibleTab(undefined as any, { format: 'png' });
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          sendResponse({ ok: true, dataUrl, base64 });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Open SpecLoop Extension Auth Handshake Tab
    if (message.type === 'OPEN_SPECLOOP_AUTH_TAB') {
      const baseUrl = String(message.baseUrl || '').trim().replace(/\/+$/, '');
      const version = String(message.version || '1.2.0');
      (async () => {
        try {
          const origin = safeOrigin(baseUrl);
          if (!origin) {
            throw new Error('无效的 SpecLoop 服务器地址');
          }
          await browser.storage.local.set({ [PENDING_AUTH_KEY]: origin });
          const authUrl = `${baseUrl}/#/auth/extension-connect?client=pagespec&version=${encodeURIComponent(version)}`;
          await browser.tabs.create({ url: authUrl });
          sendResponse({ ok: true });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Receive Handshake Token from SpecLoop WebApp Auth Page (origin-verified)
    if (message.type === 'SAVE_SPECLOOP_HANDSHAKE') {
      (async () => {
        try {
          const stored = await browser.storage.local.get([SPECLOOP_STORAGE_KEY, PENDING_AUTH_KEY]);
          const currentCfg = (stored?.[SPECLOOP_STORAGE_KEY] || {}) as Record<string, any>;
          const pendingOrigin = String(stored?.[PENDING_AUTH_KEY] || '');
          const configuredOrigin = safeOrigin(String(currentCfg.baseUrl || ''));
          const senderOrigin = safeOrigin(sender?.tab?.url || message.origin || '');

          if (!senderOrigin || (senderOrigin !== pendingOrigin && senderOrigin !== configuredOrigin)) {
            sendResponse({ ok: false, error: '授权来源域名不匹配，已拦截' });
            return;
          }

          const nextCfg = {
            baseUrl: String(message.baseUrl || senderOrigin).trim().replace(/\/+$/, ''),
            apiToken: String(message.apiToken || '').trim(),
            defaultTaskId: currentCfg.defaultTaskId || '',
            defaultProjectId: String(message.defaultProjectId || currentCfg.defaultProjectId || '').trim(),
            userEmail: String(message.userEmail || '').trim(),
            userDisplayName: String(message.userDisplayName || '').trim(),
          };

          await browser.storage.local.set({ [SPECLOOP_STORAGE_KEY]: nextCfg });
          await browser.storage.local.remove(PENDING_AUTH_KEY);

          // Notify any open Popup/SidePanel views
          browser.runtime.sendMessage({ type: 'SPECLOOP_CONFIG_UPDATED', config: nextCfg }).catch(() => {});

          sendResponse({ ok: true, config: nextCfg });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Generic SpecLoop API Request Proxy (bypasses CORS in Popup/SidePanel)
    if (message.type === 'SPECLOOP_API_REQUEST') {
      const { url, method = 'GET', apiToken, body } = message;
      (async () => {
        try {
          const headers: Record<string, string> = {};
          if (apiToken) {
            headers['Authorization'] = `Bearer ${apiToken}`;
          }
          if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
          }
          const resp = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          const rawText = await resp.text();
          let data: any = null;
          try {
            data = rawText ? JSON.parse(rawText) : null;
          } catch {
            data = { message: rawText };
          }
          if (!resp.ok) {
            sendResponse({
              ok: false,
              status: resp.status,
              error: data?.error || data?.message || `HTTP ${resp.status}`,
            });
            return;
          }
          sendResponse({ ok: true, status: resp.status, data });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Proxy image download across domains to bypass CORS restrictions (Base64 only)
    if (message.type === 'FETCH_IMAGE_DATA') {
      const { url } = message;
      (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const mime = resp.headers.get('content-type') || blob.type || 'image/png';
          const buffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          const base64 = uint8ArrayToBase64(uint8);
          sendResponse({ ok: true, base64, mime });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Push standardized SpecBundle to configured SpecLoop server (bypasses UI CORS)
    if (message.type === 'PUSH_TO_SPECLOOP') {
      const { endpoint, apiToken, payload } = message;
      (async () => {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (apiToken) {
            headers['Authorization'] = `Bearer ${apiToken}`;
          }
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          const rawText = await resp.text();
          let data: any = null;
          try {
            data = JSON.parse(rawText);
          } catch {
            data = { message: rawText };
          }
          if (!resp.ok) {
            throw new Error(data?.error || data?.message || `HTTP ${resp.status}`);
          }
          sendResponse({
            ok: true,
            taskId: data?.taskId || data?.data?.taskId,
            staleTestCount: data?.staleTestCount ?? data?.data?.staleTestCount ?? 0,
            message: data?.message || '推送成功',
          });
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
                  url: res.url || f.url || '',
                  isTopFrame: res.isTopFrame ?? f.frameId === 0,
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
              isTopFrame: f.frameId === 0,
              platformBadge: undefined,
            };
          });

          const results = await Promise.all(scorePromises);
          results.sort((a, b) => b.score - a.score);

          const best = results[0] || { frameId: 0, score: 0, title: '', url: '' };

          sendResponse({
            ok: true,
            data: {
              bestFrameId: best.frameId,
              bestScore: best.score,
              bestTitle: best.title,
              bestUrl: best.url,
              platformBadge: best.platformBadge,
              totalFrames: frames.length,
              frames: results,
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
              frames: [],
            },
          });
        }
      })();
      return true;
    }

    return false;
  });
});
