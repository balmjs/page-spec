<p align="center">
  <img src="public/icons/icon.svg" width="80" height="80" alt="PageSpec Logo" />
</p>

<h1 align="center">PageSpec</h1>

<p align="center">
  <b>High-efficiency web PRD, UI design & API specification extractor browser extension (Chrome MV3 & Firefox MV2/MV3)</b><br />
  <sub>English | <a href="README.zh-CN.md">简体中文</a></sub>
</p>

<p align="center">
  <a href="https://github.com/balmjs/page-spec/releases"><img src="https://img.shields.io/github/v/release/balmjs/page-spec?color=indigo" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://wxt.dev/"><img src="https://img.shields.io/badge/Framework-WXT-orange.svg" alt="WXT" /></a>
</p>

---

**PageSpec** is a developer-centric browser extension engineered to penetrate complex, nested, or cross-origin iframe requirement pages (Tencent Docs, WeChat SmartPages, Axure, Lanhu, MasterGo, Feishu/Lark, Yuque, Confluence, Swagger/OpenAPI, etc.).

Simply bind your local project root folder once—PageSpec extracts authenticated web content into structured **Markdown** bundles and co-located high-resolution assets directly inside **`specs/{prd,design,api,qa}`** (auto-created with anti-nesting protection, customizable per-project root naming such as `docs/specs`, and automatic conflict detection)—**100% locally and offline**, empowering Agentic Coding in **Cursor**, **Claude Code**, **Windsurf**, and **Codex**.

---

## ✨ Key Features

### 1. 🛡️ Nested / Cross-Origin iframe Penetration & Targeted Extraction
- **Deep Frame Penetration**: Penetrates all sub-frames via Chrome MV3 `all_frames: true` to bypass cross-origin isolation.
- **Content Density Scoring**: Automatically differentiates navigation/sidebar menus from the core specification body, filtering out menu clutter and anchor density.
- **Session-Authenticated Prototype Assets**: Runs directly within the authenticated session context, preserving login cookies to download high-res images, recordings, and Canvas elements concurrently, rewriting them to co-located relative paths (`./assets/<spec>/prototype-001.png`).
- **Tencent Docs AST & SmartPage Engine**: Direct AST and block normalization for Tencent Docs and WeChat SmartPages, preserving headings, blockquotes, lists, and tables without layout destruction.

### 2. 🎨 UI Design & Artboard Extractor (Lanhu / MasterGo / Modao / Web)
- **Original HD Image Recovery**: Automatically detects design artboards across Lanhu (`lanhuapp.com`), MasterGo, Modao, and web galleries, stripping CDN/OSS thumbnail resize parameters (`x-oss-process`, `imageMogr2`, etc.) to download full-resolution originals with automatic fallback.
- **Selective Artboard Picker**: Search and check only the artboards needed for your current feature task, capturing visible design annotations and color tokens into `specs/design/<title>.md` + `./assets/<title>/design-xxx.<ext>`.

### 3. ⚡ Categorized `specs/` Sync, Incremental Diff & Section Trimming
- **Smart Root Auto-Organization (`specs/{prd,design,api,qa}`)**: Select your project root folder (e.g., `my-app/`) and PageSpec automatically creates `specs/prd/`, `specs/design/`, and `specs/api/` without polluting your project root. Prevents accidental nesting, supports customizable root directory names or nested relative paths (e.g., `docs/specs`, `page-specs`, `.specs`) remembered per project, and detects existing non-PageSpec `specs/` folders with one-click switching.
- **Automatic Incremental Spec Diff**: When re-extracting an updated PRD, Design, or API doc over an existing local file, PageSpec computes section- & line-level changes and emits `<title>.diff.md` along with a one-click incremental AI prompt.
- **Interactive Section Trimmer**: Automatically skips noisy sections (e.g., *Revision History* / *Changelog*) and provides a collapsible section tree to prune unwanted headings and overwrite locally.

