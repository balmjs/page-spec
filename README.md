# PageSpec 📑

> **Open-Source Cross-Browser Extension (Chrome MV3 & Firefox MV2/MV3) & WebMCP Bridge**  
> Extract authenticated, dynamically rendered web content from active browser tabs into clean, LLM-ready Markdown bundles and API specifications, and query them seamlessly from **Cursor, Claude Code, and local AI agents**.

---

## ✨ Core Features

### 1. 📦 Requirement Document Extractor ("Download PRD Bundle")
- **Authenticated DOM Traversal**: Runs directly in the active tab context, preserving user session cookies, auth tokens, and live single-page app (SPA) DOM state.
- **Smart Content Isolation**: Auto-detects main document containers across platforms (**Feishu/Lark, Confluence, Yuque, Notion, Axure**, or fallback to Readability / `<article>`), stripping away sidebars, headers, floating bars, and comments.
- **Visual Asset Deduplication & Local Rewriting**:
  - Captures `<img>`, `<canvas>` (via `toBlob()`), and inline `<svg>`.
  - Resolves lazy-loaded sources (`data-src`, `data-original`, `srcset`).
  - Intelligently filters out tiny UI icons, badges, and avatars (`< 32px`).
  - Concurrently fetches high-res images (`credentials: 'include'`) and saves them as `assets/prototype-001.png`, etc.
  - Rewrites DOM image tags to local relative paths (`./assets/prototype-001.png`).
- **Memory-Fast ZIP Packaging**: Uses `fflate` to bundle `index.md` (with YAML frontmatter) and the `assets/` directory into `<page-title>-prd.zip` in memory and triggers direct browser download.

### 2. ⚡ API Documentation Extractor ("Download API Spec")
- **Dual-Engine Extraction**:
  - **Engine A (OpenAPI Sniffing)**: Inspects the page context (`window.ui.spec()`, Redoc store, etc.) to extract raw OpenAPI 3.0 / Swagger JSON, converting it directly into pristine Markdown.
  - **Engine B (Deep DOM Parsing)**: Automatically expands collapsed Swagger / Knife4j / Apifox / Redoc accordions, flattens multi-div pseudo tables into valid Markdown tables, and preserves JSON request/response payloads in fenced code blocks.
- **Single File Output**: Generates a clean `<page-title>-api.md` with YAML frontmatter.

### 3. 🔌 WebMCP & Local MCP Bridge
- **In-Page WebMCP (`navigator.modelContext` / `window.mcp`)**: Exposes `extract_prd_markdown` and `extract_api_markdown` directly to web page AI scripts.
- **Local MCP Companion CLI**: Includes a standalone bridge (`./bin/mcp-bridge.mjs`) that connects to Cursor, Claude Code, and Claude Desktop over standard **MCP Stdio**, bridging in real-time to the browser extension via WebSocket (`ws://localhost:18492`).

---

## 🛠 Tech Stack

