# 100x.bot Sandbox Developer Cheat Sheet (Detailed)

This doc covers the two sandbox surfaces in the unpacked Chrome extension build:

1. HTML sandbox page (`public/sandbox.html`)
2. Workflow JSLIKE runtime (`workflow_execute` / wang-executor)

It focuses on how to send/receive messages, execute workflows, and avoid common pitfalls.

## 1. Overview

There are two separate sandbox domains:

- **HTML sandbox page**: A sandboxed extension page used to render and interact with HTML safely. It communicates with the parent via `postMessage` only.
- **Workflow JSLIKE runtime**: A code execution environment for workflows. It runs either in a **service worker** (no DOM) or a **tab document** (full DOM access).

Use the HTML sandbox when you need to render untrusted HTML for preview or safe interaction. Use the JSLIKE runtime when you need to execute automation or data workflows.

## 2. HTML Sandbox (public/sandbox.html)

### 2.1 Where it is declared

Manifest entries:

- `content_security_policy.sandbox`: `sandbox allow-scripts; script-src 'self' 'unsafe-inline'; object-src 'self';`
- `sandbox.pages`: `public/sandbox.html`
- `web_accessible_resources`: includes `public/sandbox.html`

These settings mean the sandbox page runs in an isolated origin and does **not** have access to extension APIs or the parent DOM.

### 2.2 DOM structure

- `body` has `id="content"` and default class `p-4`.
- The page ships a large utility CSS sheet (Tailwind-like utility classes).
- `sandbox.html` at the extension root is a copy of `public/sandbox.html`.

### 2.3 Message protocol

The sandbox listens to `postMessage` and emits messages to the parent window.

**Incoming (parent -> sandbox)**

- `RENDER_HTML`
  - Payload: `{ type: "RENDER_HTML", html: "<div>...</div>" }`
  - Effect: Sets `document.getElementById("content").innerHTML = html`

**Outgoing (sandbox -> parent)**

- `SANDBOX_READY`
  - Payload: `{ type: "SANDBOX_READY" }`
  - Sent once after page load

- `ACTION`
  - Payload from a click on any element with `data-action` attribute:
    - `{ type: "ACTION", action: "<data-action>", payload: "<data-payload>" }`
  - Payload from a form submit for any form with `data-action`:
    - `{ type: "ACTION", action: "<data-action>", payload: "<JSON string>" }`

### 2.4 Interaction behavior

- **Clicks**: The sandbox captures click events and finds the closest element with `[data-action]`.
  - It prevents default and stops propagation.
  - It posts `ACTION` with:
    - `action`: `data-action` attribute
    - `payload`: `data-payload` attribute or empty string

- **Form submits**: The sandbox intercepts `submit` events.
  - If `form.dataset.action` exists, it gathers `FormData` and posts `ACTION`.
  - `payload` is a JSON string of the form data object.

### 2.5 Minimal usage example

Parent page example (pseudo-code):

```javascript
// When iframe loads, listen for SANDBOX_READY
window.addEventListener("message", (event) => {
  if (event.data?.type === "SANDBOX_READY") {
    iframeEl.contentWindow.postMessage(
      { type: "RENDER_HTML", html: "<button data-action='ping'>Ping</button>" },
      "*"
    );
  }

  if (event.data?.type === "ACTION") {
    console.log("Sandbox action:", event.data.action, event.data.payload);
  }
});
```

Sandbox page behavior (built-in):

- After `RENDER_HTML`, the button will render.
- Clicks will result in `{ type: "ACTION", action: "ping", payload: "" }`.

### 2.6 Security notes

- The sandbox uses `window.parent.postMessage(..., "*")` and does not validate `event.origin`.
- Validate `event.origin` and `event.source` in the parent before trusting sandbox messages.
- `RENDER_HTML` assigns `innerHTML` directly without sanitization; treat incoming HTML as untrusted.

### 2.7 Utility CSS scope

- The sandbox ships an inline utility CSS bundle (layout, spacing, typography, colors, borders, effects).
- Use utility classes directly in injected HTML; no external stylesheets are loaded in the sandbox.

## 3. Workflow JSLIKE Runtime

### 3.1 Entry point: workflow_execute

The workflow runtime is exposed by `workflow_execute`. It supports three execution styles:

1. **By workflow ID**:
   - `{ workflowId: "<uuid>", inputs: { ... } }`
2. **By workflow name**:
   - `{ workflowName: "name", inputs: { ... } }`
