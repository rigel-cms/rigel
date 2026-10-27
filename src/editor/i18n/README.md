# Editor translations

English source messages live in `en/*.json`, grouped by editor area. Keys stay namespaced and stable. UI components use `$t(key, parameters)`; TypeScript event handlers use `translate(key, parameters)`.

Rigel includes English and French by default and starts in English. Set `languages` in the Astro integration to choose additional interface languages:

```ts
rigel({ languages: ["es"] })
```

This includes English and Spanish, not French. English is always included as the default and fallback. Use `languages: []` for English only. Only included languages appear in Settings → Language; excluded catalogs stay out of the generated client and server bundles. A saved preference for an excluded language returns to English.

Supported codes are `en`, `fr`, `es`, `ru`, `zh`, `ja`, `it`, `de` and `nl`. `zh` is Simplified Chinese. Russian includes `.few` and `.many` plural forms; Chinese and Japanese use `.other` for every count.

Keep translated filenames and keys aligned with the English source. Translate values only; missing messages fall back to English. Do not ship English copies as finished translations. Restart the development server after adding a new locale directory if it still shows the old language list.

Keep placeholders such as `{name}` and `{count}` intact. Translate whole sentences, not fragments. Counted messages use `.one` and `.other` suffixes; languages can also provide `.few`, `.many`, `.zero` and `.two`. Native `Intl.PluralRules` selects the form from the numeric `count` parameter.

Site content, developer-defined schema labels, JSON keys, URLs and Git identifiers are not interface translations. Shared manifest helpers accept an optional translator and otherwise use English without importing browser state.

Built-in fields carry a `labelKey`; explicit site labels stay unchanged. Local editor requests send the chosen interface language in `Accept-Language`. Each API request resolves its own translator, so validation errors do not share mutable language state. Developer configuration diagnostics and protocol identifiers remain technical text.

Run `pnpm test`, `pnpm typecheck` and `pnpm build`. Catalog checks reject missing static message keys, duplicate keys and untranslated literal template text.