- **Extension Framework**: [WXT](https://wxt.dev/) (Unified Chrome MV3 & Firefox MV2/MV3 with Vite & HMR)
- **Frontend UI**: Vue 3 (Composition API, `<script setup>`) + TypeScript + Tailwind CSS
- **DOM & Markdown**: `@mozilla/readability` + `turndown` + `@truto/turndown-plugin-gfm`
- **Compression**: `fflate`
- **MCP Protocol**: `@modelcontextprotocol/sdk` + `ws`

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Run Extension in Development
```bash
# Chrome
pnpm dev

# Firefox
pnpm dev:firefox
```
WXT will automatically launch a fresh browser instance with PageSpec loaded and hot-module reloading (HMR) enabled.

### 3. Build for Production
```bash
# Build Chrome MV3
pnpm build

# Build Firefox
pnpm build:firefox

# Create distributable zip packages
pnpm zip
```
The output will be in `.output/chrome-mv3` and `.output/firefox-mv2`.

---

## 🤖 AI Client MCP Integrations (Antigravity, Codex, Cursor, Claude)

PageSpec includes a companion bridge CLI (`bin/mcp-bridge.mjs`) that exposes the active browser tab as standard MCP tools (`extract_prd_markdown`, `extract_api_markdown`) and resources.

You can automatically register PageSpec into your preferred AI client using the provided one-line commands:

```bash
# 1. Google DeepMind Antigravity (~/.gemini/config/mcp_config.json)
pnpm bridge:antigravity

# 2. OpenAI Codex (~/.codex/config.toml)
pnpm bridge:codex

# 3. Cursor (.cursor/mcp.json)
pnpm bridge:cursor

# 4. Claude Desktop / Claude Code
pnpm bridge:claude
```

---

### Manual Configuration Reference

#### 1. Google Antigravity (AGY)
Add to `~/.gemini/config/mcp_config.json` (or `.agents/mcp_config.json`):
```json
{
  "mcpServers": {
    "pagespec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/page-spec/bin/mcp-bridge.mjs"]
    }
  }
}
```

#### 2. OpenAI Codex
Add to `~/.codex/config.toml` (or `.codex/config.toml`):
```toml
[mcp_servers.pagespec]
command = "node"
args = ["/ABSOLUTE/PATH/TO/page-spec/bin/mcp-bridge.mjs"]
```

#### 3. Cursor
Add to `.cursor/mcp.json` or Global Cursor Settings:
```json
{
  "mcpServers": {
    "pagespec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/page-spec/bin/mcp-bridge.mjs"]
    }
  }
}
```

#### 4. Claude Desktop / Claude Code
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "pagespec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/page-spec/bin/mcp-bridge.mjs"]
    }
  }
}
```

---

### 💬 Usage in AI Chat
Once configured, simply open any authenticated PRD or API documentation page in your browser. In Antigravity, Codex, Cursor, or Claude Code, you can now prompt:
> *"读取浏览器当前打开的需求文档 (PRD)，梳理关键业务逻辑与技术方案。"*  
> 或:  
> *"分析当前浏览器标签页中的 API 规范，生成对应的 TypeScript 类型定义与客户端 SDK。"*

AI 客户端将自动通过 MCP 调用 `extract_prd_markdown` 或 `extract_api_markdown` 并获取完整的上下文！

---

## 📂 Project Architecture

```text
page-spec/
├── bin/
│   └── mcp-bridge.mjs         # Stdio MCP Server <-> WebSocket Bridge for Cursor/Claude
├── entrypoints/
│   ├── background.ts          # Download orchestration, WebSocket MCP bridge, SidePanel
│   ├── content.ts             # Content Script: DOM extraction, WebMCP & messaging
│   ├── injected.ts            # Main World script: window.mcp polyfill & OpenAPI sniffer
│   ├── popup/                 # Vue 3 Popup UI
│   └── sidepanel/             # Vue 3 SidePanel UI (persistent monitoring)
├── components/
│   └── PageSpecPanel.vue      # Shared Vue 3 Composition API extraction panel
├── core/
│   ├── extractors/
│   │   ├── prd-extractor.ts   # Document isolation, image concurrency & path rewriting
│   │   └── api-extractor.ts   # OpenAPI JSON engine & DOM accordion parsing
│   ├── markdown/
│   │   └── turndown-rules.ts  # GFM + API HTTP badges + callout boxes rules
│   ├── bundler/
│   │   └── zip-builder.ts     # In-memory ZIP creation via fflate
│   └── webmcp/
│       └── mcp-provider.ts    # WebMCP tool definitions & executor
├── utils/
│   └── dom-helpers.ts         # Lazy-loader, canvas-to-blob, noise cleaner, sanitizer
├── styles/
│   └── main.css               # Global Tailwind CSS
├── wxt.config.ts              # WXT build & cross-browser manifest configuration
├── package.json
└── tsconfig.json
```

---

## 📄 License

MIT License &copy; 2026 PageSpec Contributors
