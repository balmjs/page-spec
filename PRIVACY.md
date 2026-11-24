# Privacy Policy for PageSpec

**Last Updated:** November 23, 2026

## 1. Overview

**PageSpec** ("the Extension") is an open-source browser extension developed by BalmJS. The Extension is designed to extract authenticated web requirement documents (PRDs), UI design artboards, and API specifications into clean Markdown files and co-located static assets directly inside your local project's `specs/{prd,design,api}` folders or downloadable ZIP archives.

We believe strongly in user privacy. **PageSpec does NOT collect, track, or transmit any personal data, browsing history, or document content to any developer-operated servers or third-party analytics services.**

---

## 2. Data Collection and Usage

- **100% Local Offline Core**: All DOM parsing, image fetching, Markdown generation, section trimming, and incremental diff computation take place entirely locally within your browser's runtime environment.
- **No Third-Party Analytics or Trackers**: PageSpec contains zero analytics scripts, advertising modules, or telemetry tracking code.
- **No External AI APIs**: The Extension does not send your documents or code to any external AI model endpoints. Structured Markdown is generated locally for use with your own local tools (e.g., Cursor, Claude Code, Windsurf, or Codex).
- **Optional Self-Hosted SpecLoop Sync**: Only if you explicitly configure and authorize your own self-hosted **SpecLoop** server URL and opt in to syncing a task or submitting a QA test capture, the Extension sends the chosen payload directly to the server URL you configured. Never is any data sent automatically without your explicit action. When capturing live QA diagnostics on demand, PageSpec collects only the active tab URL, viewport size, and sanitized console/HTTP status summaries (never request bodies, Authorization headers, or cookies).

---

## 3. Chrome Extension Permissions

PageSpec requests the minimum permissions necessary to perform its core functionality:

| Permission | Purpose |
| :--- | :--- |
| `activeTab` | Grants temporary access to the active tab when you click the extension, enabling targeted extraction and optional user-initiated visible viewport capture. |
| `scripting` | Executes the local extraction scripts inside the active tab and its nested frames. |
| `storage` | Stores your local preferences (such as the bound project directory handle, `specs/` folder strategy, preferred UI language, and optional SpecLoop endpoint) locally on your device. |
| `downloads` | Allows saving extracted bundles as a `.zip` file when direct directory write is unsupported or unconfigured. |
| `webNavigation` | Detects and enumerates iframe hierarchies (e.g., nested Axure or documentation menus) to identify the primary content frame. |
| `sidePanel` | Allows keeping the PageSpec tool panel open in Chrome's native side panel while navigating documentation. |
| `host_permissions: ["<all_urls>"]` | Required to permit content extraction on arbitrary web-based documentation portals (such as Tencent Docs, Lanhu, Confluence, Axure, Swagger, etc.) that the user chooses to inspect. |

---

## 4. Local Storage and File Access

- **File System Access**: When you explicitly choose to bind a local project directory, the browser grants PageSpec a local directory handle. PageSpec uses this handle strictly to create and write extracted Markdown files, incremental diffs, and assets inside `specs/{prd,design,api,qa}` (or `requirements/` when preserved/configured).
- **Persistence**: Directory handles and preferences are stored locally in Chrome's extension storage (`browser.storage.local`) and IndexedDB on your machine. You can revoke directory access or disconnect SpecLoop at any time in Settings or via browser extension settings.

---

## 5. Third-Party Websites

When extracting assets (such as prototype images or design artboards), PageSpec requests those assets directly from the original host servers using your existing authenticated session. PageSpec does not relay, intercept, or share website authentication cookies with any third parties.

---

## 6. Open Source Transparency

PageSpec is completely open-source under the MIT License. The full source code is publicly accessible and auditable on GitHub:  
[https://github.com/balmjs/page-spec](https://github.com/balmjs/page-spec)

---

## 7. Contact Us

If you have any questions or feedback regarding this Privacy Policy, please open an issue on our GitHub repository:  
[https://github.com/balmjs/page-spec/issues](https://github.com/balmjs/page-spec/issues)
