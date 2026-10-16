# PageSpec 📑

> **高效前端需求采集浏览器插件 (Chrome MV3 & Firefox MV2/MV3)**  
> 专为前端开发者打造：一键穿透各类复杂/嵌套 iframe 需求页面（Axure、飞书、语雀、Confluence 等），自动提取正文转为结构化 Markdown，并发下载并重写高分辨率原型图，直接落地到本地工程的 `requirements/` 目录，无需任何 AI 交互或 Token 消耗，即刻赋能本地 Cursor / Claude Code 等 AI Agent Coding。

---

## ✨ 核心亮点

### 1. 🛡️ 嵌套 / 跨域 iframe 智能穿透与靶向提取
- **多层 iframe 自动穿透**：通过 Chrome MV3 `all_frames: true` 深入所有子框架，打破跨域隔离限制。
- **正文密度打分机制 (Content Density Scoring)**：智能区分左侧菜单/目录 iframe 与正文内容 iframe，自动锁定核心需求文档区，剔除侧栏、顶部杂音与高密度超链接菜单。
- **带鉴权的原型图抓取**：在正文 frame 真实会话下运行，自动携带登录态 Cookie 并发下载图片与 Canvas，转换为本地相对路径引用（`./assets/prototype-001.png`）。

### 2. ⚡ 本地工程 `requirements/` 目录一键直写
- **File System Access API 支持**：支持在插件中一键绑定当前本地前端项目的 `requirements` 文件夹（权限自动持久化存储）。
- **零解压、零拖拽**：提取时直接将 `<title>.md` 和 `assets/` 原型图落盘至本地项目磁盘，打开 VSCode / Cursor 即可直接 `@requirements/PRD-xxx.md` 开展开发。
- **ZIP 压缩包无缝降级**：非 Chromium 浏览器或未授权目录时，一键自动打包为 `.zip` 触发浏览器标准下载。

### 3. 🔌 结构化 API 文档提取
- **OpenAPI / Swagger 规格直出**：底层嗅探页面原生 OpenAPI 规格 JSON 并格式化为 Markdown。
- **DOM 表格深度打平**：兼容 Knife4j、Apifox、Redoc，自动展开折叠面板，打平多层参数表格。

---

## 🛠 技术栈

- **插件架构**：[WXT](https://wxt.dev/) (Chrome MV3 & Firefox MV2/MV3)
- **UI 界面**：Vue 3 (Composition API) + TypeScript + Tailwind CSS
- **DOM & Markdown 解析**：`@mozilla/readability` + `turndown` + `@truto/turndown-plugin-gfm`
- **文件落盘与压缩**：HTML5 File System Access API + `fflate`

---

## 🚀 快速上手

### 1. 安装依赖与本地开发
```bash
pnpm install

# 启动 Chrome 调试
pnpm dev

# 启动 Firefox 调试
pnpm dev:firefox
```

### 2. 构建生产包
```bash
# 构建 Chrome MV3
pnpm build

# 打包发布 ZIP (Chrome / Firefox)
pnpm zip
pnpm zip:firefox
```
构建产物输出于 `.output/chrome-mv3`，直接在 Chrome 扩展管理界面 (`chrome://extensions/`) 点击 **“加载已解压的扩展程序”** 即可使用。

### 3. 一键打包并发布至 GitHub Releases
```bash
# 交互式选择版本号、构建双浏览器 ZIP 包、更新 Tag 并直传 GitHub Releases
pnpm release

# 快捷指定版本类型
pnpm release patch   # 小版本升级 (如 1.0.0 -> 1.0.1)
pnpm release minor   # 次版本升级 (如 1.0.0 -> 1.1.0)
pnpm release major   # 主版本升级 (如 1.0.0 -> 2.0.0)

# 预演模式（仅打包验证，不创建 Tag、不提交或推送）
pnpm release --dry-run
```

---

## 💡 AI Agent Coding 推荐工作流

1. 在浏览器打开产品经理给出的需求文档或原型链接（如 Axure、飞书、语雀等）；
2. 点击 PageSpec 插件，选择本地项目的 `requirements` 文件夹（首次绑定后无需重复设置）；
3. 点击 **“一键写入本地 requirements 目录”**；
4. 回到 Cursor 或 Claude Code 终端，直接提问：
   ```text
   @requirements/PRD-用户模块.md 请根据该需求文档与对应 assets/ 原型图，实现前端业务页面及相关组件
   ```

---

## 📄 授权协议

MIT License &copy; 2026 PageSpec
