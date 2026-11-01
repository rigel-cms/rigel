# Authors and references

Authors are shared content documents. They describe contributors to your site, independently of the account signed into Rigel or the author label attached to a media upload.

## Declare author documents

Add an author type to the site's schema:

```ts
import { defineDocument, defineSchema } from "@rigel-cms/rigel/content";

const authorDocument = defineDocument({
  name: "author",
  title: "Authors",
  type: "document",
  folder: "src/content/authors",
  shared: true,
  creatable: true,
  columns: ["photo", "email"],
  fields: [
    { key: "name", label: "Name", type: "string", required: true },
    { key: "description", label: "Description", type: "text" },
    { key: "photo", label: "Photo", type: "image" },
    { key: "email", label: "Email", type: "string" },
    { key: "url", label: "Website", type: "url" },
  ],
});

export default defineSchema({
  documents: [authorDocument],
  objects: [],
});
```

Merge this declaration into your existing schema rather than replacing its document and object lists. Pass that schema to `rigel({ schema })`; see the [content model](content-model.md) and [getting started](getting-started.md).

For an initial author, create `src/content/authors/sam.json`:

```json
{
  "_id": "author:sam",
  "_type": "author",
  "name": "Sam",
  "description": "Editor",
  "photo": "/images/sam.jpg",
  "email": "sam@example.com",
  "url": "https://example.com"
}
```

The filename supplies the stable slug. `_id`, when present, must match `author:<slug>`, and `_type` must match the declared document type. Only `name` is required by this schema. Use an existing image URL or omit `photo`.

Shared types appear under Shared content. A custom [sidebar](sidebar.md) can link to the author table with `{ kind: "link", target: { kind: "documents", type: "author" }, icon: "users" }`.

The table uses names, slugs and configured columns; image columns lead with square thumbnails. Thumbnails leave the original image unchanged, and missing author photos use a placeholder. Shared documents open in a form rather than a website canvas. Add new starts an in-memory draft; Save writes its JSON using the selected backend. Existing records keep explicit Save and unsaved-navigation protection.

Set `creatable: false` for a developer-maintained list. Rigel then hides Add new and the content stores reject creation. Existing records remain editable. Document deletion is developer-managed. For nonsingletons, creation is enabled by default.

## Reference an author from native content

Native schema fields use an array of allowed document types and store reference objects. Add this field to a document's or object's `fields`:

```ts
{ key: "author", label: "Author", type: "reference", to: ["author"] }
```

Its saved value is:

```json
{ "author": { "_ref": "author:sam" } }
```

For several contributors, use an array of references:

```ts
{
  key: "authors",
  label: "Authors",
  type: "array",
  items: [{ type: "reference", to: ["author"] }],
}
```

Each array entry needs its own stable `_key`:

```json
{
  "authors": [
    { "_key": "contributor1", "_ref": "author:sam" }
  ]
}
```

The editor provides the reference and array controls. These are native schema fields, not a separate author selector API. Selection changes the current draft; it does not save it. Validation checks the reference shape, declared target type and target existence. Array entries require unique stable keys. Save the author before referencing it from another document.

## Render referenced data

Native references remain objects in saved content. Resolve them in an Astro template with `derefDocument`:

```astro
---
import { derefDocument } from "virtual:rigel-content";
interface Props { author: unknown }
const { author: reference } = Astro.props;
const author = derefDocument(reference);
const name = author?.type === "author" ? String(author.data.name ?? "") : "";
---
{name && <span>{name}</span>}
```

Pass the saved field as the component's `author` prop. Resolve each entry separately for an author array. `getDocument("author:sam")` also reads a document by its stable ID. Both helpers return `undefined` when resolution fails, so handle missing references in your templates.

The starter's `src/content/schema.ts` demonstrates native references such as its shared primary contact. Its section renderer uses `derefDocument` for shared content. Those patterns apply to authors without changing document bodies or inventing an author-specific field type. See [preview](preview.md) for binding content to an editable website view.

## References in configured article collections

Configured `collections[].fields` use a different reference contract from native schema fields. The starter's Blog and News examples use this collection form:

```ts
{ key: "author", label: "Author", type: "reference", to: "author" }
```

Here `to` is a string, and the saved article frontmatter contains the string ID `"author:sam"`. Set `multiple: true` to store an array of string IDs instead. This collection option does not apply to native `FieldDef`; native content uses the reference objects and arrays above.

Collection fields can instead use a fixed `options` array of `{ value, label }` entries. Supply exactly one of `to` or `options`. Optional option metadata includes `description`, `photo`, `email` and `url`, but the selector displays names only. Fixed options live in site configuration and cannot be added through Authors.

Collection validation rejects unknown or duplicate IDs and incorrect single/multiple shapes. Historical unavailable references remain visible in the selector rather than silently clearing. The starter's `src/components/PostPage.astro` resolves collection string IDs with `getDocument` and joins names for multiple authors. References are not automatically expanded in frontmatter or arbitrary templates.

## Public data and shared content

Author email addresses, biographies and photos are site content, not credentials or private account data. Local-mode builds include author records in the CMS manifest; GitHub-mode builds omit document values and load them after authentication. Your website templates may also expose these fields. Publish only details contributors have agreed to share, and render only the fields your website needs.

Shared content without a locale remains available across content languages. See [content locales](content-locales.md), [media](media.md) for photo selection, [GitHub](github.md) for remote saves, and the [documentation index](README.md) for the other guides.