3. **Inline code**:
   - `{ code: "...", inputs: { ... } }`

It also accepts:

- `context`: `"serviceworker"` or `"tab-document"`
- `tabId`: required for `"tab-document"`
- `debug`: include console output and extra metadata in the response

### 3.1.1 Required fields and defaults

- `timeout` is required for all executions (string milliseconds, e.g. `"5000"`).
- `inputs` defaults to `{}` and is exposed as `__inputs`.
- `context` is auto-detected from code when omitted (DOM access implies `tab-document`).
- `workflowName`/`workflowId` resolve stored workflow code before execution.

### 3.1.2 Stored workflow records vs draft metadata

There are two distinct shapes you may use when creating/importing workflows:

- **Draft metadata** (used with `workflow_create`): name, description, workflow_type, keywords, inputs, outputs, and code.
- **Stored workflow record** (used for direct import or updates in some agents): full JSON object containing `id`, `reference_id`, `title`, `creator_id`, `user_account_id`, `created_at`, `updated_at`, `metadata.updated`, plus the `code` string (often paired with `backup_code` and `backup_timestamp`).

Some extension agents expect the **full stored record** and will ignore a draft-only payload. When in doubt, inspect a known-good exported workflow JSON and match that structure.

### 3.2 Execution contexts

**Service worker context**

- No DOM access.
- Use for computation, storage, network tasks, or capability orchestration.

**Tab document context**

- Full DOM access (`document`, `window`) for the target tab.
- Requires `tabId`.
- Use for page automation or DOM inspection.

### 3.2.1 Workflow type classification (workflow_type)

`workflow_type` is required on stored workflows and drives discovery/search filters. It also implies the default execution context.

- Format: `[service|tab]-[l0|l1|l2]`
- `service-*` => `context: "serviceworker"`
- `tab-*` => `context: "tab-document"` (requires `tabId`, execution stops on navigation)

| workflow_type | Level intent | Typical usage |
| --- | --- | --- |
| `service-l0` | Low-level helper | Single capability wrapper (dom_*/file_*/sql_*), no `document`/`window` |
| `service-l1` | Multi-step service flow | Orchestrate capabilities, no tab DOM variables |
| `service-l2` | User-facing service flow | End-to-end workflow without tab DOM variables |
| `tab-l0` | Low-level tab helper | Direct `document`/`window` usage |
| `tab-l1` | Multi-step tab automation | In-page sequences that rely on tab state |
| `tab-l2` | User-facing tab flow | End-to-end in-tab automation for current tab |

### 3.2.2 Context selection notes

- Use `serviceworker` by default for most workflows.
- `dom_*` capabilities do not require `tab-document`; only use tab context when you need `document`/`window` variables.
- Tab-context workflows stop once the tab navigates (use service context for cross-navigation flows).

### 3.3 Inputs and built-ins

- Workflow inputs are exposed as `__inputs`.
- Built-ins available in workflow code:
  - `listCapabilities()`
  - `getCapability(id)`
  - `uuid()`
  - `now()`

### 3.4 Capability calls

All registered capabilities are injected as async functions. Example:

```javascript
let button = await dom_querySelector({
  tabId: __inputs.tabId,
  phantom: { selector: "button[type='submit']" }
});

await dom_click({ tabId: __inputs.tabId, phantom: button });
```

### 3.5 Response unwrapping (wang-executor)

The workflow runtime unwraps capability responses for composition. This means:

- In workflow code, you typically receive the `data` payload directly.
- In direct agent/tool usage, you often must access `response.data` manually.

If results look “nested” or “missing,” check whether you are running inside a workflow or from the agent.

### 3.6 Output validation and debug metadata

- Output is validated against the workflow `outputs` schema when provided; mismatches return errors with expected vs actual shapes.
- Success responses include `success`, `data`, `error`, and `metadata` (data type/shape, schema validation, timing).
- With `debug: true`, metadata includes console output, execution steps, and performance metrics.
- Error responses include line/column, source snippet, variable state, recent capability calls, and console output.

## 4. Quick Recipes

### 4.1 Inline service worker computation

```json
{
  "code": "let x = __inputs.value * 2; return x;",
  "inputs": { "value": 21 },
  "context": "serviceworker",
  "timeout": "5000"
}
```

### 4.2 Inline tab-document DOM read

```json
{
  "code": "return document.title;",
  "context": "tab-document",
  "tabId": 123,
  "timeout": "5000"
}
```

### 4.3 Stored workflow in tab-document

