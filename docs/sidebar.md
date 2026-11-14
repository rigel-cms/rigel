# Content navigation

The CMS sidebar opens Pages, configured article collections, shared documents, Menus and Media. Opening an entry uses its editor and explicit Save workflow. The sidebar controls editor navigation; [menus](menus.md) control links on the public website.

## Site links

The arrow button beside the Rigel logo opens site links. In the collapsed desktop rail, the star opens the same dropdown. The expanded logo opens Dashboard through the usual unsaved-change prompt.

By default, the dropdown contains Dashboard, Live website when `preview.liveUrl` is configured, and Preview when `preview.draftUrl` is configured. The website links open the deployed sites in new tabs. Preview does not include unsaved editor changes; see [preview](preview.md) for the editor's draft preview.

Set `siteLinks` in the Astro integration to replace all default items with your own links, in order:

```ts
siteLinks: [
  { label: "Website", href: "https://example.com/" },
  { label: "Help", href: "/help/" },
]
```

Custom links open in new tabs with `noopener noreferrer`. Labels are literal text. Destinations may be relative URLs or HTTPS URLs; HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`. Rigel rejects credentials, protocol-relative URLs, unsafe schemes, whitespace and backslashes. Relative URLs resolve against the editor's current URL.

Set `siteLinks: []` to disable the dropdown. The collapsed star then opens Dashboard. Custom links replace Dashboard too; the expanded logo remains available for guarded Dashboard navigation.

## Default navigation

Without a `sidebar` option, Rigel builds these groups from the content manifest:

- Website contains Pages, configured collections and named page categories.
- Shared content contains shared document types, shared copy entries and Menus when configured.
- Assets contains Media, followed by a separator and shared singleton documents such as site settings.

Shared document types use `shared: true`; copy entries can also declare `shared: true`. A category name does not make content shared. Shared nonsingletons open a table, while an existing shared singleton opens its record directly. Website settings are content; browser preferences remain in the account menu.

## Configure the sidebar

Set `sidebar` in the [Astro integration](getting-started.md). This example assumes the named content types and singleton already exist:

```ts
sidebar: [
  { kind: "heading", label: "Website" },
  { kind: "link", target: { kind: "pages" } },
  { kind: "link", target: { kind: "collection", name: "blog" }, icon: "newspaper" },
  { kind: "heading", label: "Shared content" },
  { kind: "link", target: { kind: "documents", type: "author" }, icon: "users" },
  { kind: "link", target: { kind: "documents", type: "logoSet" } },
  { kind: "link", target: { kind: "menus" } },
  { kind: "heading", label: "Assets" },
  { kind: "link", target: { kind: "media" } },
  { kind: "separator" },
  { kind: "link", target: { kind: "document", type: "settings", id: "settings:site" }, label: "Site settings", icon: "gear" },
]
```

Entries appear in configured order. Use headings for labels and separators for plain dividers; these groups are flat, not nested or collapsible. A link's optional `label` overrides its content-derived label.

Targets use content IDs or configured names. Category targets use the exact declared category string:

| Target | Opens |
| --- | --- |
| `{ kind: "pages" }` | The combined Pages table |
| `{ kind: "pages", category: "Legal" }` | Pages filtered to a named category |
| `{ kind: "page", slug: "home" }` | A specific copy entry |
| `{ kind: "collection", name: "blog" }` | A configured article collection |
| `{ kind: "documents", type: "author" }` | A native document type |
| `{ kind: "document", type: "settings", id: "settings:site" }` | A specific native document |
| `{ kind: "menus" }` | The menu list |
| `{ kind: "media" }` | The media library |

Duplicate targets are suppressed, and targets absent from the visible manifest are skipped. Omitted default links appear under More content, so new declarations remain reachable. An explicit Pages link already covers the category views, so Rigel does not append those category links again. Headings remain visible even if their links are unavailable.

This navigation is a view over content declarations, not a permission boundary. Hiding a link does not remove its data from the manifest or change backend write permissions. See [content model](content-model.md) and [GitHub](github.md).

## Pages and categories

Pages combines nonshared copy entries and native documents. It starts at All pages, not Core. When named categories exist, a dropdown offers All pages, Core and each named category. Core means content without a category; it is a virtual group, not a directory or schema type.

Set `category` on a native document definition or copy declaration to group its pages. Categories are separate from source folders and URL routes. They do not move files. Search within Pages matches titles, slugs and categories.

The Pages table includes a Path column derived from preview route configuration. It shows the website path rather than the content file's filesystem location. Configure routes in [preview](preview.md); a sidebar label or category does not create a public URL. Add new uses the available native document templates, with choices based on the declared schema.

## Table search and navigation

Pages and article collections have live search with a clear button. Collection search matches titles, effective slugs and declared description or tags fields. Each collection keeps its own query; it does not filter another collection or Pages.

Back returns to the original table with its search and category intact. Clicking Pages in the sidebar starts at All pages with an empty query. Clicking a collection in the sidebar clears that collection's query. These resets happen after any unsaved-change prompt is accepted; Keep editing preserves the current view and filters.

## Editor links

Editor locations use hash paths, such as `/rigel/#/collections/blog`, `/rigel/#/pages/about` or `/rigel/#/logoSet/brands`. Refreshing or reopening a link restores that location after the content loads and, for GitHub, after connecting. Document links use stable storage IDs, so editing a public slug does not break them.

