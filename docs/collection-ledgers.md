# Content metadata ledgers

Article collections and schema document folders can contain a rebuildable `.rigel-collection.json`. Source JSON files remain authoritative. Both use version `1`, a configuration fingerprint and sorted entries containing a storage slug, exact Git blob SHA and `frontmatter` metadata. Paths always come from the configured folder and storage filename, not an editable URL slug.

Article entries contain frontmatter, never article bodies. Document entries contain identity, route slug, title/name, draft status, scalar list columns and flattened reference identities in `_references`. Markdown, code and password columns are excluded; display strings are limited to 1,024 characters. The document fingerprint covers the document definition and schema objects. Metadata is not an editable document.

## Scoped loading and search

The GitHub welcome screen verifies access, reads the current branch/tree, enumerates complete storage identities and reads existing article ledgers. It reads no copy modules, document bodies or menu bodies. Document ledgers are read only when their group is requested.

Pages defaults to the uncategorized Core group in the selected content language. Choosing a category, a document-type list or another language loads metadata only for that group. Choosing All pages explicitly requests all non-shared groups in that language. A matching ledger makes the list available without source-body downloads. New, changed or missing metadata is reconciled progressively, only within the requested group. Identity rows remain usable while titles arrive, with partial-result progress, cancellation on navigation and retry on errors. Read-only reconciliation never creates remote ledgers.

Selecting a document reads its exact file and recursively reads only its actual reference dependency closure. Selecting a menu reads only that menu; the menus list can use storage names without opening menu files. Selecting a legacy copy page reads only that copy module. Forms and draft tools remain blocked until the selected source and required dependency closure validate. Complete tree identities support reference existence checks even when unrelated bodies have not loaded.

Search and WebMCP discovery do not start body reconciliation. They use storage identities and currently loaded metadata; Search states this scope explicitly. Titles may be unavailable until their group opens. WebMCP reports metadata completeness separately and selects through the same guarded loading/navigation path. Neither is full-text body search.

## Transport and file cache

Only requested, uncached text blobs enter read-only GraphQL queries. Immutable SHA aliases are coalesced in a short bounded window, with at most 64 aliases and an estimated 2 MiB per query, at most four active transport requests, and a bounded response. Reconciliation progresses in four-file windows. References are discovered from selected source files, not guessed from every schema type.

Each GraphQL alias must identify the expected SHA, contain complete text and hash to that Git blob SHA. Missing, per-alias failed, oversized, truncated or invalid-hash aliases fall back individually to the REST blob API; successful aliases are retained. Authentication, rate-limit and request-wide failures stop rather than fanning out REST retries. GraphQL uses POST with a `query`, never a mutation. Git writes retain the existing REST Git-tree/commit protocol.

A native IndexedDB cache (`rigelcms-files`, version 1) stores text by hashed verified account, repository/branch/schema configuration and immutable blob SHA. It is limited to 128 entries and 16 MiB, with a bounded memory fallback when storage is unavailable, blocked or full. Every cached text is checked against its Git blob SHA before use. A reload still verifies access and reads the current branch/tree. No credentials enter cache keys or values. The old localStorage text cache is removed, not migrated. A tiny localStorage clear-intent marker can remain while IndexedDB is blocked; it contains no content or identity.

Clear File Cache invalidates generations immediately, clears memory, IndexedDB text, image blobs and preview URLs, and prevents late reads from repopulating an earlier generation. Drafts, editor state, settings and sessions remain. A clear failure is reported; a pending clear is retried before later persistent reads. Sign-out and account changes purge persistent content. Reauthorization of the same account retains the original conflict head and unsaved draft.

## Saving and rebuilding

Document and article Save/create/delete commit the selected source change and its affected metadata ledger in one Git tree and one non-forced draft commit. Saving a route reconciles complete route metadata where needed before uniqueness checks; deletion reconciles document and article reference metadata before checking referrers. These explicit mutations can require metadata reads outside the visible group. Missing ledgers may require source reads for those validation indexes. Neither route nor deletion checks assume partial metadata is complete. Branch conflicts reject the write; uncertain commits retain verification intent for retry.

**Settings → Advanced → Maintenance → Reindex all content** explicitly reconstructs document and article ledgers. GitHub validates all affected metadata against the loaded tree and commits only ledger files in a single atomic draft commit. It does not publish or modify source content. Cancellation before the commit leaves no partial ledger commits; an uncertain commit still needs retry verification. Individual source JSON is limited to 1 MiB and ledger JSON to 16 MiB.

Maintenance retains a general message and loading line by default, with a static line for reduced motion. Developer mode adds collection identifiers and counts. Completion and errors remain visible in either mode.

## Local and demo modes

Local Vite/filesystem internals still eagerly read and validate content; the scoped network behavior above is specific to the GitHub editor. Local maintenance rebuilds document and article ledgers, and the content readers exclude hidden ledger files. Local file replacements are atomic individually, not a transaction across multiple files. Local document saves do not update these derived ledgers automatically; later GitHub access detects changed source SHAs and reconciles them read-only, or explicit maintenance rebuilds them. Demo mode cannot write or reindex.

## Verification

Run `pnpm test`, `pnpm typecheck` and `pnpm build`. With a local development editor running, `RIGEL_URL=http://127.0.0.1:4322/rigel/ node tests/collection-ledger-browser.mjs` exercises article behavior with fixture-only GitHub/auth transport and an explicitly unsupported GraphQL endpoint, covering bounded REST fallback. It never writes to a live GitHub repository. Native GraphQL, scoped documents, persistent-cache behavior and mutation safety also have runnable unit tests.
