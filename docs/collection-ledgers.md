# Collection metadata ledgers

Each article collection can contain a rebuildable `.rigel-collection.json` file. Article JSON files remain the source of truth. The ledger contains version `1`, a configuration fingerprint, and sorted entries with the storage slug, exact Git blob SHA and frontmatter. Paths come from the configured collection folder plus the storage filename, not the editable URL slug. Article bodies never belong in the ledger.

## Loading and search

The GitHub editor reads the draft Git tree and accepts only ledger entries whose SHA matches the current article blob. Removed paths disappear immediately. New or changed paths remain unindexed until the collection opens or Search opens. Rigel then reads missing articles automatically with at most four concurrent blob requests across collections. It shows indexing progress and partial results, with cancellation and retry on failure. Opening content from a direct URL hydrates that article even if its metadata is not indexed yet.

A current ledger lets a collection list and metadata search work without downloading article bodies. Selecting an article fetches its exact blob. Concurrent reads share the request, and reopening reuses a session cache bounded to 64 articles and 16 MiB. Collection Refresh rereads the tree and clears cached article bodies. Sign-out and session invalidation clear them too. Article bodies are not stored in the collection list. Search remains metadata search, not full-text body search.

Missing, invalid JSON, incompatible versions and configuration mismatches trigger read-only reconciliation. Reading never creates or updates a ledger. Symlink/non-file tree entries, incomplete trees and transport failures remain errors rather than being treated as empty collections. Ledger JSON is limited to 16 MiB; individual articles keep the existing 1 MiB limit.

Copy pages, schema documents and menus still load eagerly on GitHub. Their validation and reference graph are available before collection metadata is used. This feature does not make every content type lazy.

## Saving and rebuilding

GitHub article Save, create and delete put the article change and its updated ledger in one Git tree and one non-forced draft commit. URL uniqueness and document-deletion checks wait for complete metadata. Branch conflicts reject the write. An uncertain branch update/readback keeps its pending write for verification on retry. Ledger readback uses Git blobs, including for indexes larger than the Contents API inline limit.

To rebuild explicitly, enable Developer mode in **Settings → Advanced**, then choose **Maintenance → Reindex collections**. Confirm the operation first. GitHub rebuilds against the loaded draft tree and commits only ledger files to the drafts branch, one collection at a time. It does not publish or change article bytes. If another writer moves the draft branch, refresh before retrying. Cancel stops further work; an already verified collection commit remains saved. An interrupted write may need retry verification.

Local mode exposes article metadata in the editor manifest and hydrates bodies through the existing article API on selection. Its session body cache has the same count/byte bounds and is cleared by collection HMR or a reload. The server-side Vite manifest still reads and validates article files from disk; local disk loading is not lazy. Local Save/delete and maintenance use a shared write queue. Each article and ledger file is replaced atomically, but a filesystem operation across both files is not a transaction: an interruption can leave a stale derived ledger, which a rebuild repairs. Maintenance reports each collection separately. Demo mode cannot write or reindex.

The internal manifest loader and reference-deletion scan exclude the hidden ledger. Standard Astro glob loaders exclude dotfiles; no consumer configuration, extra service or Worker is required.

## Verification

Run `pnpm test`, `pnpm typecheck` and `pnpm build`. With a local development editor running, `RIGEL_URL=http://127.0.0.1:4322/rigel/ node tests/collection-ledger-browser.mjs` exercises the real editor with fixture-only GitHub/auth transport. It checks indexed login/listing without article downloads, selection/reopen, atomic article Save, ledger-only maintenance, external edits/deletes/new paths, and corrupt-ledger cancellation/retry. It never writes to a live GitHub repository. To include real local maintenance in that browser run, set `RIGEL_FIXTURE_ROOT` to the development site's root. The fixture verifies unchanged article bytes and restores the original local ledger afterward.
