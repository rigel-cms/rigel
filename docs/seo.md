# SEO

Rigel provides metadata fields for website pages and article collections. Your Astro templates must put those values into the public page's `<head>`; adding a CMS field alone does not change the rendered site.

See [Content model](content-model.md) for native documents and [Preview](preview.md) for canvas bindings. The [documentation index](README.md) lists the other guides.

## Use the native fields

The integration adds missing declarations for these top-level keys to non-shared schema document types and article collections:

| Key | Type | Editor label |
| --- | --- | --- |
| `metaTitle` | `string` | SEO title |
| `description` | `text` | SEO description |
| `ogImage` | `image` | Social image |

Existing declarations with the same key are retained rather than duplicated, and configuration parsing does not rewrite saved content. Keep the native key/type shape if you declare these fields yourself. Shared records, such as authors or site settings, do not receive the automatic SEO fields. Legacy copy fields need their own declarations and host rendering.

For schema pages, values live directly in the document JSON. For article collections, they live in the file's `frontmatter` object alongside the article's other fields; the separate `body` stores Lexical state. `ogImage` is a URL string, not an image object. A page's relevant values might look like this JSON excerpt:

```json
{
  "title": "About",
  "metaTitle": "About the observatory",
  "description": "Learn about the observatory and its public programme.",
  "ogImage": "/images/observatory-social.jpg",
  "draft": false
}
```

The website page and article properties panels separate Content and SEO. Page name (`title`) identifies the CMS entry; it is independent of headings inside sections and of `metaTitle`. Editing the name does not change the URL slug. Keep article title, social image and body/section images separate too. SEO fields are excluded from default table columns unless explicitly requested.

## Render the head

This complete minimal Astro layout accepts page or article metadata. Pass the appropriate saved values from your route; it does not load content itself:

```astro
---
interface Props {
  title: string;
  metaTitle?: string;
  description?: string;
  ogImage?: string;
}
const { title, metaTitle, description, ogImage } = Astro.props;
const headTitle = metaTitle?.trim() || title;
const headDescription = description?.trim() || "Notes from the observatory.";
const imageUrl = ogImage?.trim()
  ? new URL(ogImage.trim(), Astro.site ?? Astro.url)
  : undefined;
const socialImage = imageUrl && ["https:", "http:"].includes(imageUrl.protocol)
  ? imageUrl.href
  : undefined;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{headTitle}</title>
    <meta name="description" content={headDescription} />
    {socialImage && <>
      <meta property="og:image" content={socialImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content={socialImage} />
    </>}
  </head>
  <body><slot /></body>
</html>
```

Set Astro's `site` to your real public base URL so relative image paths produce production URLs; this example falls back to `Astro.url` whenever `site` is unset, including production builds. Choose your own description fallback, title suffix and document language. The starter uses its shared Site settings for the default description and site-name suffix, rather than a fixed product name.

Canonical links, social title/description tags, structured data, sitemaps and language alternates remain host-template work. The example emits only the tags shown. Check the built HTML, including absolute image URLs and empty-image behavior, rather than treating the editor canvas as proof that public metadata is correct.

## Read the guidance

SEO title and description show live character counts and length meters. Titles target 50 to 60 characters; descriptions target 120 to 160. Empty values are neutral, short values approach the target in yellow, the recommended range is green, and very short or over-target values are red. These are editing hints, not ranking scores or hard limits. Values remain editable and saveable outside the suggested range. Host-added title suffixes are not counted, and actual snippets vary by query, device and available width.

Social image uses the native [media picker](media.md) and supports removal. Its preview uses a centered 1200 × 628 crop within the sidebar. That display does not resize or crop the stored image bytes. Supply an image suitable for social sharing rather than assuming a page-section or article-cover image will be used automatically.

## Keep drafts out of public builds

Non-shared schema document types receive a `draft` boolean declaration if they lack one. Article collections declare their own Draft field. A saved Draft badge is content state, not an access-control rule or deployment result.

The starter's page and article routes filter drafts from production output while retaining routes in development. Your host must implement that filtering in its own routes and feeds, and decide which routes a deployed draft host emits. Public static files are readable by anyone who can reach their URLs, even if omitted from navigation.

SEO edits and Draft changes stay in memory until explicit Save. Saving and publishing depend on the configured backend; see [GitHub](github.md). Preview host selection is separate from a record's Draft value; see [Preview hosts](preview-hosts.md).
