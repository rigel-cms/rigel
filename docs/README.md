# Rigel CMS documentation

Rigel edits content stored in an Astro site's repository. Developers define the fields and templates; editors change content at `/rigel/` and press Save. The site owns routing, HTML, styles and deployment.

These guides follow the SDK source in this repository. Check your installed version before using features that have not reached npm's `latest` release.

## Start here

- [Getting started](getting-started.md): use the starter or add an editable page to an existing Astro site.
- [Content model](content-model.md): native documents, fields, sections and shared references.
- [Preview bindings](preview.md): prepare real page templates for unsaved visual editing.

## Configure your site

- [Content navigation](sidebar.md): sidebar entries, categories and page tables.
- [Content languages](content-locales.md): localized types, template selection and search scope.
- [Menus](menus.md): JSON menu data and your site's navigation renderer.
- [Media](media.md): uploads, metadata, providers and image pickers.
- [Authors and references](authors.md): reusable author records and article selectors.
- [Content and SEO](seo.md): editable metadata and the HTML your templates must render.
- [Extensions](extensions.md): custom article controls and saved blocks.
- [Browser-assisted drafts](webmcp.md): optional native WebMCP tools for content navigation and unsaved page, article, menu and shared-content edits.

## Save and publish

- [GitHub connection and publishing](github.md): authentication, draft saves and reviewed publishing.
- [Collection metadata ledgers](collection-ledgers.md): indexed article lists, on-demand bodies and maintenance reindexing.
- [Live and draft previews](preview-hosts.md): preview mappings and deployment hosts.

Content Save and website deployment are separate operations. Local Save writes files without committing them. GitHub Save writes the configured editing branch; publishing follows the configured branch workflow and hosting pipeline.
