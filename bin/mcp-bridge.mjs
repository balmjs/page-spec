#!/usr/bin/env node

/**
 * PageSpec MCP Companion Bridge CLI
 * Bridges Cursor, Claude Code, and Claude Desktop (Stdio MCP) with PageSpec Browser Extension (WebSocket).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PAGESPEC_PORT || '18492', 10);

// Log exclusively to stderr so stdout is strictly preserved for MCP JSON-RPC
function log(...args) {
  process.stderr.write(`[PageSpec-Bridge] ${args.join(' ')}\n`);
}

// 1. WebSocket Server for Browser Extension
let activeExtensionSocket = null;
const pendingRpcRequests = new Map();
let rpcIdCounter = 1;

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  log(`WebSocket server listening on ws://localhost:${PORT}`);
});

wss.on('connection', (ws) => {
  log('PageSpec Browser Extension connected');
  activeExtensionSocket = ws;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && pendingRpcRequests.has(msg.id)) {
        const { resolve, reject } = pendingRpcRequests.get(msg.id);
        pendingRpcRequests.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    } catch (e) {
      log('Error handling message from extension:', e);
    }
  });

  ws.on('close', () => {
    log('PageSpec Browser Extension disconnected');
    if (activeExtensionSocket === ws) {
      activeExtensionSocket = null;
    }
  });

  ws.on('error', (err) => {
    log('Extension socket error:', err.message);
  });
});

wss.on('error', (err) => {
  log('WebSocket Server error:', err.message);
});

// Helper to call remote method on extension
async function callExtension(method, params, timeoutMs = 60000) {
  if (!activeExtensionSocket || activeExtensionSocket.readyState !== WebSocket.OPEN) {
    throw new Error(
      '未检测到 PageSpec 浏览器扩展连接。\n请在 Chrome/Firefox 中打开目标文档页面，并在 PageSpec 扩展中确保 MCP 桥接已开启。'
    );
  }

  const id = rpcIdCounter++;
  const payload = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRpcRequests.delete(id);
      reject(new Error(`调用浏览器扩展超时 (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    pendingRpcRequests.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    activeExtensionSocket.send(JSON.stringify(payload));
  });
}

// 2. Setup MCP Server (Stdio)
const server = new Server(
  {
    name: 'pagespec-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// MCP: List Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'extract_prd_markdown',
        description:
          'Extract the authenticated PRD requirement document from the active browser tab into clean GFM Markdown, accompanied by prototype visual asset metadata.',
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
    ],
  };
});

// MCP: Call Tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  log(`MCP client invoked tool: ${name}`);

  try {
    const res = await callExtension('tools/call', { name });
    return res;
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `[PageSpec Error] ${err.message}`,
        },
      ],
    };
  }
});

// MCP: List Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'pagespec://active-tab/prd',
        name: 'Active Tab PRD Document',
        mimeType: 'text/markdown',
        description: 'Clean GFM Markdown extracted from the currently active browser tab PRD document.',
      },
      {
        uri: 'pagespec://active-tab/api',
        name: 'Active Tab API Specification',
        mimeType: 'text/markdown',
        description: 'Structured API specification extracted from the currently active browser tab.',
      },
    ],
  };
});

// MCP: Read Resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  log(`MCP client read resource: ${uri}`);

  try {
    if (uri === 'pagespec://active-tab/prd') {
      const res = await callExtension('tools/call', { name: 'extract_prd_markdown' });
      const text = res.content?.[0]?.text || '';
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text,
          },
        ],
      };
    }

    if (uri === 'pagespec://active-tab/api') {
      const res = await callExtension('tools/call', { name: 'extract_api_markdown' });
      const text = res.content?.[0]?.text || '';
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text,
          },
        ],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (err) {
    throw new Error(`Failed to read resource ${uri}: ${err.message}`);
  }
});

// 3. Start Stdio Transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('PageSpec MCP Stdio Server connected and ready.');
}

main().catch((err) => {
  log('Fatal error in bridge:', err);
  process.exit(1);
});
