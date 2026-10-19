<p align="center">
  <img src="public/icons/icon.svg" width="80" height="80" alt="PageSpec Logo" />
</p>

<h1 align="center">PageSpec</h1>

<p align="center">
  <b>高效前端需求与接口规范提取浏览器插件 (Chrome MV3 & Firefox MV2/MV3)</b><br />
  <sub><a href="README.md">English</a> | 简体中文</sub>
</p>

<p align="center">
  <a href="https://github.com/balmjs/page-spec/releases"><img src="https://img.shields.io/github/v/release/balmjs/page-spec?color=indigo" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://wxt.dev/"><img src="https://img.shields.io/badge/Framework-WXT-orange.svg" alt="WXT" /></a>
</p>

---

**PageSpec** 是一款专为前端工程师与全栈开发者打造的高效浏览器插件，能够一键穿透各类复杂、嵌套或跨域 iframe 需求页面（腾讯文档、微信智能/轻文档、Axure、飞书、语雀、Confluence、Swagger/OpenAPI 等）。

在保留当前会话登录鉴权态的前提下，自动提取正文并转化为高保真结构化 **Markdown**，并发下载高清晰度原型图与录屏封面，直接保存到本地项目的 `requirements/` 目录中。**全程 100% 本地离线解析**，专为将复杂需求结构化为高质量上下文而生，即刻赋能 **Cursor**、**Claude Code**、**Windsurf**、**Codex** 等 AI Coding Agent。

---

## ✨ 核心亮点

### 1. 🛡️ 嵌套 / 跨域 iframe 智能穿透与靶向提取
- **多层 iframe 自动穿透**：通过 Chrome MV3 `all_frames: true` 深入所有子框架，打破跨域隔离限制。
- **正文密度打分机制 (Content Density Scoring)**：智能区分左侧菜单/目录 iframe 与正文内容 iframe，自动锁定核心需求文档区，剔除侧栏、顶部杂音与高密度超链接菜单。
- **带鉴权的原型图抓取**：在正文 frame 真实会话下运行，自动携带登录态 Cookie 并发下载图片与 Canvas，转换为本地隔离的相对路径引用（`./assets/<文档名>/prototype-001.png`）。
- **腾讯文档 AST 与轻文档优化引擎**：针对腾讯文档与微信智能/轻文档提供专用 AST 解析与 DOM 规整处理器，完美保留各级标题、引用块（`>`）、列表嵌套缩进及表格布局。

### 2. ⚡ 本地工程 `requirements/` 目录一键直写
- **File System Access API 支持**：支持在插件中一键绑定当前本地前端项目的 `requirements` 文件夹（权限句柄自动持久化存储）。
- **零解压、零拖拽**：提取时直接将 `<title>.md` 和 `assets/` 原型图落盘至本地项目磁盘，打开 IDE 即可直接 `@requirements/PRD-xxx.md` 展开编码。
- **ZIP 压缩包无缝降级**：非 Chromium 浏览器或未授权目录时，一键自动打包为 `.zip` 触发浏览器标准下载。

### 3. 🔌 结构化 API 文档提取
- **OpenAPI / Swagger 规格直出**：底层嗅探页面原生 OpenAPI 规格 JSON 并格式化为 Markdown，自动递归解引用 `$ref` 并打平属性表格。
- **DOM 表格深度打平**：兼容 Knife4j、Apifox、Redoc，自动展开折叠面板，打平多层参数表格。

### 4. 🌐 完整国际化多语言支持 (i18n)
- **智能语言检测**：优先识别浏览器或客户端操作系统默认语言（中文环境默认简体中文，海外环境默认英文）。
- **界面一键即时切换**：顶部标题栏提供轻量快捷的 `EN / 中` 切换按钮，切换后配置自动持久化。

---

## 💡 AI Agent Coding 推荐工作流

```
[ 浏览器打开需求/接口文档 ]
            │
     ( 点击 PageSpec )
            ▼
[ 一键直写本地 requirements/ 目录 ]
 ├── PRD-用户模块.md
 └── assets/PRD-用户模块/
       ├── prototype-001.png
       └── prototype-002.jpg
            │
            ▼
[ 在 Cursor / Claude Code 中直接对话 ]
 "@requirements/PRD-用户模块.md 请根据该需求文档与对应 assets/PRD-用户模块/
  原型图，实现该功能模块及相关组件"
```

---

## 📦 安装与使用指南

### 下载成品扩展（GitHub Releases）

已编译打包好的插件发布包可直接在 [GitHub Releases](https://github.com/balmjs/page-spec/releases) 下载：

#### Chrome / Edge 等 Chromium 内核浏览器
1. 在 [Releases](https://github.com/balmjs/page-spec/releases) 页面下载 `page-spec-<version>-chrome.zip` 并解压。
2. 打开浏览器扩展管理页面（Chrome 访问 `chrome://extensions/`，Edge 访问 `edge://extensions/`）。
3. 打开右上角 **「开发者模式」** 开关。
4. 点击左上角 **「加载已解压的扩展程序」**，选择刚才解压出来的目录即可。

#### Firefox (火狐浏览器)
1. 在 [Releases](https://github.com/balmjs/page-spec/releases) 页面下载 `page-spec-<version>-firefox.zip` 并解压。
2. 打开调试页面 `about:debugging#/runtime/this-firefox`。
3. 点击 **「临时载入附加组件...」**，选择解压目录下的 `manifest.json` 文件即可。

---

## 🛠 本地开发与构建

### 环境要求
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

### 常用命令

```bash
# 安装依赖并准备 WXT 类型
pnpm install

# 启动 Chrome 调试
pnpm dev

# 启动 Firefox 调试
pnpm dev:firefox

# 构建生产包
pnpm build
pnpm build:firefox

# 打包发布 ZIP
pnpm zip
pnpm zip:firefox

# 自动化发布（交互式选择版本号、构建双浏览器 ZIP 包、更新 Tag 并直传 GitHub Releases）
pnpm release
```

---

## 📄 授权协议与隐私规范
- [MIT License](LICENSE) &copy; 2026 BalmJS
- [隐私政策 (Privacy Policy)](PRIVACY.md)
