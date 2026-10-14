import { extractPrdBundle, type PrdExtractionResult } from '../extractors/prd-extractor';
import { extractApiDocumentation, type ApiExtractionResult } from '../extractors/api-extractor';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * Standard MCP Tools definitions exposed by PageSpec.
 */
export const PAGESPEC_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'extract_prd_markdown',
    description:
      'Extract the authenticated PRD requirement document from the active browser tab into clean GFM Markdown, with prototype image metadata list.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'extract_api_markdown',
    description:
      'Extract structured API documentation from the active browser tab into clean Markdown with endpoints, methods, parameters, and payload schemas.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export interface McpToolCallResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: any;
  }>;
  isError?: boolean;
}

/**
 * Execute an MCP tool inside the Content Script context.
 */
export async function executeMcpTool(toolName: string): Promise<McpToolCallResponse> {
  try {
    if (toolName === 'extract_prd_markdown') {
      const result: PrdExtractionResult = await extractPrdBundle();
      return {
        content: [
          {
            type: 'text',
            text: result.markdown,
          },
          {
            type: 'text',
            text: `[Metadata] Total Assets: ${result.assets.length}\n${JSON.stringify(
              result.assetMetadata,
              null,
              2
            )}`,
          },
        ],
      };
    }

    if (toolName === 'extract_api_markdown') {
      const result: ApiExtractionResult = await extractApiDocumentation();
      return {
        content: [
          {
            type: 'text',
            text: result.markdown,
          },
        ],
      };
    }

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Unknown tool name: ${toolName}`,
        },
      ],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool execution failed: ${err?.message || err}`,
        },
      ],
    };
  }
}

/**
 * In-page WebMCP adapter registration (for navigator.modelContext and window.mcp polyfill).
 */
export function setupWebMcpAdapter() {
  const mcpApi = {
    version: '1.0.0',
    tools: {
      list: async () => PAGESPEC_MCP_TOOLS,
      call: async (name: string) => executeMcpTool(name),
    },
  };

  // Attach to window.mcp
  (window as any).mcp = mcpApi;

  // Polyfill navigator.modelContext if not natively present
  if (typeof (navigator as any).modelContext === 'undefined') {
    Object.defineProperty(navigator, 'modelContext', {
      value: mcpApi,
      writable: false,
      configurable: true,
    });
  }
}
