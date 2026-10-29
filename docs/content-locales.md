# Content languages

Content languages are optional. Configure them separately from `languages`, which selects the editor's interface translations.

```js
rigel({
  contentLocales: {
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English" },
      { code: "fr", label: "Français" },
    ],
  },
  schema,
  collections: [
    { name: "blogEn", label: "Blog", locale: "en", folder: "src/content/blog/en", fields },
    { name: "blogFr", label: "Articles", locale: "fr", folder: "src/content/blog/fr", fields },
  ],
  preview: {
    documents: {
      pageEn: { url: "/en/{slug}/" },
      pageFr: { url: "/fr/{slug}/" },
    },
    collections: {
      blogEn: { url: "/en/blog/{slug}/", new: "/preview/blog-en/" },
      blogFr: { url: "/fr/blog/{slug}/", new: "/preview/blog-fr/" },
    },
  },
});
```

Here `schema` and `fields` are your existing document schema and article fields. Add `locale` to each document type that belongs to one content language:

```ts
defineDocument({
  name: "pageFr",
  title: "Pages françaises",
  type: "document",
  locale: "fr",
  folder: "src/content/pages/fr",
  fields: pageFields,
});
```

Each type can have different fields, allowed sections and initial content. You can also annotate an existing `defineCopy` page with `locale`. Rigel reads the annotation, not the folder name.

With multiple configured locales, the editor shows a Content language dropdown. It filters navigation, page lists, collections and search. Switching away from unsaved changes offers the existing Save, Discard and Keep editing choices. New sessions start with `defaultLocale`.

Content without a `locale` remains visible in every language. Use this for common authors, media and other shared records. A shared document type can also have a locale when its records are language-specific. The language filter is an editing convenience, not an access-control boundary: the manifest and publishing batch still contain the site's complete content.

Without `contentLocales`, the editor keeps its existing navigation and shows no content-language dropdown. A single configured locale also needs no dropdown.

Your Astro routes and templates still own website localization, including public language links, HTML `lang`, translated navigation and fallback behavior. Rigel does not translate text, pair translated entries or generate localized routes. Keep each type's URL mapping consistent with the website routes, and prepare its preview bindings as usual.
