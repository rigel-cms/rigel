# Media

Media browses supported files in the site's public media folder. Files already in that folder appear alongside uploads made through Rigel. The library is shared content, not a private file store.

## Configure storage

Set these options in the [Astro integration](getting-started.md):

```ts
rigel({
  mediaDir: "images",
  maxFileSize: 2 * 1024 * 1024,
})
```

`mediaDir` is relative to Astro's `publicDir` and defaults to `rigel-media`. Traversal paths are rejected. `maxFileSize` is a positive integer in bytes; the default is 2 MiB, displayed as 2 MB in the interface. Both the browser and local upload endpoint enforce the limit, including streamed requests without a reliable Content-Length.

The local development server supports uploading, metadata updates and file deletion. A static build emits `/rigel/media.json` as a read-only snapshot. Its `assets` array contains all supported files; `images` contains images only. Rebuild to refresh the snapshot. GitHub-backed content editing does not provide GitHub media writes; repository imports need the local server. See [GitHub](github.md) for content Save and Publish behavior.

## Supported files

The library reads subfolders recursively, skips hidden files and symlinks, and accepts these six categories:

| Category | Extensions |
| --- | --- |
| Images | jpg, jpeg, png, webp, gif, avif |
| Audio | mp3, wav, ogg, m4a |
| Video | mp4, webm, mov |
| Documents | txt, pdf, doc, docx, rtf, odt, ppt, pptx |
| Spreadsheets | xls, xlsx, csv, ods |
| Archives | zip, gz, tar, 7z, rar |

SVG, HTML, scripts, executables and unknown extensions are outside the upload allowlist. An Other filter is present for unclassified listing entries; it does not enable additional upload formats. Image fields and rich-text image pickers accept images only. File fields can narrow their choices with `accept`; video pickers use the supported video formats. See the [content model](content-model.md).

## Browse and upload

Use Grid or List view, search, category and modified-month filters. Filters combine; Reset filters clears them. Refresh rereads the listing. Dates come from filesystem modification time in UTC, not an upload history. A checkout can change them. Missing date metadata does not match a specific month.

Images have thumbnails, videos have playback previews, and PDF and text files have document previews. Other files show a type icon and metadata with a download link. Previewing a file is not a safety check.

Open Upload to choose a local file, an image URL, Lorem Picsum or an enabled stock provider. Choose a result, review its preview and confirm. Back changes the selection; cancelling before confirmation leaves content unchanged. Confirmation writes imported bytes immediately, separately from saving the document. Cancelling a later document edit does not remove an uploaded file.

The library's Delete file action removes the file and its metadata after confirmation. Check its uses first: deleting an asset can break existing content links.

## Labels and metadata

Metadata lives in `.rigel-media.json` inside the configured media folder, keyed by public asset URL. Each entry can contain `name`, `title`, `description`, image `alt` and `author`. The listing merges these values into its asset records. Treat the sidecar and listing as public data.

New uploads use random UUID filenames.

On the local backend, open an asset in Media, edit its display name, title, description or image alt text, then press Save. Metadata writes validate the listed asset URL, reject unknown fields and use an atomic sidecar replacement. Display names allow safe filename-like characters up to 120 characters without requiring an extension. Titles are capped at 200 characters; descriptions and alt text at 1,000. Nonimages cannot receive alt metadata.

Local file uploads send a browser-supplied author label through `X-Rigel-Author`. Rigel uses the browser identity's name or nickname, falling back to `Local user`. This is a descriptive label, not verified ownership or an audit identity. The metadata editor cannot change it. Existing files and URL or stock imports may have no captured author; the interface displays `Local user` as a fallback.

For rich-text image insertion, saved repository-image alt text supplies a default that you can override per use, or leave empty for a decorative image. Image fields store the URL; declare and render a separate alt field where your site needs one. Rigel does not rewrite alt text already stored in content. Rich-text insertions remain unsaved until the document's Save action.

## Image URLs and stock providers

Image pickers offer Library, Upload, URL and Lorem Picsum. Pexels, Pixabay and Unsplash appear when their keys are configured in Settings under Media. Repository Upload excludes Unsplash.

Remote URL, Picsum, Pexels and Pixabay image imports download bytes through the browser and upload them locally. In a content picker, a root-relative URL can be used directly without making a copy. Remote image downloads require HTTPS and browser CORS permission. The import path accepts JPEG, PNG and WebP responses within the configured size limit. Download failures stay visible. The server accepts validated bytes rather than fetching arbitrary remote URLs.

Unsplash selections keep the provider's hotlink and record the download through its API. They do not become repository files. Rich-text stock insertions retain credit links; check the provider's current licensing and [Unsplash hotlinking requirements](https://unsplash.com/documentation#hotlinking) for your use.

Provider keys live in browser storage and requests go directly to the provider. They are visible to scripts on the same origin and in browser network tools. Use credentials intended for browser clients, restrict them where supported, and keep the CMS origin trusted. For Unsplash, use an Access Key, never a Secret Key. Browser storage is not a place for server credentials.

## Upload and hosting safety

The local upload endpoint requires a matching request origin and is disabled in production. It validates safe filenames, canonical MIME types, size and file signatures, then writes a new file without overwriting an existing asset. Metadata updates and deletion also require same-origin requests and listed asset URLs.

Signature and container checks are not full decoding or malware scanning. Rigel does not extract archives. Office documents and PDFs can contain active content, so upload and download only files you trust.

The local media handler sets a canonical Content-Type and `X-Content-Type-Options: nosniff`. Images and videos can be inline; PDF and text previews can also be inline, while other downloads use attachment disposition. Configure equivalent headers on the production host: a static build cannot enforce response headers. Exclusion from the CMS listing does not make a file under `publicDir` private. Keep secrets and untrusted files outside it.

See [preview hosts](preview-hosts.md) for host setup, [SEO](seo.md) for image metadata used by the site, and the [documentation index](README.md) for the other guides.
