# Browser-assisted drafts

Rigel exposes five tools through the experimental native [WebMCP API](https://developer.chrome.com/docs/ai/webmcp). Browser agents can find existing content, open it, read its draft and propose edits in memory. You review the result and press Save yourself.

Rigel detects `document.modelContext.registerTool`. Browsers without it keep the usual editor. This feature adds neither an MCP server nor an AI provider dependency. A browser API and an agent connection are separate requirements: Rigel does not configure ChatGPT, Gemini or a bridge to your authenticated tab.

## Try it

- Use a Chrome build that supports the [current imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).
- For local testing, enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome. Use localhost or HTTPS.
- For a hosted experiment, register the editor's HTTPS origin for the [Chrome origin trial](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241). Serve the token in an `Origin-Trial` response header on the editor HTML. Check Chrome's instructions for eligible versions and dates.
- Open `/rigel/` and connect GitHub if needed. Inspect available tools in Chrome's [WebMCP debugging interface](https://developer.chrome.com/docs/devtools/application/webmcp), or use a client that supports the native API.

A flag or trial token enables the browser experiment; it does not guarantee that an assistant can discover or call the tools. Rigel does not inject a polyfill or enable cross-origin tool access.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `rigel_list_content` | `{}` | Existing pages, schema documents, collection articles and menus in the current content locale. Returns explicit selection identities and a fresh context token, not document contents. |
| `rigel_select_content` | `{ context, selection }` | Opens an exact identity from the list. Unsaved changes open the normal confirmation dialog and return `pendingConfirmation: true`. The human chooses whether to stay, discard or Save. |
| `rigel_read_draft` | `{}` | Current identity, locale, context token, supported field paths, types, shapes and unsaved values. Articles also return a native body when supported. |
| `rigel_update_field` | `{ context, path, value }` | Replaces one declared field in the unsaved draft. Use the exact path and shape from a fresh read. |
| `rigel_replace_article_body` | `{ context, format, value }` | Replaces the open collection article's unsaved full body. `format` is `article-body` for native JSON or `markdown` for supported visual Markdown. |

Read again after each edit or navigation. Context tokens expire after human edits, selection changes, content-locale changes and authentication changes, including leaving and reopening the same document. When selection opens a confirmation dialog, finish it before calling another tool.

For manual JavaScript testing, use `document.modelContext.getTools()` to find the tool descriptor, then pass that descriptor and arguments to `document.modelContext.executeTool()`. Chrome may return the result as a JSON string; parse it before reading its context or field values. These browser methods are distinct from the tool's application callback.

## Content coverage

Schema documents, including shared site content, support every declared non-password field type: text, Markdown, booleans, numbers, dates, URLs, colors, code, existing asset URLs, references, nested objects, arrays and sections. A field can be replaced as a whole, or an existing nested field can be changed through a listed path. Object and reference array items retain explicit stable `_key` values; named items also require their declared `_type`. Use nonnumeric safe keys and keep existing keys when updating or reordering items. Positional array paths are not exposed.

Fields containing passwords or secret-like identifiers such as `apiKey`, `accessToken`, `session` and `credentials` are excluded. An ancestor containing an excluded field cannot be replaced as a whole; its safe existing descendants can still be edited. Unknown stored properties are omitted from read results and rejected in replacement payloads. Settings and connection state are outside the tool surface. Developers must still mark credentials correctly and keep them out of ordinary content fields.

Collection articles such as blogs and news support declared metadata, tags, references, existing image URLs and the native article body. Markdown fields use the editor's visual Markdown parser. Whole-body Markdown uses the existing lossless converter; unsupported syntax and raw HTML are rejected rather than silently dropped. Native body JSON supports the built-in article nodes, including tables, images, videos and supported embeds, through the existing body validator. Custom extension blocks are not exposed; a body containing them returns `body: null`.

Legacy copy pages support declared text, Markdown, existing image URLs and whole list replacements, including shared copy. Legacy lists keep their native unkeyed item format. Menus support title changes and whole item-tree replacements with native IDs, URL checks and configured nesting limits. A missing nested object can be initialized by replacing its declared parent field.

Creation, deletion, uploads, Save and Publish remain manual. Tools do not write content to disk, GitHub or a remote backend. Asset tools only change existing URL values; they do not upload or browse files. Field labels, values and navigation labels are untrusted content, even in read-only results.

## Guards and limits

GitHub tools require verified editing access. Rigel checks the current session on every execution and removes registrations during reconnection, failed verification, access loss, expiry and logout. Local editing is supported; demo mode does not register tools.

Calls fail during Save, publishing, preview/body loading and modal interactions, including dialogs in the same-origin editing frame. Pre-cancelled calls cannot change drafts or navigate. Cancellation after a synchronous edit does not undo that edit. Partial registration failure aborts the registration batch, and retired callbacks remain inactive.

Inputs must be plain JSON with exact argument keys. Prototype-related properties, accessors, unknown fields, invalid types and unsafe URLs are rejected before state changes. Field values allow up to 20,000 characters per string. Body inputs allow up to 1,000,000 aggregate string characters. JSON values are limited to 10,000 nodes, depth 32 and 1,000 items per array; schema traversal stops at depth 12. Native validation can impose lower limits, including menu depth, table dimensions, required fields and array bounds. Catalogs and draft reads also have resource budgets and fail if exceeded.

Schema and collection updates run the existing document validators before changing state. If another field already has a validation error, repair the draft in the editor before retrying. Each update is one field or one full body, not a multi-edit transaction.

Tool edits use the UI's draft-change and dirty-tracking paths. Unsaved status, navigation warnings, discard and explicit Save remain in place. Tool annotations describe intent; they are not authorization or a substitute for reviewing changes.

## Verification

`pnpm test` covers allowlisting, recursive validation, secret exclusion, resource limits, stale contexts, cancellation and registration cleanup. Run `node tests/webmcp.mjs` for the full editor regression. It creates an isolated site and browser profile under `_temp/`; `RIGEL_TEST_ORIGIN` can target a running source consumer instead.

The browser suite exercises pages, structured fields, blogs/news, bodies, menus, shared copy, navigation confirmation, preview loading, dialogs, authentication and explicit UI Save. It asserts zero persistence requests from tools. The main scenarios mock the native API, login and network boundaries. A separate scenario uses native Chrome discovery and execution when available and reports a skip otherwise. Native execution checks do not establish an assistant's tool selection or universal browser conformance.
