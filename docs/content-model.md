# Content model

Rigel stores schema documents as JSON files in your site repository. Developers declare fields and render the public pages; editors change the values in `/rigel/`. Schema documents can coexist with `defineCopy` modules, article collections and [menus](menus.md).

For installation, see [Getting started](getting-started.md). For the full guide list, see the [documentation index](README.md).

## Declare documents and sections

Put a schema in `src/content/schema.ts`:

```ts
import { defineDocument, defineObject, defineSchema } from "@rigel-cms/rigel/content";

export default defineSchema({
  documents: [
    defineDocument({
      name: "page",
      title: "Pages",
      type: "document",
      folder: "src/content/pages",

      fields: [
        { key: "title", label: "Page name", type: "string", required: true },
        {
          key: "sections", label: "Sections", type: "array", min: 1,
          items: [{ type: "object", name: "intro" }],
        },
      ],
      template: [{ type: "intro", values: { heading: "About the project" } }],
    }),
    defineDocument({
      name: "callout",
      title: "Callouts",
      type: "document",
      folder: "src/content/shared/callouts",
      shared: true,
      fields: [{ key: "heading", label: "Heading", type: "string", required: true }],
    }),
  ],
  objects: [
    defineObject({
      name: "intro", title: "Introduction", type: "section",
      fields: [
        { key: "heading", label: "Heading", type: "string", required: true, initialValue: "Start here" },
        { key: "body", label: "Body", type: "markdown", initialValue: "Write an introduction." },
        { key: "callout", label: "Shared callout", type: "reference", to: ["callout"] },
      ],
    }),
  ],
});
```

Pass the schema to the integration in `astro.config.mjs`. This is a configuration excerpt:

```js
import schema from "./src/content/schema";

rigel({
  schema,
  preview: { documents: { page: { url: "/{slug}/", index: "/" } } },
});
```

The helpers return typed declarations; the integration validates the schema. Import helpers from `@rigel-cms/rigel/content` in site templates to avoid importing the Astro integration. Add `/// <reference types="@rigel-cms/rigel/types" />` to `src/env.d.ts` for the virtual-module types.

`virtual:rigel-content` exposes `documents`, `getDocument(id)` and `derefDocument(value)`. These are build/dev-time content helpers, not a hosted content API. Your Astro routes must enumerate and render the documents. A schema declaration or preview mapping does not create public routes.

## Choose fields

Schema scalar types are `string`, `text`, `markdown`, `boolean`, `number`, `date`, `image`, `file`, `url`, `color`, `code` and `password`. A password control masks its display; the value remains content in the repository, so use a separate secret store for credentials.

An `object` field declares nested `fields` or uses `of: "objectName"`. An `array` declares allowed `items`; named object items use `name` to select an object from `objects`. Section objects use `type: "section"` and belong in the page's `sections` array. Object and reference array items require unique, stable `_key` values. Named object items also store `_type`.

A schema reference declares `to: ["callout"]` and stores `{ "_ref": "callout:notice" }`. That record must exist and belong to an allowed type before the reference can pass Save validation. Embedding an object stores a copy; a reference points to one shared record. See [Authors](authors.md) for article references, whose collection field declaration uses a different shape, and [Media](media.md) for image and file fields.

Schema `markdown` fields store Markdown strings. Article collection bodies store Lexical state in `{ frontmatter, body }` JSON and have a read-only Markdown view. Keep those formats separate. Custom article blocks and widgets are covered in [Extensions](extensions.md).

In Inline preview mode, clicking an eligible bound Markdown field on a non-shared schema page opens the article block editor when the source survives a conversion round trip. Unbound fields and shared-document forms keep their properties-panel editor. Set `sidebarOnly: true` on a `markdown` field to keep it in the properties panel even when its preview binding is available, for example a FAQ answer edited beside the question that owns it:

```ts
const faqAnswer = { key: "answer", label: "Answer", type: "markdown", sidebarOnly: true };
```

The flag applies to `markdown` fields only, and Rigel rejects it on any other type.

## Seed new content

A document's `initialValue` supplies initial field values. Field-level `initialValue` fills values that the document did not supply. The entered title takes precedence for a `title` field, or for `name` when the type has no `title` field.

