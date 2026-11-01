# Content languages

Content languages are optional. Configure them separately from `languages`, which selects the editor's interface translations.

```js
rigel({
  search: { scope: "all" },
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

With multiple configured locales, the editor shows a Content language dropdown. It filters navigation, page lists and collections. Switching away from unsaved changes offers the existing Save, Discard and Keep editing choices. New sessions start with `defaultLocale`.

## Global search

Sidebar search (⌘/Ctrl + K) searches **all content languages** by default. Set `search: { scope: "currentLocale" }` in your Astro integration to default to the selected content language plus shared resources instead. Missing or invalid scope values fall back to `"all"`. This setting does not change the Pages table's language filter or its live search.

In **Settings → Content → Search content languages**, editors can choose **Website default**, **All languages**, or **Current content language**, alongside the article editing preferences. The override applies immediately and persists in `rigelcms.settings.userPref.searchScope` in this browser. Website default removes the override; Erase All Data resets it with the other browser preferences. It is independent of the editor interface language, which lives in **Settings → Interface** after Theme and Accessibility. Current content language is disabled when there are fewer than two configured content languages.

Results include legacy pages, native documents, collections, posts and menus. Shared resources appear once. Localized results show two-character language codes when multiple content languages exist, with the full configured label available on hover and to screen readers. Opening another language's result switches content language and opens that exact resource through the existing unsaved-changes guard; Keep editing leaves the language and draft untouched. Search still shows at most 12 results.

Content without a `locale` remains visible in every language. Use this for common authors, media and other shared records. A shared document type can also have a locale when its records are language-specific. The language filter is an editing convenience, not an access-control boundary: the manifest and publishing batch still contain the site's complete content.

Without `contentLocales`, the editor keeps its existing navigation and shows no content-language dropdown. A single configured locale also needs no dropdown.

Your Astro routes and templates still own website localization, including public language links, HTML `lang`, translated navigation and fallback behavior. Rigel does not translate text, pair translated entries or generate localized routes. Keep each type's URL mapping consistent with the website routes, and prepare its preview bindings as usual.

## Page categories and templates

Set `category` on a nonshared document definition to group its pages, for example `category: "Articles"`. This is schema metadata, not an editable field in stored documents. Uncategorised native documents and legacy copy pages remain in **Core** without a migration. Pages initially shows **All pages**. When categories exist, the table offers Core, All pages and each category visible in the selected content language. The live search matches title/name, slug and category substrings, ignores case and surrounding whitespace, and combines with the selected category. Its clear button restores input focus. Back preserves both the query and originating table/filter, not a filter inferred from the opened page. Content-language switches retain the query and reset unavailable categories to All pages.

Add new asks for a page name and a category from the locale-eligible, creatable document types. When a category contains multiple types, the editor also requires a Template choice using each definition's title. Shared, singleton and `creatable: false` types are not creation choices. A single uncategorised type keeps the name-only dialog. Creation uses the selected type's identity, initial values and section template; nothing is written until Save.

A visual variant can be another document definition with its own category, defaults and template—for example a Resources category with a dark-theme initial value. Its native type, folder, preview mapping and host renderer must be configured normally. A category does not change the editor theme, rewrite existing document types or generate website routes.
