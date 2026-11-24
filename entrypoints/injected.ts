import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

interface RingDiagnosticEntry {
  kind: 'console' | 'exception' | 'http';
  message: string;
  timestamp: string;
}

export default defineUnlistedScript(() => {
  const MAX_DIAGNOSTICS = 10;
  const w = window as any;

  // Lightweight privacy-safe diagnostic ring buffer (never captures request bodies, headers, or cookies)
  if (!w.__PAGESPEC_DIAG_RING__) {
    const ring: RingDiagnosticEntry[] = [];
    const pushEntry = (kind: RingDiagnosticEntry['kind'], message: string) => {
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
      const msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
      pushEntry('exception', `UnhandledRejection: ${msg}`);
    });

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const started = Date.now();
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        let pathname = '';
        try {
          const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
  }

  async function sniffOpenApiSpec(): Promise<any | null> {
    try {
      // 1. Swagger UI 3.x / 4.x / 5.x (Immutable.js store or plain object)
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

      // 2. Redoc
      if (w.__REDOC_STATE__?.rawSpec) return w.__REDOC_STATE__.rawSpec;
      if (w.__redoc_state?.spec?.data) return w.__redoc_state.spec.data;

      // 3. Swagger UI 2.x
      if (w.swaggerUi?.api?.swaggerObject) return w.swaggerUi.api.swaggerObject;

      // 4. Stoplight Elements / Scalar / RapiDoc
      const rapidoc = document.querySelector('rapi-doc') as any;
      if (rapidoc?.resolvedSpec) return rapidoc.resolvedSpec;

      // 5. Inspect PerformanceResourceTiming for already-fetched OpenAPI JSON endpoints
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
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'PAGESPEC_CONTENT') {
      return;
    }

    if (event.data.type === 'SNIFF_OPENAPI_SPEC') {
      const spec = await sniffOpenApiSpec();
      window.postMessage(
        {
          source: 'PAGESPEC_PAGE',
          type: 'SNIFF_OPENAPI_SPEC_RESPONSE',
          requestId: event.data.requestId,
          spec,
        },
        '*'
      );
    }

    if (event.data.type === 'GET_QA_DIAGNOSTICS') {
      const ring: RingDiagnosticEntry[] = Array.isArray(w.__PAGESPEC_DIAG_RING__)
        ? [...w.__PAGESPEC_DIAG_RING__]
        : [];
      window.postMessage(
        {
          source: 'PAGESPEC_PAGE',
          type: 'GET_QA_DIAGNOSTICS_RESPONSE',
          requestId: event.data.requestId,
          errors: ring,
        },
        '*'
      );
    }
  });
});
