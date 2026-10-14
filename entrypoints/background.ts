import { defineBackground } from 'wxt/utils/define-background';
import { PAGESPEC_MCP_TOOLS } from '../core/webmcp/mcp-provider';

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let wsConnected = false;
  let wsReconnectTimer: any = null;
  let isBridgeEnabled = true;
  let currentPort = 18492;

  // 1. Download Orchestration
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

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

    if (message.type === 'GET_MCP_BRIDGE_STATUS') {
      sendResponse({
        enabled: isBridgeEnabled,
        connected: wsConnected,
        port: currentPort,
      });
      return true;
    }

    if (message.type === 'SET_MCP_BRIDGE_STATUS') {
      isBridgeEnabled = !!message.enabled;
      if (message.port) currentPort = Number(message.port);

      browser.storage.local.set({
        mcpBridgeEnabled: isBridgeEnabled,
        mcpBridgePort: currentPort,
      });

      if (isBridgeEnabled) {
        connectToMcpBridge();
      } else {
        disconnectMcpBridge();
      }

      sendResponse({ ok: true });
      return true;
    }

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

    return false;
  });

  // 2. WebSocket Bridge Connection Management
  function connectToMcpBridge() {
    if (!isBridgeEnabled) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearTimeout(wsReconnectTimer);

    try {
      const wsUrl = `ws://localhost:${currentPort}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsConnected = true;
        broadcastStatusChange();

        // Send register message to bridge
        ws?.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'pagespec/register',
            params: {
              client: 'PageSpec-BrowserExtension',
              version: '1.0.0',
            },
          })
        );
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMcpBridgeRpc(data);
        } catch (e) {
          console.error('[PageSpec] Failed to parse MCP bridge RPC:', e);
        }
      };

      ws.onerror = () => {
        wsConnected = false;
        broadcastStatusChange();
      };

      ws.onclose = () => {
        wsConnected = false;
        broadcastStatusChange();
        if (isBridgeEnabled) {
          // Reconnect attempt after 3 seconds
          wsReconnectTimer = setTimeout(connectToMcpBridge, 3000);
        }
      };
    } catch {
      wsConnected = false;
      broadcastStatusChange();
      if (isBridgeEnabled) {
        wsReconnectTimer = setTimeout(connectToMcpBridge, 3000);
      }
    }
  }

  function disconnectMcpBridge() {
    clearTimeout(wsReconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore close error
      }
      ws = null;
    }
    wsConnected = false;
    broadcastStatusChange();
  }

  function broadcastStatusChange() {
    browser.runtime
      .sendMessage({
        type: 'MCP_BRIDGE_STATUS_CHANGED',
        enabled: isBridgeEnabled,
        connected: wsConnected,
        port: currentPort,
      })
      .catch(() => {});
  }

  // Handle incoming JSON-RPC calls from Local Bridge CLI
  async function handleMcpBridgeRpc(msg: any) {
    if (!msg || !msg.method) return;

    const { id, method, params } = msg;

    // Ping check
    if (method === 'ping') {
      sendRpcResponse(id, { status: 'pong' });
      return;
    }

    // List tools
    if (method === 'tools/list') {
      sendRpcResponse(id, { tools: PAGESPEC_MCP_TOOLS });
      return;
    }

    // Execute tool on active tab
    if (method === 'tools/call') {
      const toolName = params?.name;
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
          sendRpcError(id, -32000, '未找到当前激活的浏览器标签页');
          return;
        }

        // Delegate to active tab content script
        const response: any = await browser.tabs.sendMessage(activeTab.id, {
          type: 'EXECUTE_MCP_TOOL',
          toolName,
        });

        if (response && response.ok) {
          sendRpcResponse(id, response.data);
        } else {
          sendRpcError(id, -32603, response?.error || '工具在标签页中执行失败');
        }
      } catch (err: any) {
        sendRpcError(id, -32603, `无法与当前标签页通信: ${err?.message || err}`);
      }
      return;
    }

    sendRpcError(id, -32601, `Method not found: ${method}`);
  }

  function sendRpcResponse(id: any, result: any) {
    if (ws && ws.readyState === WebSocket.OPEN && id !== undefined) {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }
  }

  function sendRpcError(id: any, code: number, message: string) {
    if (ws && ws.readyState === WebSocket.OPEN && id !== undefined) {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
    }
  }

  // Initialize storage preferences
  browser.storage.local
    .get(['mcpBridgeEnabled', 'mcpBridgePort'])
    .then((res) => {
      if (typeof res.mcpBridgeEnabled === 'boolean') {
        isBridgeEnabled = res.mcpBridgeEnabled;
      }
      if (res.mcpBridgePort) {
        currentPort = Number(res.mcpBridgePort);
      }
      if (isBridgeEnabled) {
        connectToMcpBridge();
      }
    })
    .catch(() => {
      connectToMcpBridge();
    });
});
