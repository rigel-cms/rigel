# Preview

Rigel previews prepared HTML from your site. After loading the page, the editor patches bound elements with the in-memory draft. Typing does not require saving, rebuilding or requesting a rendered page. Image changes can load a different asset.

See [Content model](content-model.md) for schemas and [Preview hosts](preview-hosts.md) for live and draft destinations. The [documentation index](README.md) lists the other guides.

## Map prepared routes

This is an integration configuration excerpt:

```js
rigel({
  preview: {
    pages: { about: "/about/" },
    documents: {
      page: { url: "/{slug}/", index: "/", template: "/rigel/preview/page/" },
    },
    collections: {
      blog: { url: "/blog/{slug}/", template: "/rigel/preview/blog/" },
    },
  },
});
```

`pages` maps legacy copy-page slugs. `documents` maps schema type names; `index` is the route for the effective slug `home`. `collections` maps article collection names. Every configured route must actually exist in your host output.

`template` is a static editor-local route used by the canvas for saved schema pages and new or saved articles. It stays on the editor's origin even when `draftUrl` is set. `/rigel/preview/` is the permitted template namespace inside the CMS, not a route generator. The host must supply the prepared page.

A collection can instead use `new: "/preview/blog/"`. Without `template`, the article canvas uses `new` for saved articles too, while the public link uses `url`. Article canvases require `template` or `new`; a `url` mapping alone provides website links but no canvas. Saved schema pages without `template` use their mapped document route. New schema pages have no canvas until their first Save, even with a configured template. See [Preview hosts](preview-hosts.md) for the full destination rules.

## Bind rendered fields

These HTML excerpts illustrate the scalar anchors. Render the saved values through your host template:

```html
<h1 data-rigel-text="title">Saved title</h1>
<div data-rigel-richtext="intro.body"><p>Saved rendered Markdown</p></div>
<img data-rigel-image="hero.image" data-rigel-alt="hero.alt" src="/images/cover.jpg" alt="Saved description">
<a data-rigel-href="intro.href" href="/about/">Read more</a>
<div data-rigel-richtext="$body"><p>Saved rendered article body</p></div>
```

`data-rigel-text` updates text content. `data-rigel-richtext` renders a Markdown string, or the article body for `$body`. Image and alt bindings apply to `<img>`; href bindings apply to `<a>`. Collection tags can use `data-rigel-tags="tags"` on a `<ul>` or `<ol>` to render comma-separated tags as list items.

Paths use object keys and stable array `_key` values. Array positions are not preview bindings. For schema content, put `data-rigel-doc="page:about"` on each bound element and on section/list containers. It identifies the source document for that element; a parent attribute does not substitute for attributes on descendant anchors. Referenced records use their own IDs and local field paths.

### Keep optimized images editable

Astro's `Image` and `Picture` components replace `src` with hashed, responsive candidates, so changing `src` alone changes nothing while `srcset` still lists the old files. Mark an editable image with `data-rigel-src` to show the draft instead:

```astro
<Image src={cover} alt={hero.alt} widths={[480, 960]} sizes="100vw" data-rigel-image="hero.image" data-rigel-alt="hero.alt" data-rigel-src={hero.image} />
<Picture src={cover} formats={["avif", "webp"]} alt={hero.alt} data-rigel-image="hero.image" data-rigel-src={hero.image} />
```

`data-rigel-image` names the field, as before. `data-rigel-src` holds the original browser-addressable URL that the field stores, and it marks the element as optimized. In preview, a marked image loses its `srcset` and `sizes`, and the surrounding `picture` sources lose theirs, so the field value is the file the browser loads. The attribute is not a second source of truth: preview renders the field value, and a value that fails the image URL check is dropped rather than loaded.

Public pages are untouched. Rigel patches only the editor iframe, so built markup keeps its hashed URLs, `srcset` and AVIF or WebP sources. Images without `data-rigel-src` keep their previous behavior: the `src` changes and any `srcset` stays.

Store the original reference in content, never a generated path. `/images/cover.jpg`, a media URL or an HTTPS URL work; `/_astro/cover.BnV1MXKY.webp` does not, because Astro derives it at build time. An imported file is not addressable either: `src/assets/cover.jpg` has no URL a browser can request. Serve the file from a public path or the media folder and bind that URL, even when the template imports the same file for optimization. Preview shows the original at its own size, not a resized or converted variant, and the built `width` and `height` stay as they were, so check a replacement with different proportions against the template's layout. An upload becomes reachable at its media URL once the host serves it or rebuilds.

## Prepare changing sections and lists

Scalar anchors update existing elements. Adding sections needs inert templates for each allowed section type. This HTML excerpt uses the `intro` section from [Content model](content-model.md):

```html
<div data-rigel-each="sections" data-rigel-doc="page:about">
  <section data-rigel-section="intro" data-rigel-key="intro1" data-rigel-doc="page:about">
    <h1 data-rigel-text="sections.intro1.heading" data-rigel-doc="page:about">About</h1>
    <div data-rigel-richtext="sections.intro1.body" data-rigel-doc="page:about"></div>
  </section>
  <template data-rigel-item-template="intro">
    <section data-rigel-section="intro" data-rigel-key="__item__" data-rigel-doc="page:about">
      <h1 data-rigel-text="sections.__item__.heading" data-rigel-doc="page:about"></h1>
      <div data-rigel-richtext="sections.__item__.body" data-rigel-doc="page:about"></div>
    </section>
  </template>
</div>
```

