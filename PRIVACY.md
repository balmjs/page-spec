# Privacy Policy for PageSpec

**Last Updated:** October 19, 2026

## 1. Overview

**PageSpec** ("the Extension") is an open-source browser extension developed by BalmJS. The Extension is designed to extract authenticated web requirement documents (PRDs) and API specifications into clean Markdown files and localized prototype assets directly to your local file system or downloadable ZIP archives.

We believe strongly in user privacy. **PageSpec does NOT collect, store, track, or transmit any personal data, browsing history, or requirement document content to any external servers or third-party services.**

---

## 2. Data Collection and Usage

- **No Remote Data Transmission**: All DOM parsing, image fetching, and Markdown generation take place entirely locally within your browser's runtime environment. No document text, prototype graphics, API endpoints, or user interactions leave your device.
- **No Third-Party Analytics or Trackers**: PageSpec contains zero analytics scripts, advertising modules, or telemetry tracking code.
- **No External AI APIs**: The Extension does not send your documents or code to any external AI services or cloud model endpoints. The structured Markdown output is generated locally for you to use with your own local tools (e.g., Cursor, Claude Code, Windsurf, or Codex).

---

## 3. Chrome Extension Permissions

PageSpec requests the minimum permissions necessary to perform its core functionality:

| Permission | Purpose |
| :--- | :--- |
| `activeTab` | Grants temporary access to the active tab when you click the extension, enabling targeted extraction of the current page. |
| `scripting` | Executes the local extraction scripts inside the active tab and its nested frames. |
| `storage` | Stores your local preferences (such as the bound `requirements/` directory handle and preferred UI language) locally on your device. |
| `downloads` | Allows saving extracted PRD bundles as a `.zip` file when direct directory write is unsupported or unconfigured. |
| `webNavigation` | Detects and enumerates iframe hierarchies (e.g., nested Axure or documentation menus) to identify the primary content frame. |
| `sidePanel` | Allows keeping the PageSpec tool panel open in Chrome's native side panel while navigating documentation. |
| `host_permissions: ["<all_urls>"]` | Required to permit content extraction on arbitrary web-based documentation portals (such as Tencent Docs, Confluence, Axure, Swagger, etc.) that the user chooses to inspect. |

---

## 4. Local Storage and File Access

- **File System Access**: When you explicitly choose to bind a local project directory (`requirements/`), the browser grants PageSpec a local directory handle. PageSpec uses this handle strictly to write generated Markdown files and downloaded prototype graphics into that designated folder.
- **Persistence**: Directory handles and UI language settings are stored securely in Chrome's local storage (`browser.storage.local`) on your machine. You can revoke directory access at any time by clicking "Unbind" in the extension panel or via your browser's extension settings.

---

## 5. Third-Party Websites

When extracting assets (such as prototype images or recordings), PageSpec requests those assets directly from the original host servers using your existing authenticated session. PageSpec does not relay, intercept, or share authentication tokens with any third parties.

---

## 6. Open Source Transparency

PageSpec is completely open-source under the MIT License. The full source code is publicly accessible and auditable on GitHub:  
[https://github.com/balmjs/page-spec](https://github.com/balmjs/page-spec)

---

## 7. Contact Us

If you have any questions or feedback regarding this Privacy Policy, please open an issue on our GitHub repository:  
[https://github.com/balmjs/page-spec/issues](https://github.com/balmjs/page-spec/issues)
