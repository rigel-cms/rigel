# Preview hosts

Live links, deployed draft pages and unsaved canvas edits are separate. A successful Save does not mean a site build has finished, and a preview URL is not a save backend. See [GitHub](github.md) for saving and publishing, and [Preview](preview.md) for DOM bindings.

## Configure destinations

This complete `astro.config.mjs` example sets URL mappings only. Add your site's schema and collections separately:

```js
import { defineConfig } from "astro/config";
import { rigel } from "@rigel-cms/rigel";

export default defineConfig({
  integrations: [
    rigel({
      preview: {
        liveUrl: "https://www.example.com",
        draftUrl: "https://draft.example.com",
        pages: { about: "/about/" },
        documents: { page: { url: "/{slug}/", index: "/" } },
        collections: { blog: { url: "/blog/{slug}/", new: "/preview/blog/" } },
      },
    }),
  ],
});
```

Mappings must match real routes; Rigel does not infer or generate them. `index` maps an effective document slug of `home`. Route mappings are root-relative paths, not external URLs. They reject traversal, backslashes, whitespace, query strings, fragments and encoded dot/slash escapes. Ordinary routes cannot point into `/rigel/`.

`liveUrl` is the base for View live page. `draftUrl` is the base for mapped canvas routes and the draft website destination. Omit either base to use the editor's own origin for that destination; they default independently. Setting `liveUrl` alone does not move the canvas. A content field such as `draft` does not choose the host.

Bases accept HTTPS with an optional path prefix. For example, `https://www.example.com/site` plus `/about/` resolves to `https://www.example.com/site/about/`. HTTP is allowed only on loopback for development. Credentials, queries, fragments, percent-encoded base paths and dot segments are rejected during configuration parsing.

## Separate templates from public routes

The canvas resolves a configured `template` first. It is a static root-relative path on the editor's own origin, unaffected by either host base. New and saved schema pages and articles use it. New schema pages without a template have no canvas until their first Save. A page mapping can use `{ url: "/about/", template: "/rigel/preview/about/" }`; document and collection mappings accept `template` too. The host must emit the route. Inside the CMS, only `/rigel/preview/` and its descendants are allowed as templates.

Without `template`, article canvases use the collection's `new` route even after Save or when reopening an existing article. This lets a prepared empty layout display an in-memory draft without waiting for deployment. With neither `template` nor `new`, an article has no canvas, even if its `url` is mapped. Saved schema pages and legacy copy pages use their mapped routes when no template is configured.

Live links always use the real content route, including a new article's eventual URL. Draft website links also use the real route, rather than the canvas template. These links can lead to a page that has not been deployed yet. Edited URL slugs apply to website/live destinations; the prepared canvas can keep using its stable template.

The `previewPath` and `previewUrl` helpers are exported from `@rigel-cms/rigel/preview`. `previewPath(config, target, isNew)` returns a relative path. `previewUrl(config, target, mode, isNew)` resolves `"draft"` (canvas), `"live"` or `"website"` (draft website) destinations. A missing or rejected mapping returns `null`. Host templates and builds remain developer-owned.

## Prepare a remote draft host

Deploy prepared HTML for every mapped canvas route, including article `new` routes. Keep the [anchors and templates](preview.md) used by your public components. The editor fetches a deployed HTML shell and patches bound fields locally; it does not send unsaved content to the host to render a page. Unanchored regions retain deployed content.

Cross-origin HTML must be readable without authentication and return an HTML Content-Type and a CORS response header. For an editor opened at `https://cms.example.com/rigel/`, the response can contain:

```http
Content-Type: text/html; charset=utf-8
Access-Control-Allow-Origin: https://cms.example.com
```

The allowed origin has no path. On a host that supports `public/_headers`, an equivalent file is:

```text
/*
  Access-Control-Allow-Origin: https://cms.example.com
```

Use your serving platform's response-header configuration if it does not apply `_headers`. A public host may allow `*`. For a dynamic origin allowlist, return the matching origin and `Vary: Origin`. Credentialed CORS and tokens in preview URLs are inappropriate for this fetch: it omits credentials and has no authentication handshake.

Use final URLs, including the correct trailing slash. Cross-origin HTML redirects are rejected. The HTML fetch has a 15-second timeout; the frame also has a 20-second loading timeout. Missing routes, non-HTML responses and fetch failures produce a notice. The browser may group CORS, CSP and network failures under the same fetch error, so check its console and network panel.

If the editor has a CSP, allow the remote draft origin in `connect-src`, plus the needed style, image and font sources in their directives. A `srcdoc` document inherits the editor's CSP. Fonts may require separate CORS headers. Assets must be reachable without a login or anti-hotlink restriction; use HTTPS assets when the editor uses HTTPS.

## Understand the snapshot boundary

Same-origin destinations load directly in a sandboxed iframe. For a cross-origin destination, the browser cannot expose the iframe DOM to the editor. Rigel instead fetches HTML with CORS, `credentials: "omit"`, `referrerPolicy: "no-referrer"` and `redirect: "error"`. It sanitizes the result with DOMPurify and places it in same-origin `srcdoc`, with a base URL pointing at the remote page so relative assets resolve there.

The snapshot removes scripts, inline event handlers, authored base/meta elements, nested frames, objects, embeds and forms. It keeps stylesheet links, adds a restrictive script-free CSP and uses `sandbox="allow-same-origin"` without script permission. The trusted parent can patch bound DOM and mount inline editing. Text edits keep the loaded frame; they do not refetch HTML. Save and unsaved-navigation guards work independently of the host.

This is an inert HTML preview, not the site's interactive application. Hydration and script-driven widgets do not run. Remote response CSP and framing headers are not copied onto the sanitized snapshot; the editor's inherited policy and the snapshot policy apply. Same-origin direct frames still need host headers that permit framing.

Configure only hosts and assets you trust. Styles and images still load through the browser, and subresource requests follow browser cookie rules even though the HTML fetch omits credentials. The remote HTML fetch does not receive Rigel's GitHub token or browser storage. This is not an authenticated preview service, and a CORS allowlist does not make public draft HTML private. Keep confidential content off publicly readable preview hosts.

For schema setup, see [Content model](content-model.md); for routing in more than one content language, see [Content locales](content-locales.md). Return to the [documentation index](README.md).
