# Rigel CMS

A CMS for Astro sites. You edit the text, git keeps the history.

## Collection validation

New collection drafts initialize every configured field, including Rigel's automatic `description`, `metaTitle`, and `ogImage` strings. Existing content is never filled in automatically; unknown properties are preserved and missing optional fields remain allowed.

Rigel validates configured collection field types and `required: true` on load and before local or GitHub saves. Required strings must contain non-whitespace text, required arrays must contain an item, and `false` is a valid required boolean. Dates use real `YYYY-MM-DD` calendar dates; optional dates may be empty. Tags are arrays of strings and references must select configured entries.

Astro content schemas remain the host site's contract: Rigel does not discover or execute them. Align Rigel field types and requiredness with the host schema. For example, Astro's `z.string()` accepts an initialized empty description; `z.string().min(1)` also needs Rigel's `required: true`.

## Editor templates and website previews

Set `template` on a collection, schema document type, or copy-page mapping to choose the editor's prepared HTML. It is a static root-relative path on the editor's own origin, independent of `draftUrl` and `liveUrl`:

```js
rigel({
  preview: {
    draftUrl: "https://drafts.example.com/",
    liveUrl: "https://example.com/",
    collections: {
      blog: { url: "/blog/{slug}/", template: "/rigel/preview/blog/" },
    },
    documents: {
      page: { url: "/{slug}/", index: "/", template: "/templates/page/" },
    },
    pages: {
      about: { url: "/about/", template: "/templates/about/" },
    },
  },
});
```

`template` supplies the editing canvas independently of the website route. Collection canvases can use it before the first Save; new schema page documents still require their first Save before opening a canvas. `url` supplies the real route for "Preview on website" on `draftUrl` and live links on `liveUrl`. Saving or editing a slug does not switch the canvas to a deployed article. The host site must build each template with Rigel anchors such as `data-rigel-text="title"` and `data-rigel-richtext="$body"`; Rigel does not generate it.

Explicit templates may use `/rigel/preview/`, but not the editor or API routes. Queries, fragments, traversal and `{slug}` patterns are rejected in template paths. Existing string page mappings and collection `new` mappings remain supported; `new` retains its previous draft-base behavior when `template` is absent.

## Media uploads

Set `maxFileSize` in the `rigel()` options in `astro.config.mjs`. The value is bytes and defaults to `2 * 1024 * 1024` (2 MB). For example, `rigel({ maxFileSize: 50 * 1024 * 1024 })` allows 50 MB per file. The limit applies to uploads and downloaded image imports, not existing files or linked videos. Your host may impose its own limit.

## License

[Apache-2.0](LICENSE). Copyright 2026 [Alex Zappa](https://alex.zappa.dev/) ([FreshJuice](https://freshjuice.dev/)).