Browser Back and Forward use the same unsaved-change dialog as sidebar navigation. Keep editing retains the current location; Save and leave proceeds only after a successful save. Links restore locations, not unsaved edits. Missing entries and malformed links open Welcome. Opening `/rigel/` without a hash also opens Welcome.

Page-category filters and non-default content languages appear as query parameters inside the hash. These paths stay within the static editor route and do not require hosting rewrites.

## Content languages and search

When [content locales](content-locales.md) are configured, the content-language switcher filters the sidebar, Pages and collections to that locale. Declarations without a locale remain visible across languages, which suits shared authors, menus and media. The editor's interface language is a separate preference.

Global search defaults to all content languages, even while the sidebar shows one. Configure the site default with `search: { scope: "all" }` or `search: { scope: "currentLocale" }`. Editors can override it in Settings under Content with the Search content languages preference, or choose Website default to follow configuration. Search covers content records, configured collections and menus rather than serving as a media filename search.

Changing a view does not save content or bypass unsaved-change protection. See [content locales](content-locales.md) for locale-specific declarations and selection behavior.

## Collapsed rail and icons

Collapse sidebar switches the desktop rail to icons and saves that browser preference. Mobile retains text labels. Collapsed links keep accessible names and hover titles, while group headings become dividers. Collapsing the rail leaves the preview and current draft in place.

Links have default icons based on their targets. Override `icon` with a bundled Phosphor name or a same-site root-relative SVG path:

```ts
{ kind: "link", target: { kind: "collection", name: "blog" }, icon: "book-open" },
{ kind: "link", target: { kind: "documents", type: "product" }, icon: "/icons/products.svg" },
```

Put the custom file at `public/icons/products.svg` when using Astro's default public directory. Paths must begin with a single `/`, end in `.svg`, and contain only letters, numbers, underscores, hyphens, dots and slashes. Rigel rejects remote and data URLs, traversal segments, encoded characters, queries and fragments. The SVG must exist at the configured public URL.

Icons use monochrome masks that inherit the interface text color rather than preserving multicolor artwork. Bundled icons are separate build assets, so the browser downloads those used by the navigation without an icon CDN.

The bundled names are `files`, `file-text`, `newspaper`, `megaphone`, `images`, `squares-four`, `list`, `layout`, `sidebar-simple`, `magnifying-glass`, `house`, `users`, `user`, `gear`, `globe`, `folder`, `folders`, `book-open`, `calendar`, `tag`, `heart`, `shopping-bag`, `chart-bar`, `pencil-simple` and `square-half`.

## Demo content

`demo` defaults to `true`. Set `rigel({ demo: false })` to exclude document types marked `demo: true` from discovery and the writable schema. Their sidebar and search entries disappear, but their files stay on disk. This option does not generate demo files or routes; those belong to the site.

See [authors](authors.md) for shared document setup, [media](media.md) for asset browsing, [extensions](extensions.md) for custom fields and blocks, and the [documentation index](README.md) for the other guides.
