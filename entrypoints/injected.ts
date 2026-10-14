import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => {
  // 1. In-page WebMCP Bridge
  const pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'PAGESPEC_CONTENT') {
      return;
    }

    if (event.data.type === 'MCP_TOOL_RESPONSE') {
      const { requestId, result, error } = event.data;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pendingRequests.delete(requestId);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      }
    }
  });

  const mcpApi = {
    version: '1.0.0',
    tools: {
      list: async () => [
        {
          name: 'extract_prd_markdown',
          description: 'Extract authenticated PRD content into Markdown with prototype assets.',
        },
        {
          name: 'extract_api_markdown',
          description: 'Extract structured API documentation into clean Markdown.',
        },
      ],
      call: async (name: string, _args?: any) => {
        return new Promise((resolve, reject) => {
          const requestId = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          pendingRequests.set(requestId, { resolve, reject });
          window.postMessage(
            {
              source: 'PAGESPEC_PAGE',
              type: 'CALL_MCP_TOOL',
              requestId,
              toolName: name,
            },
            '*'
          );
        });
      },
    },
  };

  // Expose to window.mcp and polyfill navigator.modelContext
  (window as any).mcp = mcpApi;
  try {
    if (!('modelContext' in navigator)) {
      Object.defineProperty(navigator, 'modelContext', {
        value: mcpApi,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Ignore restricted navigator errors
  }

  // 2. Sniff in-page OpenAPI/Swagger objects
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