```json
{
  "workflowName": "github/issues/extract-content",
  "inputs": { "issueNumber": 42 },
  "context": "tab-document",
  "tabId": 123,
  "timeout": "10000"
}
```

## 5. Data Flow and Diagnostics

- **Console capture**: workflow runtime can capture console output; set `debug: true` to surface it in metadata.
- **Error structure**: errors include line/column, source snippet, variable state, and recent capability calls.
- **Output schema validation**: when `outputs` is defined, mismatches return a validation error with expected/actual details.
- **Async hint**: long-running operations can be run using `__async: true` on some capability calls (check capability docs).

## 6. Capability Recipes (comprehensive)

These recipes use capability ids observed in this build. If your build exposes a different id, run `listCapabilities()` and substitute the name.

### 6.1 Capability discovery

```javascript
let capabilities = await listCapabilities();
return capabilities;
```

### 6.2 DOM automation (tab-document)

```javascript
// Find and click a button
let button = await dom_querySelector({
  tabId: __inputs.tabId,
  phantom: { selector: "button[type='submit']" }
});
await dom_click({ tabId: __inputs.tabId, phantom: button });

// Read text from multiple elements
let items = await dom_querySelectorAll({
  tabId: __inputs.tabId,
  phantom: { selector: ".product-title" }
});
let titles = [];
for (let item of items) {
  titles.push(await dom_getText({ tabId: __inputs.tabId, phantom: item }));
}
return titles;
```

```javascript
// Type text and verify input value
let input = await dom_querySelector({
  tabId: __inputs.tabId,
  phantom: { selector: "input[name='email']" }
});
await dom_typeText({ tabId: __inputs.tabId, phantom: input, text: "user@example.com" });
let valueResult = await dom_getValue({ tabId: __inputs.tabId, phantom: input });
return valueResult.value;
```

```javascript
// Snapshot DOM for analysis
let snapshot = await dom_to_file({
  tabId: __inputs.tabId,
  fileKey: "page_snapshot",
  options: { analyzeHierarchy: true, removeScripts: true }
});
return snapshot.fileKey;
```

Related DOM capabilities used in this build:
- `dom_querySelector`, `dom_querySelectorAll`
- `dom_click`, `dom_typeText`, `dom_setValue`, `dom_focus`, `dom_scroll`
- `dom_getText`, `dom_getValue`, `dom_getAttribute`
- `dom_to_file`, `dom_hierarchy_analysis`, `dom_getAccessibilityTree`

### 6.3 Tab management

```javascript
// Find a tab by URL and activate it
let tabs = await tab_query({ url: "*://example.com/*" });
if (tabs.length > 0) {
  await tab_update({ tabId: tabs[0].id, active: true });
}
```

```javascript
// Open, navigate, screenshot, close
let newTab = await tab_create({ url: "https://example.com" });
await tab_navigate({ tabId: newTab.id, url: "https://example.com/pricing" });
await tab_screenshot({ tabId: newTab.id, key: "pricing.png" });
await tab_close({ tabId: newTab.id });
```

Related tab capabilities used in this build:
- `tab_query`, `tab_create`, `tab_navigate`, `tab_update`, `tab_activate`, `tab_close`
- `tab_screenshot`

### 6.4 File storage and file utilities

```javascript
// Store text in FileStorage
await file_storage({
  action: "store",
  key: "results.json",
  text: JSON.stringify({ ok: true }),
  type: "text"
});

// Retrieve text from FileStorage
let stored = await file_storage({ action: "get", key: "results.json" });
return stored;
```

```javascript
// Search a stored file
let matches = await file_grep({
  fileKey: "page_snapshot",
  pattern: "Add to Cart",
  options: { i: true, n: true }
});
return matches;
```

```javascript
// Compare two stored DOM snapshots
return await file_diff({
  fileKey1: "before_click",
  fileKey2: "after_click",
  flags: "-u"
});
```

Related file capabilities used in this build:
- `file_storage`
- `file_grep`, `file_diff`, `file_sed`, `file_head_tail`, `file_sort`, `file_uniq`, `file_cat`, `file_cut`

### 6.5 SQL (PGLite)

```javascript
// List tables
let tables = await sql_schema({ operation: "list_tables" });

// Create a table
await sql_schema({
  operation: "create_table",
  tableName: "example_items",
  columns: { id: "TEXT PRIMARY KEY", title: "TEXT", price: "NUMERIC" },
  ifNotExists: true
});

// Insert and query
await sql_query({
  mode: "exec",
  query: "INSERT INTO example_items VALUES ($1, $2, $3)",
  params: ["123", "Widget", 9.99]
});
return await sql_query({
  query: "SELECT * FROM example_items WHERE price > $1",
  params: [5]
});
```

