# Getting started

Use Node.js 24 and Astro 7.3 or later within Astro 7. These guides describe the SDK in this repository. Features on `main` may not yet be available under npm's `latest` tag.

## Start with a prepared site

Use the [Rigel starter](https://github.com/rigel-cms/rigel-starter) as a GitHub template, then clone your new repository. The starter includes page templates, articles, menus and media examples.

With pnpm installed, run these commands in the site directory:

```sh
pnpm install
pnpm dev
```

Open `/rigel/` on the local server. Change a field and press Save. Local mode writes content files in your checkout; it does not create Git commits. Run `pnpm build` to check the published routes before deploying your site.

## Add Rigel to an existing Astro site

Install the SDK with your site's package manager:

```sh
npm install @rigel-cms/rigel
```

To test a prerelease, install `@rigel-cms/rigel@next` instead. Keep the resolved version in your site's lockfile.

The example below creates an editable About page. Keep your existing Astro integrations when adding Rigel.

Create `src/content/schema.ts`:

```ts
import { defineDocument, defineSchema } from '@rigel-cms/rigel/content';

export default defineSchema({
  objects: [],
  documents: [
    defineDocument({
      name: 'page',
      title: 'Pages',
      type: 'document',
      folder: 'src/content/pages',
      fields: [
        { key: 'title', label: 'Title', type: 'string', required: true },
        { key: 'intro', label: 'Introduction', type: 'text' },
        { key: 'draft', label: 'Draft', type: 'boolean', initialValue: true },
      ],
    }),
  ],
});
```

Add the integration in `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import { rigel } from '@rigel-cms/rigel';
import schema from './src/content/schema';

export default defineConfig({
  integrations: [
    rigel({
      backend: 'local',
      schema,
      preview: { documents: { page: { url: '/{slug}/' } } },
    }),
  ],
});
```

Create `src/content/pages/about.json`:

```json
{
  "_id": "page:about",
  "_type": "page",
  "title": "About",
  "intro": "A short introduction to the people behind this website.",
  "slug": "about",
  "draft": false
}
```

The record's ID stays stable when its public slug changes. The saved example is published so that the route below also appears in a production build. Newly created pages start as drafts because of the schema's `initialValue`.

Add Rigel's virtual-module declarations to `src/env.d.ts`:

```ts
import '@rigel-cms/rigel/types';
```

Create `src/pages/[slug].astro`:

```astro
---
import { documents } from 'virtual:rigel-content';
import { effectiveSlug } from '@rigel-cms/rigel/content';

export function getStaticPaths() {
  return documents
    .filter(doc => doc.type === 'page' && (import.meta.env.DEV || doc.data.draft !== true))
    .map(doc => ({
      params: { slug: effectiveSlug(doc.data, doc.slug) },
      props: { doc },
    }));
}

const { doc } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{String(doc.data.metaTitle || doc.data.title)}</title>
  </head>
  <body>
    <main data-rigel-doc={doc.id}>
      <h1 data-rigel-text="title" data-rigel-doc={doc.id}>{String(doc.data.title)}</h1>
      <p data-rigel-text="intro" data-rigel-doc={doc.id}>{String(doc.data.intro ?? '')}</p>
    </main>
  </body>
</html>
```

Run `npm run dev`, open `/rigel/`, then choose Pages and About. The preview mapping loads `/about/`; the `data-rigel-*` bindings connect its text to the editable fields. Your Astro route owns the HTML and draft filtering.

## What saves where

Content edits require Save. Leaving an unsaved editor opens the existing save, discard or keep-editing dialog. Browser preferences, such as interface language and search scope, save separately in browser storage.

Local editing is available through Astro's development server. Deploying a static build does not deploy a filesystem-write service. Configure the [GitHub backend](github.md) for editing a deployed site, then let your hosting pipeline build the saved content.

## Continue

- [Content model](content-model.md): fields, objects, references and page templates.
- [Preview bindings](preview.md): images, Markdown and repeated sections.
- [Content languages](content-locales.md): localized pages and search preferences.
- [Live and draft hosts](preview-hosts.md): connect previews to your deployment workflow.
- [Documentation index](README.md): menus, media, authors and other guides.
