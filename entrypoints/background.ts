import { defineBackground } from 'wxt/utils/define-background';
import {
  uint8ArrayToBase64,
  base64ToUint8Array,
  computeCropBox,
  type CaptureRegionRect,
} from '../utils/dom-helpers';

export interface ScoredFrameItem {
  frameId: number;
  score: number;
  title: string;
  url: string;
  isTopFrame?: boolean;
  platformBadge?: string;
  isPrototypeShell?: boolean;
  isPrototypeCanvas?: boolean;
  prototypePlatform?: string;
}

export interface BestFrameResult {
  bestFrameId: number;
  bestScore: number;
  bestTitle: string;
  bestUrl: string;
  platformBadge?: string;
  isPrototypeShell?: boolean;
  isPrototypeCanvas?: boolean;
  prototypePlatform?: string;
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

              // Also monitor XMLHttpRequest failures (sanitized: method, pathname, status, duration only)
              const XhrProto = window.XMLHttpRequest?.prototype;
              if (XhrProto && !(XhrProto as any).__psDiagHooked) {
                (XhrProto as any).__psDiagHooked = true;
                const origOpen = XhrProto.open;
                const origSend = XhrProto.send;
                XhrProto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
                  let pathname = '[url]';
                  try {
                    const rawUrl = typeof url === 'string' ? url : url.href;
                    pathname = new URL(rawUrl, window.location.href).pathname;
                  } catch {
                    pathname = '[url]';
                  }
                  (this as any).__psXhrMeta = {
                    method: String(method || 'GET').toUpperCase(),
                    pathname,
                  };
                  return origOpen.apply(this, [method, url, ...rest] as any);
                };
                XhrProto.send = function (this: XMLHttpRequest, body?: any) {
                  const started = Date.now();
                  this.addEventListener('loadend', () => {
                    const meta = (this as any).__psXhrMeta;
                    if (!meta) return;
                    if (this.status >= 400) {
                      pushEntry('http', `${meta.method} ${meta.pathname} -> HTTP ${this.status} (${Date.now() - started}ms)`);
                    } else if (this.status === 0) {
                      pushEntry('http', `${meta.method} ${meta.pathname} -> NETWORK_ERROR (${Date.now() - started}ms)`);
                    }
                  });
                  return origSend.call(this, body);
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
          const windowId = sender?.tab?.windowId;
          const dataUrl = await browser.tabs.captureVisibleTab(windowId as any, { format: 'png' });
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          sendResponse({ ok: true, dataUrl, base64 });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // Capture & Crop a specific viewport region (WebGL canvas fallback & prototype stage snapshot, reuses activeTab)
    if (message.type === 'CAPTURE_REGION_CROP') {
      (async () => {
        try {
          const windowId = sender?.tab?.windowId;
          const tabId = sender?.tab?.id;
          const frameId = sender?.frameId ?? 0;
          let rect: CaptureRegionRect | undefined = message.rect;

          // If triggered inside a cross-origin sub-frame, ask top frame for the iframe's bounding box offset
          if (rect && message.needsTopFrameOffset && tabId && frameId !== 0) {
            try {
              const offsetRes: any = await browser.tabs.sendMessage(
                tabId,
                {
                  type: 'QUERY_IFRAME_RECT',
                  frameUrl: sender?.url || '',
                },
                { frameId: 0 }
              );
              if (offsetRes?.ok && offsetRes.rect) {
                rect = {
                  ...rect,
                  x: rect.x + offsetRes.rect.x,
                  y: rect.y + offsetRes.rect.y,
                  viewportWidth: offsetRes.viewportWidth || rect.viewportWidth,
                  viewportHeight: offsetRes.viewportHeight || rect.viewportHeight,
                };
              }
            } catch {
              // fallback to unadjusted rect if top frame is unreachable
            }
          }

          const dataUrl = await browser.tabs.captureVisibleTab(windowId as any, { format: 'png' });
          const rawBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

          if (!rect || rect.width <= 0 || rect.height <= 0) {
            sendResponse({ ok: true, base64: rawBase64, dataUrl, cropped: false });
            return;
          }

          if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
            let bitmap: ImageBitmap | null = null;
            try {
              const pngBytes = base64ToUint8Array(rawBase64);
              const blob = new Blob([pngBytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
              bitmap = await createImageBitmap(blob);
              const box = computeCropBox(bitmap.width, bitmap.height, rect);
              const canvas = new OffscreenCanvas(box.sw, box.sh);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(bitmap, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh);
                const outBlob = await canvas.convertToBlob({ type: 'image/png' });
                const outBytes = new Uint8Array(await outBlob.arrayBuffer());
                const croppedBase64 = uint8ArrayToBase64(outBytes);
                sendResponse({
                  ok: true,
                  base64: croppedBase64,
                  width: box.sw,
                  height: box.sh,
                  cropped: true,
                });
                return;
              }
            } finally {
              try {
                bitmap?.close();
              } catch {
                // ignore
              }
            }
          }

          // Graceful fallback if OffscreenCanvas is unavailable
          sendResponse({ ok: true, base64: rawBase64, dataUrl, cropped: false });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    // On-demand MAIN world Axure page notes & widget annotations reader (runs ONLY during user PRD extraction)
    if (message.type === 'READ_AXURE_METADATA') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
      const frameId = typeof message.frameId === 'number' ? message.frameId : (sender?.frameId ?? 0);
      (async () => {
        if (!tabId || typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
          sendResponse({ ok: true, data: null });
          return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            world: 'MAIN',
            func: () => {
              const w = window as any;
              const page = w.$axure?.page;
              const rawData = w.$axure?.page?.data || w.DATA || null;
              if (!page && !rawData) return null;

              const pageName =
                typeof page?.pageName === 'string'
                  ? page.pageName
                  : typeof rawData?.pageName === 'string'
                    ? rawData.pageName
                    : '';

              const pageNotes: string[] = [];
              const rawNotes = page?.notes || rawData?.page?.notes || rawData?.notes;
              if (rawNotes && typeof rawNotes === 'object') {
                for (const [k, v] of Object.entries(rawNotes)) {
                  const text = String(v || '').trim();
                  if (text) {
                    pageNotes.push(k && k !== 'Default' ? `${k}: ${text}` : text);
                  }
                }
              }

              const widgetNotes: Array<{ label: string; note: string }> = [];
              const walkWidgets = (node: any, depth = 0) => {
                if (!node || typeof node !== 'object' || depth > 8) return;
                if (Array.isArray(node)) {
                  for (const item of node) walkWidgets(item, depth + 1);
                  return;
                }
                if (node.annotation && typeof node.annotation === 'object') {
                  const noteParts = Object.entries(node.annotation)
                    .map(([k, v]) => {
                      const val = String(v || '').trim();
                      return val ? (k && k !== 'Description' ? `${k}: ${val}` : val) : '';
                    })
                    .filter(Boolean);
                  if (noteParts.length > 0) {
                    const label = String(node.label || node.friendlyType || node.id || 'Widget').trim();
                    widgetNotes.push({ label, note: noteParts.join('；') });
                  }
                }
                if (Array.isArray(node.objects)) walkWidgets(node.objects, depth + 1);
                if (Array.isArray(node.diagrams)) walkWidgets(node.diagrams, depth + 1);
                if (node.diagram) walkWidgets(node.diagram, depth + 1);
                if (node.page) walkWidgets(node.page, depth + 1);
              };
              walkWidgets(rawData);

              return {
                pageName,
                pageNotes: pageNotes.slice(0, 30),
                widgetNotes: widgetNotes.slice(0, 60),
              };
            },
          });
          sendResponse({ ok: true, data: results?.[0]?.result ?? null });
        } catch {
          sendResponse({ ok: true, data: null });
        }
      })();
      return true;
    }

    // Relay shell context query from an inner prototype iframe to the top-level frame (frameId 0)
    if (message.type === 'COLLECT_PROTOTYPE_SHELL_CONTEXT') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
      const frameUrl = sender?.url || message.frameUrl || '';
      (async () => {
        if (!tabId) {
          sendResponse({ ok: false, data: null });
          return;
        }
        try {
          const res: any = await browser.tabs.sendMessage(
            tabId,
            { type: 'GET_PROTOTYPE_SHELL_CONTEXT', frameUrl },
            { frameId: 0 }
          );
          sendResponse(res || { ok: false, data: null });
        } catch {
          sendResponse({ ok: false, data: null });
        }
      })();
      return true;
    }

    // Open SpecLoop Extension Auth Handshake Tab
    if (message.type === 'OPEN_SPECLOOP_AUTH_TAB') {
      const baseUrl = String(message.baseUrl || '').trim().replace(/\/+$/, '');
      const version = String(message.version || '1.3.0');
      (async () => {
        try {
          const origin = safeOrigin(baseUrl);
          if (!origin) {
            throw new Error('无效的 SpecLoop 服务器地址');
          }
          await browser.storage.local.set({ [PENDING_AUTH_KEY]: origin });
          const authUrl = `${baseUrl}/auth/extension-connect?client=pagespec&version=${encodeURIComponent(version)}`;
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
                  isPrototypeShell: res.isPrototypeShell,
                  isPrototypeCanvas: res.isPrototypeCanvas,
                  prototypePlatform: res.prototypePlatform,
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
              isPrototypeShell: best.isPrototypeShell,
              isPrototypeCanvas: best.isPrototypeCanvas,
              prototypePlatform: best.prototypePlatform,
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
