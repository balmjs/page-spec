import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => {
  // Sniff in-page OpenAPI/Swagger objects directly from Main World context
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'PAGESPEC_CONTENT') {
      return;
    }

    if (event.data.type === 'SNIFF_OPENAPI_SPEC') {
      let spec: any = null;
      try {
        if ((window as any).ui?.spec?.()) {
          spec = (window as any).ui.spec();
        } else if ((window as any).__REDOC_STATE__?.rawSpec) {
          spec = (window as any).__REDOC_STATE__.rawSpec;
        } else if ((window as any).swaggerUi?.api?.swaggerObject) {
          spec = (window as any).swaggerUi.api.swaggerObject;
        }
      } catch {
        // ignore spec access errors
      }

      window.postMessage(
        {
          source: 'PAGESPEC_PAGE',
          type: 'SNIFF_OPENAPI_SPEC_RESPONSE',
          spec,
        },
        '*'
      );
    }
  });
});