Keep rendered items and their templates as direct children of the `data-rigel-each` container. The patcher clones the template's first element, replaces the `sections.__item__` path prefix with the new stable key, then adds, removes or reorders keyed children. Templates remain available when the list becomes empty. Use the same Astro component for public and template markup to keep them consistent.

For an ordinary object array, use `data-rigel-item="row1"` on rendered children and an empty `data-rigel-item-template` value. Its template has one root item keyed `__item__`; descendant paths use the list path followed by `.__item__`. Named items match templates by `_type`. Prepared markup is required for each type you want to insert visually.

Keep optional markup mounted with `data-rigel-if="path"`; render it initially `hidden` when the saved value is empty. The patcher toggles `hidden` using the field's truthiness. Include this CSS so authored display rules do not override it:

```css
[data-rigel-if][hidden] { display: none !important; }
```

A shared region can declare `data-rigel-reference="sections.intro1.callout"` with the page's `data-rigel-doc`. Its descendants declare the referenced document's ID and local paths. Changing the selector rebinds those IDs, including inside array templates. If only part of the region belongs to the reference, wrap that part in an element with `data-rigel-reference-target` and keep page-local anchors outside it.

These bindings patch declared regions, not arbitrary component logic. Conditional Astro output that was omitted from the HTML, unprepared article feeds and script-driven layouts cannot be regenerated from a field change. Shared records themselves open standalone forms rather than a website canvas; their values reach consuming pages after Save and the host's refresh/build.

## Edit without saving

Browse mode is read-only. Edit mode lets editors select bound regions, work with section structure and open properties. The page remains visible with a notice if the required bindings are missing. A double-click on a supported single-line text binding opens inline editing; Enter accepts the draft value and Escape reverts that inline edit. Neither action writes content.

In Inline preview mode, clicking an eligible bound schema `markdown` region on a non-shared page opens the same block editor the article body uses, mounted on that rendered element. Root-level fields, section fields, nested objects and single-shape object arrays can use this path. Nested-array lookup uses the first declared object shape; fields exclusive to other item types in a heterogeneous array cannot be edited inline. Editors get block handles with duplicate, delete and move actions, drag reordering, insertion between blocks, table and media insertion, inline formatting, and undo and redo. The toolbar and the block handle float beside the prose, which keeps the website's typography and flow. Edits write back to the same in-memory Markdown string, and the active rich-text region belongs to its editor until editing ends rather than being overwritten by the DOM patcher.

A field uses the fallback Markdown editor when its source cannot round-trip through the block format without loss, such as raw HTML, a Markdown table, a fenced block with a language, or a hard-wrapped paragraph. The fallback has its own round-trip check: a language-tagged fence can remain visual there, while unsupported syntax opens in source view. Nothing is converted or written until an editor actually changes the field, and the stored value stays a Markdown string either way. The shared toolbar does not make every article block or format losslessly representable in Markdown; edited content may reopen in the fallback editor. Set `sidebarOnly: true` on a field to keep it in the properties panel, as described in [content model](content-model.md).

Settings > Content > Article body editing selects Inline preview (the default) or Sidebar. Eligible schema Markdown regions use Inline preview in place; the properties panel offers Edit in preview instead of a second editor. Unbound fields, shared-document forms and fields declared `sidebarOnly` keep their properties-panel editor. Sidebar moves eligible rich-text editing back into the panel.

Articles use the same canvas, but their body and frontmatter follow separate paths. Inline preview mounts the article body editor on the prepared `$body` element; if that region is unavailable, the body stays in the sidebar. Article frontmatter Markdown fields remain sidebar-edited even when bound in the preview. Only one editor owns an active region, and the preview patcher leaves it alone. Article Markdown view is read-only.

Explicit Save writes content through the configured backend. Navigation guards and failed-save handling apply to canvas edits too. Browser preferences save independently. See [GitHub](github.md) for saved drafts and publishing, and [Extensions](extensions.md) for custom article content.

## Keep the preview inert

The iframe uses `sandbox="allow-same-origin"` without `allow-scripts`. The trusted parent editor reads and patches its DOM. Site scripts, forms and popups stay disabled, and editor handlers suppress link navigation and submissions. Browse mode does not turn the page into an interactive site. Do not add `allow-scripts`: together with same-origin access it would expose editor storage to scripts in the preview.

Same-origin pages load directly in the iframe. Cross-origin pages are fetched with CORS, sanitized and displayed in a same-origin `srcdoc` snapshot. There is no draft postMessage bridge. See [Preview hosts](preview-hosts.md) for credentials, headers, CSP and subresource limits before using a remote host.

Markdown preview disables raw HTML and passes its rendered output through a DOMPurify allowlist before inserting a DOM fragment. Article preview uses the shared article renderer and sanitizes its output. URL bindings reject script/data schemes, protocol-relative URLs, backslashes, ASCII whitespace and ASCII control characters; image bindings accept relative or HTTP(S) URLs, and links also accept `mailto:`. Host-specific Markdown plugins and JavaScript syntax highlighting are outside this renderer's scope.

The host remains responsible for safe public rendering. Preview sanitization does not sanitize your Astro templates, create public routes or implement draft filtering for visitors. Verify both the editor canvas and the public output when adding a field or section.
