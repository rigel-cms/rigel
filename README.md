# Rigel CMS

[![npm version](https://img.shields.io/npm/v/@rigel-cms/rigel)](https://www.npmjs.com/package/@rigel-cms/rigel)
[![Astro 7](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)](https://astro.build/)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

A CMS for Astro sites. You edit the text, Git keeps the history.

Edit page copy, structured content and articles at `/rigel/`. Your content stays in your repository, and your Astro site controls how it looks.

- Visual editing on prepared page templates, with unsaved changes shown in the preview.
- A block editor for articles and a media library with local uploads.
- Explicit Save, with warnings before leaving unsaved changes.
- Local file editing or GitHub drafts with pull-request publishing.

Rigel edits content, not `.astro` components. Developers define the editable fields and add preview bindings to their templates. Saving content and publishing the website are separate steps.

## Get started

Use the [Astro starter](https://github.com/rigel-cms/rigel-starter), or follow the [installation guide](docs/getting-started.md) to add Rigel to an existing site. Requires Node.js 24 and Astro 7.3 or later within Astro 7.

[Documentation](docs/README.md) · [Content model](docs/content-model.md) · [Previews](docs/preview.md) · [GitHub setup](docs/github.md)

The guides live in this repository and ship with the npm package. They describe the current source; features on `main` may not yet be in npm's `latest` release. The [documentation website](https://rigelcms.dev/docs/) is also available.

## Content languages

Declare language-specific page types and article collections, then use an optional content-language selector in the editor. See [Content languages](docs/content-locales.md) for configuration. Website routing stays in your Astro templates.

## Extensions

Register your own slash commands, toolbar buttons and saved article blocks with Svelte components. The [extension guide](docs/extensions.md) covers registration, editable blocks and published rendering.

## Browser-assisted drafts

Browsers with the experimental native WebMCP API can offer agents access to existing pages, blog/news articles, menus and shared content. Tools read and edit supported drafts, including structured fields and article bodies. Changes stay unsaved until you review them and press Save. See [setup and limits](docs/webmcp.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 [Alex Zappa](https://alex.zappa.dev/) ([FreshJuice](https://freshjuice.dev/)).