A document `template` seeds its `sections`. Each entry selects a section type and may supply `values`, which override that section's field defaults. Adding a section in the editor also uses its field defaults. Give required fields useful defaults where possible; placeholders are hints, not saved values. A default reference still needs an existing target, and a default image needs a real asset.

Creation and duplication clone values and regenerate existing nested `_key` values. Each new section gets its own key. Reordering keeps those keys, so preview bindings continue to point to the same items. Defaults do not exempt content from required-field validation.

## Keep identity separate from URLs

For `src/content/pages/about.json`, the storage identity is `page:about`. `_id`, when present, must match that identity, and `_type` must match the document type. The filename remains stable when an editor changes the page name or URL slug.

A non-shared document's `slug` value is an optional URL override. Rigel normalizes edited slugs to lowercase ASCII kebab-case and checks mapped page-route collisions; absent overrides fall back to the filename. Changing `title` alone does not change the URL. Use `effectiveSlug` or `pageRoute` from `@rigel-cms/rigel/content` in host routing rather than assuming every public URL matches the filename. The `index` mapping above maps an effective slug of `home` to `/`.

Rigel checks declared document routes and fixed copy-page mappings, not every route your Astro site might emit. Developers must avoid collisions with unrelated host routes and keep public routing consistent with preview mappings.

## Organize pages and shared records

Non-shared document types appear in All pages. Uncategorized pages belong to Core; set `category: "Legal"` or another name to create a separate group. This is editor metadata, not a route prefix. Shared types use standalone forms rather than a website canvas. Use `singleton: true` for a single settings record and `creatable: false` to disable creation. Provision that record in the repository; the declaration does not generate its file.

A shared edit affects every consuming page after Save and the site's rebuild or development refresh. A preview URL does not turn a shared record into a page editor. See [Sidebar](sidebar.md) for navigation and [Content locales](content-locales.md) for optional language-specific types.

## Protect required pages

Set `protectedSlugs: ["home", "about", "contact"]` on a document type to keep those pages in the website. These are storage filenames without `.json`, not editable URL slugs. Renaming a page or changing its public slug does not remove protection. List required pages explicitly; other pages of that type, including pages editors create, can be deleted from the Page tab after confirmation.

Protected pages show a disabled Delete page button and a short explanation. Shared records, singletons, types with `creatable: false`, and fixed copy modules remain developer-managed. The local store and GitHub backend enforce the same protection and reject deletion of pages referenced by other content. Deleting a page does not repair ordinary URL links in menus or copy.

## Bind the page preview

The schema cannot infer which DOM elements display a field. Give rendered elements explicit `data-rigel-*` bindings and an owning document ID. This Astro excerpt assumes `doc` and an `intro` section from the schema above:

```astro
<section data-rigel-section="intro" data-rigel-key={section._key} data-rigel-doc={doc.id}>
  <h1 data-rigel-text={`sections.${section._key}.heading`} data-rigel-doc={doc.id}>
    {section.heading}
  </h1>
  <div data-rigel-richtext={`sections.${section._key}.body`} data-rigel-doc={doc.id}>
    <Fragment set:html={renderedBody} />
  </div>
</section>
```

Here `renderedBody` must be safely rendered Markdown supplied by your host code. Bindings use dot-separated field paths with stable array keys, not CSS selectors or array positions. New sections also need prepared DOM templates. See [Preview](preview.md) for templates, shared-reference bindings and the sandbox limits, and [SEO](seo.md) for native page metadata.

## Save and storage limits

Content stays in memory until explicit Save. Unsaved-navigation guards offer a chance to save, discard or keep editing; failed saves retain the draft. Browser preferences persist independently of content.

The local document endpoint works only in development with the local backend. It validates content and reference targets, requires same-origin writes, rejects unsafe paths and prototype keys, and writes within declared folders. Document files and request bodies have a 1 MiB limit. The request checks Content-Length before reading, then checks the buffered body size; this is not a streaming memory limit.

Local writes use temporary files and atomic replacement; creation refuses an existing target. Local Save writes files without creating a Git commit. The SDK does not provide a general multi-process transaction or reserve arbitrary Astro routes. Schema document deletion remains developer-owned, so check references before removing files or types. For remote saving and publishing, see [GitHub](github.md).
