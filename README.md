# Rigel CMS

A CMS for Astro sites. You edit the text, git keeps the history.

`@rigel-cms/rigel` is a beta package and a work in progress. Expect bugs and breaking changes.

## Collection validation

New collection drafts initialize every configured field, including Rigel's automatic `description`, `metaTitle`, and `ogImage` strings. Existing content is never filled in automatically; unknown properties are preserved and missing optional fields remain allowed.

Rigel validates configured collection field types and `required: true` on load and before local or GitHub saves. Required strings must contain non-whitespace text, required arrays must contain an item, and `false` is a valid required boolean. Dates use real `YYYY-MM-DD` calendar dates; optional dates may be empty. Tags are arrays of strings and references must select configured entries.

Astro content schemas remain the host site's contract: Rigel does not discover or execute them. Align Rigel field types and requiredness with the host schema. For example, Astro's `z.string()` accepts an initialized empty description; `z.string().min(1)` also needs Rigel's `required: true`.

## License

[Apache-2.0](LICENSE). Copyright 2026 [Alex Zappa](https://alex.zappa.dev/) ([FreshJuice](https://freshjuice.dev/)).
