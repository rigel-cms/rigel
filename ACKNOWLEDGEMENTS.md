# Acknowledgements

Rigel CMS uses the following open-source packages. License identifiers below come from the installed packages' metadata. Each project retains its own copyright and license terms.

| Direct dependency or peer dependency | License |
| --- | --- |
| Astro (`astro`) | MIT |
| Svelte (`svelte`) | MIT |
| Vite (`vite`) | MIT |
| Svelte Vite plugin (`@sveltejs/vite-plugin-svelte`) | MIT |
| Lexical (`lexical`, `@lexical/code`, `@lexical/history`, `@lexical/link`, `@lexical/list`, `@lexical/rich-text`, `@lexical/table`) | MIT |
| DOMPurify (`dompurify`) | MPL-2.0 OR Apache-2.0 |
| markdown-it (`markdown-it`) | MIT |
| HEIC decoder (`@discourse/heic`) | Apache-2.0 |
| ProseMirror (`prosemirror-commands`, `prosemirror-example-setup`, `prosemirror-markdown`, `prosemirror-model`, `prosemirror-schema-list`, `prosemirror-state`, `prosemirror-view`) | MIT |

Rigel also uses [Phosphor Icons](https://github.com/phosphor-icons/core), licensed under MIT, in `src/editor/lib/icons.ts`.

The lazy HEIC decoder is distributed by [Discourse’s jSquash fork](https://github.com/discourse/jSquash). Its WebAssembly codec uses [libheif](https://github.com/strukturag/libheif) and [libde265](https://github.com/strukturag/libde265), which retain their LGPL license terms. Decoder source and build instructions are available in that upstream repository. Browser regression fixtures are downloaded from their original upstream sources into the ignored test workspace, not included in the published package.

Thank you to these projects and their contributors.