### 6.6 Download and fetch

```javascript
// Download a URL into FileStorage (capability id: url_download)
let file = await url_download({
  url: "https://example.com/manual.pdf",
  key: "manual.pdf",
  metadata: { description: "Product manual" }
});
return file;
```

- `url_download` respects CORS; some resources may be blocked by browser policy.

### 6.7 Visualization and dashboards

```javascript
// Configure a Perspective DataViewer for a SQL table
await perspective_config({
  tableName: "example_items",
  config: {
    plugin: "Datagrid",
    columns: ["id", "title", "price"],
    group_by: [],
    split_by: []
  },
  openNewTab: true
});
```

```javascript
// Push a dashboard UI component
await dashboard_ui({
  operation: "write",
  key: "dashboard_main.jsx",
  code: "export default function App(){return <div>Hello</div>;}"
});
```

### 6.8 Media and document processing

```javascript
// Generate a Mermaid diagram
await mermaid_diagram({
  operations: [
    { type: "generate", args: [{ diagramType: "flowchart", source: "graph TD; A-->B" }] }
  ],
  outputFormat: "svg",
  outputKey: "flowchart_example"
});
```

```javascript
// Transform video/audio with FFmpeg
await ffmpeg_transform({
  command: ["-i", "@file:input.mp4", "-vf", "scale=1280:720", "output.mp4"],
  outputKey: "scaled.mp4"
});
```

```javascript
// Archive files with 7-Zip
await sevenz_archive({
  action: "create",
  fileKeys: ["@file:results.json", "@file:pricing.png"],
  format: "zip",
  outputKey: "bundle.zip"
});
```

```javascript
// PDF operations (capability id: pdf_tools)
let text = await pdf_tools({
  action: "extract_text",
  fileKey: "@file:manual.pdf"
});
return text;
```

```javascript
// ImageMagick operations (capability id: imagemagick_transform)
await imagemagick_transform({
  source: "@file:pricing.png",
  operations: [
    { type: "resize", args: [800, 600] },
    { type: "sharpen", args: [0, 1] }
  ],
  outputKey: "pricing_small.png"
});
```

### 6.9 Recording and capture

```javascript
// Start and stop tab recording (capability id may be tab_recording)
let start = await tab_recording({ action: "start", captureActiveTab: true, format: "webm" });
// ... later
let stop = await tab_recording({ action: "stop", tabId: __inputs.tabId });
return { start, stop };
```

```javascript
// User interaction recording (capability id may be user_interaction_recording)
await user_interaction_recording({ action: "start", tabId: __inputs.tabId });
await user_interaction_recording({ action: "stop", tabId: __inputs.tabId });
```

### 6.10 Workflow and text editor tools (builder mode)

```javascript
// Search and execute a workflow
let results = await workflow_search({ query: "github issues" });
let run = await workflow_execute({
  workflowName: "github/issues/extract",
  inputs: { issueNumber: 42 },
  context: "tab-document",
  tabId: __inputs.tabId,
  timeout: "10000"
});
return { results, run };
```

```javascript
// Narrow search by workflow_type and limit
let results = await workflow_search({
  query: "github issues",
  workflow_type: "service-l1",
  limit: 25
});
```

```javascript
// Inspect and update workflow code
let code = await text_editor_view({ path: "workflow://github/issues/extract" });
await text_editor_str_replace({
  path: "workflow://github/issues/extract",
  old_str: "return items;",
  new_str: "return items.slice(0, 10);"
});
```

### 6.11 Workflow maintenance (builder mode)

```javascript
// Create workflow (preview first, then confirm)
let draft = {
  name: "github/issues/extract",
  description: "Extract issue titles and URLs",
  workflow_type: "service-l1",
  keywords: ["github", "issues"],
  inputs: { type: "object", properties: { issueNumber: { type: "number" } }, required: ["issueNumber"] },
  outputs: { type: "array", items: { type: "string" } }
};

await workflow_create(draft); // returns preview + confirmation options
await workflow_create({ ...draft, confirmed: true });
```

```javascript
// Fetch stored workflow metadata/code
let workflow = await workflow_get({ name: "github/issues/extract" });
```

```javascript
// Validate workflow code
let validation = await workflow_test({
  name: "github/issues/extract",
  checks: { syntax: true, await: true, errorHandling: true }
});
```

