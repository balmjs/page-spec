#!/usr/bin/env node

/**
 * PageSpec MCP Companion Bridge CLI
 * Bridges Antigravity, Codex, Cursor, Claude Code, and Claude Desktop (Stdio MCP)
 * with the PageSpec Browser Extension (WebSocket).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, 'mcp-bridge.mjs');
const PORT = parseInt(process.env.PAGESPEC_PORT || '18492', 10);

// CLI Argument Handlers for client configuration (--config, --install, --help)
const args = process.argv.slice(2);

function getClientConfig(client) {
  switch (client.toLowerCase()) {
    case 'antigravity':
    case 'agy':
    case 'gemini':
      return {
        name: 'Antigravity (Google DeepMind)',
        targetFile: path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'),
        format: 'json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              pagespec: {
                command: 'node',
                args: [SCRIPT_PATH],
              },
            },
          },
          null,
          2
        ),
      };
    case 'codex':
    case 'openai':
      return {
        name: 'OpenAI Codex',
        targetFile: path.join(os.homedir(), '.codex', 'config.toml'),
        format: 'toml',
        snippet: `[mcp_servers.pagespec]\ncommand = "node"\nargs = ["${SCRIPT_PATH}"]\n`,
      };
    case 'cursor':
      return {
        name: 'Cursor',
        targetFile: path.join(process.cwd(), '.cursor', 'mcp.json'),
        format: 'json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              pagespec: {
                command: 'node',
                args: [SCRIPT_PATH],
              },
            },
          },
          null,
          2
        ),
      };
    case 'claude':
    case 'claude-desktop':
      return {
        name: 'Claude Desktop',
        targetFile:
          process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
            : path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
        format: 'json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              pagespec: {
                command: 'node',
                args: [SCRIPT_PATH],
              },
            },
          },
          null,
          2
        ),
      };
    default:
      return null;
  }
}

function handleInstall(clientKey) {
  const cfg = getClientConfig(clientKey);
  if (!cfg) {
    console.error(`未知客户端: ${clientKey}。可用选项: antigravity, codex, cursor, claude`);
    process.exit(1);
  }

  const dir = path.dirname(cfg.targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (cfg.format === 'json') {
    let existing = {};
    if (fs.existsSync(cfg.targetFile)) {
      try {
        const content = fs.readFileSync(cfg.targetFile, 'utf8').trim();
        if (content) existing = JSON.parse(content);
      } catch {
        existing = {};
      }
    }
    if (!existing.mcpServers) existing.mcpServers = {};
    existing.mcpServers.pagespec = {
      command: 'node',
      args: [SCRIPT_PATH],
    };
    fs.writeFileSync(cfg.targetFile, JSON.stringify(existing, null, 2) + '\n', 'utf8');
    console.log(`✓ 成功将 PageSpec MCP 注册到 ${cfg.name}:`);
    console.log(`  配置文件: ${cfg.targetFile}`);
  } else if (cfg.format === 'toml') {
    let content = '';
    if (fs.existsSync(cfg.targetFile)) {
      content = fs.readFileSync(cfg.targetFile, 'utf8');
    }
    if (content.includes('[mcp_servers.pagespec]')) {
      console.log(`! ${cfg.name} 配置文件中已存在 [mcp_servers.pagespec]，跳过写入。`);
      console.log(`  配置文件: ${cfg.targetFile}`);
    } else {
      const separator = content.endsWith('\n') || content.length === 0 ? '' : '\n';
      const toAppend = `${separator}\n# PageSpec Browser WebMCP Bridge\n${cfg.snippet}`;
      fs.writeFileSync(cfg.targetFile, content + toAppend, 'utf8');
      console.log(`✓ 成功将 PageSpec MCP 添加到 ${cfg.name}:`);
      console.log(`  配置文件: ${cfg.targetFile}`);
    }
  }
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
PageSpec MCP Bridge CLI

使用方式:
  node bin/mcp-bridge.mjs                   启动 MCP Stdio Server 与 WebSocket 监听服务
  node bin/mcp-bridge.mjs --config <client> 输出目标客户端的配置代码块
  node bin/mcp-bridge.mjs --install <client> 自动写入目标客户端的配置文件

支持的客户端 (<client>):
  antigravity  Google DeepMind Antigravity (~/.gemini/config/mcp_config.json)
  codex        OpenAI Codex (~/.codex/config.toml)
  cursor       Cursor (.cursor/mcp.json)
  claude       Claude Desktop (claude_desktop_config.json)

环境变量:
  PAGESPEC_PORT  指定 WebSocket 监听端口 (默认: 18492)
`);
  process.exit(0);
}

if (args[0] === '--config') {
  const target = args[1] || 'antigravity';
  const cfg = getClientConfig(target);
  if (!cfg) {
    console.error(`未知客户端: ${target}。可用选项: antigravity, codex, cursor, claude`);
    process.exit(1);
  }
  console.log(`# 目标客户端: ${cfg.name}`);
  console.log(`# 配置文件路径: ${cfg.targetFile}\n`);
  console.log(cfg.snippet);
  process.exit(0);
}

if (args[0] === '--install') {
  const target = args[1] || 'antigravity';
  handleInstall(target);
}

// -------------------------------------------------------------
// MCP Server & WebSocket Bridge Runtime
// -------------------------------------------------------------

// Log exclusively to stderr so stdout is strictly preserved for MCP JSON-RPC
function log(...msgArgs) {
  process.stderr.write(`[PageSpec-Bridge] ${msgArgs.join(' ')}\n`);
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