### 4. 🔌 Selective OpenAPI / Swagger Spec Extraction
- **Endpoint Search & Filtering**: Sniffs OpenAPI/Swagger endpoints into a searchable, tag-filterable checklist so you export only the exact endpoints required for your current task—eliminating 90% of irrelevant context noise.
- **High-Fidelity `$ref` Dereferencing**: Automatically resolves `$ref` schemas, flattens nested dot-path attribute tables, and synthesizes example JSON payloads; falls back cleanly to Deep DOM parsing for Knife4j, Apifox, and Redoc.

### 5. 📦 SpecBundle & Opt-In SpecLoop Bidirectional Bridge
- **Standard `.specbundle.zip`**: Export any PRD, Design, or API extraction with a structured `manifest.json` for downstream toolchain ingestion.
- **Pure Standalone by Default & Opt-In Sync**: PageSpec remains 100% standalone and clutter-free when disconnected. If your team runs a self-hosted **SpecLoop** workspace, you can authorize in one click (no manual token copy-paste), opt in via an unchecked-by-default checkbox to sync specs into a task, pull finalized specs or failed QA bug packs into `specs/qa/`, and unlock the conditional **Live QA Companion** tab for one-click viewport screenshots and console/HTTP error capture.

### 6. 🌐 Full Internationalization (i18n)
- **Automatic Locale Detection**: Automatically detects and adapts to your browser or OS preferred language (English or Simplified Chinese).
- **On-the-Fly Toggle**: Easily switch languages anytime using the `EN / 中` button in the header bar.

---

## 💡 AI Agent Coding Workflow

```text
[ Browser PRD / Lanhu Design / Swagger Page ]
                     │
              ( Click PageSpec )
                     ▼
[ Auto-organized in <project-root>/specs/ ]
  ├── prd/
  │     ├── UserModule.md
  │     └── assets/UserModule/prototype-001.png
  ├── design/
  │     ├── UserModule.md
  │     └── assets/UserModule/design-001.png
  ├── api/
  │     └── UserModule.md
  └── qa/                     (optional, synced from SpecLoop)
        └── UserModule-bugs.md
                     │
                     ▼
[ Prompt in Cursor / Claude Code ]
  "@specs/prd/UserModule.md @specs/design/UserModule.md @specs/api/UserModule.md
   Please implement this feature module following the specification, artboards, and API contract."
```

---

## 📦 Installation & Getting Started

### Ready-to-Use Builds (Releases)

Pre-built extension packages are available on [GitHub Releases](https://github.com/balmjs/page-spec/releases):

#### Chrome / Edge / Brave (Chromium-based Browsers)
1. Download `page-spec-<version>-chrome.zip` from [Releases](https://github.com/balmjs/page-spec/releases).
2. Unzip the file into a folder.
3. Open your browser extensions page (`chrome://extensions/` or `edge://extensions/`).
4. Enable **"Developer mode"** in the top-right corner.
5. Click **"Load unpacked"** and select the unzipped directory.

#### Firefox
1. Download `page-spec-<version>-firefox.zip` from [Releases](https://github.com/balmjs/page-spec/releases).
2. Unzip the file into a folder.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click **"Load Temporary Add-on..."** and select the `manifest.json` file in the unzipped folder.

---

## 🛠 Development & Build

### Prerequisites
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

### Commands

```bash
# Install dependencies & prepare types
pnpm install

# Start development in Chrome
pnpm dev

# Start development in Firefox
pnpm dev:firefox

# Build production extensions
pnpm build
pnpm build:firefox

# Package ZIP bundles for distribution
pnpm zip
pnpm zip:firefox

# Automated release (bumps version, tags, packages, and publishes to GitHub Releases)
pnpm release
```

---

## 📄 License & Privacy
- [MIT License](LICENSE) &copy; 2026 BalmJS
- [Privacy Policy](PRIVACY.md)
