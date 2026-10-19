# Chrome Web Store Listing & Review Guide for PageSpec

This document provides ready-to-use information and justification statements required when publishing or updating **PageSpec** on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).

---

## 1. Store Listing Metadata

| Field | Content |
| :--- | :--- |
| **Product Name** | `PageSpec - PRD & API Spec Extractor` |
| **Short Description** *(max 132 chars)* | `Extract authenticated web PRDs and API specs into structured Markdown and prototype assets for AI agent coding.` |
| **Category** | `Developer Tools` |
| **Primary Language** | `English` |
| **Pricing** | `Free` |
| **Privacy Policy URL** | `https://github.com/balmjs/page-spec/blob/main/PRIVACY.md` |
| **Support / Homepage URL** | `https://github.com/balmjs/page-spec` |

---

## 2. Detailed Description *(Copy-paste into Developer Console)*

```markdown
PageSpec is an open-source, developer-first browser extension engineered to extract authenticated web requirement documents (PRDs) and API specifications into clean, structured Markdown bundles and localized prototype assets directly to your local workspace.

Designed specifically to prepare high-quality, structured requirements context for modern AI Coding Agents (such as Cursor, Claude Code, Windsurf, Copilot, and Codex).

✨ Key Highlights:

1. Deep Frame Penetration: Automatically detects and pierces nested or cross-origin iframe requirement structures (Tencent Docs, WeChat SmartPages, Axure, Feishu/Lark, Yuque, Confluence, Knife4j, Apifox, Swagger).
2. Session-Authenticated Asset Scraping: Concurrently downloads high-resolution prototype screenshots, canvas graphics, and video covers under your existing authenticated session, rewriting them to isolated relative paths.
3. Direct-to-Disk Workspace Synchronization: Uses the native File System Access API to write Markdown documents and assets directly into your project's `requirements/` folder, eliminating tedious manual unzipping.
4. Structured OpenAPI / Swagger Extraction: Sniffs raw OpenAPI/Swagger JSON specifications to generate clean Markdown with automatically dereferenced $ref models and flattened schema tables.
5. 100% Local & Private: Runs entirely within your browser runtime. Zero external tracking, zero analytics, and zero remote data transmission.

Full source code and documentation: https://github.com/balmjs/page-spec
```

---

## 3. Privacy Practices (Required Review Questions)

### Single Purpose
> **Question:** *What is the single purpose of your extension?*  
> **Answer:**  
> `Extract authenticated web requirement specifications (PRDs) and API documentation into structured Markdown files and localized prototype image assets directly to the developer's local requirements directory.`

---

### Permission Justifications

When requested in the **Privacy tab**, paste the following justifications:

#### 1. `activeTab` & `scripting`
> `Required to inspect and extract content from the active webpage and its frames when the user invokes the extension, capturing DOM structures and prototype images on demand.`

#### 2. `storage`
> `Used solely to persist the user's selected local project directory handle (via the File System Access API) and UI language preference locally across browser sessions.`

#### 3. `downloads`
> `Used as a fallback mechanism to package and download extracted PRD bundles as a ZIP archive when the user's browser does not support the File System Access API or directory permission is denied.`

#### 4. `webNavigation`
> `Required to enumerate iframe hierarchies within documentation portals (such as Axure or multi-frame wikis) to identify and target the primary specification frame while ignoring auxiliary navigation menus.`

#### 5. `host_permissions: ["<all_urls>"]`
> `Required because users navigate to arbitrary internal and public documentation hosts (including company Confluence wikis, Tencent Docs, Axure prototypes, and Swagger APIs) where requirement extraction is performed.`

---

### Data Usage Declarations

Under **Data Usage**, check the boxes as follows:
- **Personally identifiable information**: `No`
- **Health information**: `No`
- **Financial and payment information**: `No`
- **Authentication information**: `No`
- **Personal communications**: `No`
- **Location**: `No`
- **Web history**: `No`
- **User activity**: `No`
- **Website content**: `Yes` (Explanation: *Temporary in-memory reading of webpage DOM to convert into Markdown for local download upon explicit user action.*)

Certify that:
- [x] The extension does not sell user data to third parties.
- [x] The extension does not use or transfer user data for purposes unrelated to the item's core functionality.
- [x] The extension does not use or transfer user data to determine creditworthiness or for lending purposes.

---

## 4. Visual Assets Checklist

- [x] **Store Icon**: `public/icons/icon-128.png` (128x128 PNG)
- [ ] **Screenshots**: At least 1 screenshot of PageSpec in action (`1280x800` or `640x400` PNG/JPEG).
- [ ] **Promotional Tile (Optional)**: `440x280` PNG.
