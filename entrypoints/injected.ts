import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => {
  async function sniffOpenApiSpec(): Promise<any | null> {
    const w = window as any;
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
        .find((url) =>
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
  });
});
