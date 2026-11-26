<p align="center">
  <img src="public/icons/icon.svg" width="80" height="80" alt="PageSpec Logo" />
</p>

<h1 align="center">PageSpec</h1>

<p align="center">
  <b>高效前端需求、设计稿与接口规范提取浏览器插件 (Chrome MV3 & Firefox MV2/MV3)</b><br />
  <sub><a href="README.md">English</a> | 简体中文 · <a href="https://spec.balmjs.com">官方网站</a> · <a href="https://spec.balmjs.com/privacy">隐私政策</a></sub>
</p>

<p align="center">
  <a href="https://github.com/balmjs/page-spec/releases"><img src="https://img.shields.io/github/v/release/balmjs/page-spec?color=indigo" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://wxt.dev/"><img src="https://img.shields.io/badge/Framework-WXT-orange.svg" alt="WXT" /></a>
</p>

---

**PageSpec** 是一款专为前端工程师与全栈开发者打造的零后端、零 Token 浏览器规范提取插件，一键穿透各类带登录态的需求文档与原型工具（腾讯文档、企业微信文档、飞书、语雀、Confluence、Notion、Axure Cloud、Pixso、墨刀）、主流在线设计平台（Figma、蓝湖、MasterGo、Sketch、Zeplin、Mockplus、Pixso）与 Swagger/OpenAPI 接口页面。

只需绑定一次本地项目根目录，插件即可在保留当前会话登录鉴权态的前提下，按类型自动归档至项目下的 **`specs/{prd,design,api,qa}`** 分层目录（默认自动创建 `specs/`，自带防套娃保护、支持按项目自定义根目录名或多级路径如 `docs/specs`，并自动探测同名目录冲突），就近内聚图片资源。**全程 100% 本地离线解析**，即刻赋能 **Cursor**、**Claude Code**、**Windsurf**、**Codex** 等 AI Coding Agent。

---

## ✨ 核心亮点

### 1. 🛡️ 文档与原型 PRD 智能穿透提取
- **多层 iframe 自动穿透**：通过 Chrome MV3 `all_frames: true` 深入所有子框架，打破腾讯文档、企微文档、飞书、语雀、Confluence、Notion、Axure Cloud、Pixso、墨刀等页面的跨域隔离限制。
- **正文密度打分机制 (Content Density Scoring)**：智能区分左侧菜单/目录 iframe 与正文内容 iframe，自动锁定核心需求文档区，剔除侧栏、顶部杂音与高密度超链接菜单。
- **带鉴权的原型图抓取**：在正文 frame 真实会话下运行，自动携带登录态 Cookie 并发下载图片与 Canvas，转换为同级相对路径引用（`./assets/<文档名>/prototype-001.png`）。
- **腾讯文档 AST 与轻文档优化引擎**：针对腾讯文档与微信智能/轻文档提供专用 AST 解析与 DOM 规整处理器，完美保留各级标题、引用块（`>`）、列表嵌套缩进及表格布局。

### 2. 🎨 主流在线设计平台高保真提取（Figma / 蓝湖 / MasterGo / Sketch / Zeplin / Mockplus / Pixso）
- **零 Token 无损原图还原**：复用当前登录会话，自动嗅探 Figma、Zeplin、Sketch、蓝湖、Mockplus、MasterGo、Pixso 及网页设计图集中的画板，智能剥离 OSS/COS 缩略图缩放参数（`x-oss-process`、`imageMogr2` 等）并发抓取高清设计原图（签名受限时自动回退原地址）。
- **画板搜索按需勾选**：支持按画板名称搜索与勾选本次任务所需的设计图，同步抓取页面批注与色值 Token，自动落盘至 `specs/design/<文档名>.md` 与 `./assets/<文档名>/design-xxx.<ext>`。

### 3. ⚡ 智能 `specs/` 分层直写、增量 Diff 与章节裁剪
- **自动分层目录与防冲突自定义**：直接选中本地项目根目录（如 `my-app/`）即可，提取 PRD 自动保存至 `specs/prd/`、设计稿保存至 `specs/design/`、接口文档保存至 `specs/api/`。支持按项目自定义根目录名及多级相对路径（如 `docs/specs`、`page-specs`、`.specs`），若目标项目已有非 PageSpec 的同名 `specs/` 目录会自动提醒并提供一键避让。
- **本地增量 Diff 自动对比**：当产品修改 PRD 或后端修改接口再次提取时，覆写前自动对比磁盘旧版 `.md`，在同级目录生成 `<文档名>.diff.md` 并提供一键复制增量修改 AI 提示词。
- **噪音章节自动过滤 & 可视化裁剪**：默认自动跳过“修订历史 / 变更记录”等噪音章节，结果卡片内置可折叠章节树，支持随时勾选剔除无关段落并覆写本地文件。

### 4. 🔌 OpenAPI / Swagger 接口按需勾选提取
- **按需搜索过滤子集**：先嗅探列出当前页全部 API 接口，支持按路径、中文名或 Tag 分组搜索勾选本次任务所需的 1~N 个接口，剔除 90% 无关上下文噪音。
- **高保真 `$ref` 递归解引用**：自动打平多层嵌套点路径属性表并合成 Example JSON，无底层规范时无缝降级兼容 Knife4j、Apifox、Redoc 的 DOM 深度解析。

### 5. 📦 标准 `.specbundle.zip` 与克制型 SpecLoop 双向互通（可选）
- **标准离线归档包**：一键导出包含 `manifest.json` 元数据、Markdown、Diff 文件与静态资源的 `.specbundle.zip`。
- **保持纯离线初心 · 默认不打扰**：未连接 `SpecLoop` 时界面 100% 纯净无多余入口；若团队部署了 `SpecLoop` 闭环平台，支持网页一键授权连接（免手填 Token）、通过**默认不勾选**的复选框按需同步至任务、一键反向拉取定稿全套规格或 QA 打回修复包至 `specs/qa/`，并条件解锁「实测抓虫伴侣」标签页（支持一键视口截屏 + 抓取 Console/HTTP 报错）。

### 6. 🌐 完整国际化多语言支持 (i18n)
- **智能语言检测**：优先识别浏览器或客户端操作系统默认语言（中文环境默认简体中文，海外环境默认英文）。
- **界面一键即时切换**：顶部标题栏提供轻量快捷的 `EN / 中` 切换按钮，切换后配置自动持久化。

---

## 💡 AI Agent Coding 推荐工作流

```text
[ 浏览器打开 PRD / 原型 / 在线设计稿 / Swagger 接口 ]
                     │
              ( 点击 PageSpec )
                     ▼
[ 自动归档至 <项目根目录>/specs/ ]
  ├── prd/
  │     ├── 用户模块.md
  │     └── assets/用户模块/prototype-001.png
  ├── design/
  │     ├── 用户模块.md
  │     └── assets/用户模块/design-001.png
  ├── api/
  │     └── 用户模块.md
  └── qa/                     （可选：从 SpecLoop 拉取打回修复包）
        └── 用户模块-bugs.md
                     │
                     ▼
[ 在 Cursor / Claude Code 中直接对话 ]
  "@specs/prd/用户模块.md @specs/design/用户模块.md @specs/api/用户模块.md
   请严格对照需求、设计画板与接口契约完成功能开发"
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
