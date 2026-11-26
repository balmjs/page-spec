# Privacy Policy for PageSpec

**Last Updated:** November 24, 2026

## 1. Overview

**PageSpec** ("the Extension") is an open-source browser extension developed by **BalmJS**. PageSpec extracts web product specifications (PRDs), UI design artboards, and API documentation into structured Markdown files and co-located static assets saved directly into your local project folder (default `<project-root>/specs/{prd,design,api,qa}`, customizable per project) or downloadable `.zip` archives.

We believe strongly in user privacy. **PageSpec does NOT collect, sell, track, or transmit any personal data, browsing history, or document content to any developer-operated servers or third-party analytics services.**

---

## 2. Data Collection and Usage

- **100% Local Offline Core**: All document extraction, image downloading, Markdown conversion, section trimming, and incremental diff computation run locally inside your browser.
- **No Analytics, Ads, or Telemetry**: PageSpec contains zero analytics SDKs, advertising scripts, or background tracking code.
- **No External AI APIs**: PageSpec never sends your documents or source code to external LLM or cloud AI services. Extracted Markdown is saved locally for you to use with your own tools.
- **No Unprompted Page Instrumentation**: PageSpec never hooks `window.fetch` or `console.error` during normal browsing. Main-world inspection runs strictly on demand when you explicitly scan an API documentation tab or actively use the optional QA Companion tab.
- **Optional Self-Hosted SpecLoop Integration**: Only if you explicitly enter your own self-hosted **SpecLoop** server URL, authorize an API token, and opt in to syncing a task or submitting a QA test failure, PageSpec transmits the selected specification bundle, QA note, viewport screenshot, and sanitized error summary directly to the server URL you configured. PageSpec never transmits data automatically without your explicit action, and QA diagnostics never collect request bodies, `Authorization` headers, or cookies.

---

## 3. Browser Permissions

PageSpec requests only the permissions required for its user-initiated features:

| Permission | Purpose |
| :--- | :--- |
| `activeTab` | Grants access to the current active tab when you invoke PageSpec, including user-initiated visible viewport capture in the optional QA Companion. |
| `scripting` | Executes on-demand page-context inspection strictly when you scan an OpenAPI/Swagger page or actively use the optional QA Companion tab. |
| `storage` | Persists local preferences on your device (bound folder handle metadata, per-project specs root directory name, UI language, last active tab, and optional user-configured SpecLoop server settings). All preferences stay local (`chrome.storage.local`) and are never synced to developer servers. |
| `downloads` | Saves extracted Markdown bundles as downloadable `.zip` or `.md` files when direct folder writing is unavailable or not selected. |
| `webNavigation` | Enumerates iframe hierarchies on the active documentation page (such as nested Axure or wiki layouts) to locate the primary specification content frame. |
| `sidePanel` | Lets you keep the PageSpec panel open in Chrome's side panel while browsing specifications or running QA checks. |
| `host_permissions: ["<all_urls>"]` | Required because documentation, design tools, and API portals are hosted across arbitrary public and private/intranet domains chosen by the user. |

---

## 4. Local Storage, Retention, and Deletion

- **Local Project Directory Access**: When you explicitly select a local project folder, your browser grants a local directory handle used strictly to write extracted Markdown files, incremental `.diff.md` files, and co-located `./assets/` inside your chosen specs directory (default `specs/{prd,design,api,qa}`).
- **Data Retention**: All saved preferences, directory handles, and optional self-hosted SpecLoop tokens remain strictly on your local device until you remove them.
- **How to Delete Your Data**: You can unbind your local project folder or disconnect SpecLoop at any time inside PageSpec's **Settings** tab, or remove all extension data permanently by uninstalling the Extension from Chrome.

---

## 5. Third-Party Websites

When localizing prototype images or design artboards during a user-initiated extraction, PageSpec fetches those media files directly from their original hosting servers using your existing browser session. PageSpec does not share, relay, or store website authentication cookies.

---

## 6. Open Source Transparency

PageSpec is licensed under the MIT License. The complete source code is publicly auditable on GitHub:
[https://github.com/balmjs/page-spec](https://github.com/balmjs/page-spec)

---

## 7. Changes to This Policy

If PageSpec's data practices change in a future release, we will update this Privacy Policy and its "Last Updated" date before submitting the new version to the Chrome Web Store.

---

## 8. Contact

For privacy inquiries, data questions, or support:

- **Official Privacy Policy URL:** [https://spec.balmjs.com/privacy](https://spec.balmjs.com/privacy)
- **GitHub Issues:** [https://github.com/balmjs/page-spec/issues](https://github.com/balmjs/page-spec/issues)