```javascript
// Update workflow metadata and schemas
await workflow_update({
  name: "github/issues/extract",
  description: "Extract issue titles and URLs",
  keywords: ["github", "issues"],
  outputs: { type: "array", items: { type: "string" } }
});
```

```javascript
// Delete workflow (requires confirmation)
await workflow_delete({ name: "github/issues/extract", confirmed: true });
```

### 6.12 Memory management

```javascript
// Store and search memories
await memory_manage({
  operation: "store",
  content: "Stable selector: button[type='submit']",
  keywords: ["selector", "submit", "form"]
});

return await memory_manage({
  operation: "search",
  query: "submit selector"
});
```

### 6.13 Capability catalog (observed in this build)

Use `listCapabilities()` to confirm availability; these IDs were extracted from the unpacked build bundle.

- **Workflow**: `workflow_create`, `workflow_update`, `workflow_delete`, `workflow_get`, `workflow_search`, `workflow_execute`, `workflow_test`
- **Text editor**: `text_editor_view`, `text_editor_grep`, `text_editor_str_replace`, `text_editor_str_replace_bulk`, `text_editor_insert`, `text_editor_undo_edit`
- **DOM**: `dom_click`, `dom_focus`, `dom_scroll`, `dom_to_file`, `dom_hierarchy_analysis`, `dom_clipboard`
- **Tabs**: `tab_query`, `tab_create`, `tab_update`, `tab_remove`, `tab_navigate_back`, `tab_screenshot`, `tab_recording`
- **Files**: `file_storage`, `file_cat`, `file_cut`, `file_diff`, `file_grep`, `file_head_tail`, `file_sed`, `file_sort`, `file_uniq`
- **SQL + data viz**: `sql_query`, `sql_schema`, `perspective_config`
- **Media + docs**: `ffmpeg_transform`, `imagemagick_transform`, `pdf_tools`, `mermaid_diagram`, `sevenz_archive`
- **Network + fetch**: `api_request`, `url_download`
- **Browser data**: `cookies_query`, `history_query`, `downloads_list`, `downloads_get`
- **Memory + LLM**: `memory_manage`, `llm_transform`, `agent_orchestrate`, `async_task_manage`, `conversation_get`, `conversation_persist`, `conversation_search`
- **UI + workflows**: `dashboard_ui`, `task_worksheet`, `100xui_manage`
- **Recording**: `user_interaction_recording`

## 7. Troubleshooting Matrix

| Issue | Symptoms | Likely cause | Fix |
| --- | --- | --- | --- |
| `RENDER_HTML` does nothing | Sandbox iframe remains blank | Wrong message format or sent before ready | Wait for `SANDBOX_READY`, then send `{ type: "RENDER_HTML", html: "..." }` |
| `ACTION` never received | Clicks are ignored | Missing `data-action` attribute, or clicks not on element with `data-action` | Add `data-action` to target element or a parent wrapper |
| Form submit payload empty | `payload` is `{}` | Missing `name` attributes on inputs | Add `name` attributes to inputs so `FormData` includes them |
| `tab-document` workflow fails | Error: missing `tabId` / `TAB_NOT_FOUND` | `tabId` not provided or stale | Provide valid `tabId` and ensure the tab exists |
| `document` is undefined | DOM access in service worker | Wrong `context` | Use `context: "tab-document"` and include `tabId` |
| Capability result is nested | You see `{ success, data }` or need `.data` | Running outside workflow or in agent context | Access `response.data` in agent mode or run inside workflow |
| Workflow returns `success: false` | Error metadata but no result | Capability error thrown or workflow error | Inspect `error` and metadata; enable `debug: true` |
| Workflow output schema mismatch | Validation error with expected/actual | Returned value does not match `outputs` schema | Align `return` value with `outputs` JSON schema |
| Workflow times out | Error mentions timeout | Missing/too-short `timeout` | Increase `timeout` and pass it as a string in ms |
| External message rejected | Console shows `Unauthorized origin` | Origin not on allowlist | Use a trusted origin or call from extension context |
| Inline script blocked in sandbox | Custom script fails to run | CSP in sandbox only allows `self`/`unsafe-inline` | Keep scripts inline and local to sandbox page |

## 8. References

- `manifest.json` (sandbox CSP and page registration)
- `public/sandbox.html` (message protocol)
- `sandbox.html` (copy of sandbox page)
- `assets/index.ts-1-pGdEM3.js` (workflow runtime and wang-executor)
