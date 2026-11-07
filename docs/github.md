# GitHub connection and publishing

Rigel's GitHub backend reads content from a workspace branch and commits changes when an editor chooses Save. Publishing is a separate action: review the saved changes, then confirm a pull request squash merge into the publishing branch. Your hosting provider builds and deploys the result.

For installation and a first local edit, start with [Getting started](getting-started.md). For branch builds and preview URLs, see [Preview hosts](preview-hosts.md).

## Configure the site

Keep your site's schema, collections, menus and preview settings when switching backends. A root-level Astro project can use this configuration:

```js
import { defineConfig } from "astro/config";
import { rigel } from "@rigel-cms/rigel";

export default defineConfig({
  integrations: [
    rigel({
      backend: "github",
      repo: "example-org/website",
      branch: "drafts",
      publishBranch: "main",
      repoRoot: "",
      authOrigin: "https://auth.rigelcms.dev",
      appSlug: "rigel-cms",
    }),
  ],
});
```

Replace `example-org/website` with the repository containing your site's content. The example shows the default branch, path and authentication settings explicitly; only `backend` and `repo` are required to select this backend.

| Option | Meaning |
| --- | --- |
| `repo` | GitHub repository in `owner/name` form, not a URL. |
| `branch` | Editor workspace branch, default `drafts`. Use a dedicated branch; the remote backend rejects `main` and `master` as workspaces. |
| `publishBranch` | Destination for publishing, default `main`. Set it to `master` or another branch if that is what your production host builds. It must differ from `branch` and already exist. |
| `repoRoot` | Astro project folder relative to the repository root. Use `""` for a root-level project or, for example, `"sites/website"` for a subfolder. Content folders remain relative to the Astro project. |
| `authOrigin` | Authentication gateway origin. The default uses the public Rigel gateway. Custom values must be HTTPS origins without paths, credentials, queries or fragments; HTTP is allowed on loopback. |
| `appSlug` | GitHub App slug, default `rigel-cms`. Override it together with the gateway only when using your own compatible authenticator. |

The default connection uses the [public Rigel CMS GitHub App](https://github.com/apps/rigel-cms). Site developers and editors do not need to deploy a gateway or create an App. The gateway handles the OAuth exchange; the editor uses the resulting GitHub App user token to call GitHub. App secrets belong on the authenticator, never in site configuration.

## Prepare repository access

An editor needs write access to the configured repository. The GitHub App must be installed for that repository, active, and granted Contents read/write permission. Authorizing a GitHub identity alone does not grant editing access.

Publishing also needs Pull requests read/write permission. The connection check verifies Contents write and the user's repository write access; a successful connection does not prove that publishing permissions are available. If an installation needs updated permissions, its owner must approve them, then the editor must reconnect.

For in-editor publishing, enable squash merging and disable automatic head-branch deletion in the repository settings. Rigel checks both settings during review and confirmation so that the workspace survives a publish. It does not change these settings for you.

## Sign in and install the App

- Open `/rigel/` and choose **Sign in with GitHub**. Allow the sign-in popup and approve only an editor origin you trust.
- Complete GitHub authorization. Rigel checks the configured App's installations, selected repositories, Contents permission and your repository write access before loading the editor.
- If access is missing, choose **Install / configure GitHub access**. GitHub opens its account or organization and repository picker in a separate tab. Choose **Only select repositories** and include your content repository. An organization owner may need to approve the installation.
- Return to the editor tab and choose **Check repository access**. Installing the App does not automatically reconnect the editor tab.

For local testing with the public gateway, use `http://localhost`. Use HTTPS for a deployed editor.

Repository selection limits the App's access, not the token to one editor. A GitHub App user token can access repositories available to both the user and the App. Treat the editor origin as trusted code.

The editor stores the short-lived session in `localStorage`, scoped to the gateway, repository, workspace branch and App slug. Reloading can restore an unexpired session, after which Rigel checks access again. This storage is accessible to scripts on the same origin; deploy the editor on an origin you control and trust. The login handshake checks the popup, gateway origin and a fresh nonce before accepting a token.

Expired or revoked access blocks writes. **Reconnect GitHub** checks access again while keeping the current draft. **Sign out** uses the unsaved-changes guard and clears the editor session; it does not revoke the App's authorization in GitHub or clear the gateway's HttpOnly cookie. Manage GitHub grants in your GitHub settings.

## Load content and save drafts

After access verification, Rigel loads content from the current workspace branch, rather than using build-time content values. If the workspace does not exist, this initial load creates it from `publishBranch`. Signing in and connecting can therefore create a branch before the first Save. An existing workspace is never reset or force-pushed.

The welcome screen reads tree identities and existing article metadata ledgers, without downloading copy modules, schema-document bodies or menus. Opening a document type/category/language loads only that group's SHA-checked metadata; missing metadata is reconciled progressively within that group. Selecting a document reads only its file and actual reference dependency closure. Menus and copy pages hydrate individually. Search and WebMCP discovery use storage identities and loaded metadata without silently fetching bodies. See [content metadata ledgers](collection-ledgers.md) for scope, validation and explicit all-content rebuilding.

Requested uncached text blobs are coalesced into bounded read-only GitHub GraphQL queries. Complete, SHA-validated aliases are retained; individual missing/truncated aliases fall back to REST. Authorization and rate-limit errors stop retries. Text persists in native IndexedDB (`rigelcms-files`), keyed by hashed verified account, repository, workspace branch, schema/configuration and immutable blob SHA, with 128-entry/16 MiB bounds and a memory fallback. Reload still verifies access and the current branch/tree. Cache bytes are checked against their Git blob SHA. No credentials are stored, but private content remains accessible to trusted scripts on the editor origin. The old localStorage text cache is removed. Blocked storage, quota failures and schema-version conflicts must not prevent editing.

**Settings → Advanced → Clear File Cache** removes managed file copies, repository image bytes and temporary preview URLs, including pending reads. It does not erase unsaved drafts, settings, provider keys, sign-in or repository files. An empty cache disables the button; the next content access downloads files again. Sign-out, session invalidation and verified account changes purge the persistent file cache. Reconnecting the same verified account preserves the loaded conflict revision and unsaved draft.

Content edits stay in memory until you choose **Save**, including the **Save and leave** option in the unsaved-changes dialog. Each Save commits the selected copy page, schema document, article or menu to the workspace. Changing a field does not autosave, and Save does not publish.

Rigel validates content and builds each write from the loaded branch revision, then advances the workspace with a non-force update and verifies the result. If another writer advances the branch, the stale write is rejected rather than replacing their work. This also protects against two editors claiming the same URL slug in different files. Preserve your unsaved edits before reloading after a conflict.

If the connection fails after a write may have completed, retrying Save verifies the pending commit and content before attempting another change. A conflict or failed verification leaves the draft available in the editor.

Legacy copy modules must use data-only `defineCopy({ ... })` literals. Computed values, spreads, functions and template literals are rejected instead of executed. Schema documents, articles and menus keep their JSON formats and validation.

## Review and publish

- Save your edits. If inputs are still unsaved, Publish explains that you must save first; it neither saves nor discards them.
- Choose **Publish** to open the review. This stage only reads GitHub; it does not create a PR or merge anything.
- Check the repository, both branches and the complete changed-file list. The review covers the entire repository, including files outside CMS folders and `repoRoot`. It is a file/status review, not a line-by-line diff. Inspect the diff on GitHub if you need that detail.
- Choose **Confirm publish**. Rigel finds an open PR for the exact repository and branch pair, or creates one. It stops if multiple matching PRs exist. It then attempts a normal synchronous squash merge pinned to the reviewed workspace commit.
- Wait for confirmation. Rigel reports publishing success only after reading back that exact PR as merged and closed, with the expected source, destination and a valid merge commit SHA.

Canceling a review makes no changes. Identical branch trees mean there is nothing to publish, even if Git history says the workspace is ahead. Rigel rejects truncated trees, incomplete comparisons and reviews containing 300 or more changed-file entries instead of showing a partial list. A rename can appear as one entry with its previous filename.

If a merge response is lost, Rigel checks the existing PR. If it cannot verify the outcome, it reports an unconfirmed result rather than claiming success. Retrying confirmation checks the same PR before attempting another merge. Check that PR on GitHub if the outcome remains uncertain.

### Publish again after a squash merge

Squash merging retains the workspace but gives the destination a different commit history. When the branches have new differences and the publishing revision is no longer an ancestor of the workspace, the review shows provisional net tree differences and offers **Sync drafts first** instead of Confirm publish.

That explicit action creates or reuses the matching PR and asks GitHub to update its source branch from the publishing branch, with the reviewed workspace SHA as the expected head. GitHub merges into the workspace without resetting its history. This step does not publish.

After a verified sync, Rigel reloads draft content. Open a fresh review and separately confirm publishing. If GitHub has not finished its asynchronous update when Rigel checks, wait, reload draft content and review again. Resolve sync conflicts or protection failures on GitHub. You do not need to reset or delete the workspace between publishes.

### Checks, approvals and concurrent changes

Required approvals, status checks and branch protections still apply. Rigel merges only an open, non-draft PR that GitHub reports as mergeable with a `clean` merge state. If approvals or checks block it, complete them on GitHub, then retry or review again if the branches changed. Merge queues or other repository policies may require completing the merge on GitHub. Rigel does not bypass those policies or schedule an automatic merge after checks finish.

Before mutation, Rigel rechecks the reviewed branch revisions and the PR's source and destination. Observed changes invalidate the review. Save, deletion and publishing also have in-process overlap guards; these are not locks across other tabs or GitHub clients.

The merge API pins the source SHA, but has no expected destination SHA or atomic PR-target lock. A destination advance, PR retarget or settings change after the last check can still race the merge. GitHub's merge/conflict/protection rules apply, and Rigel never force-overwrites the destination. The final PR readback checks the target before reporting success, but it cannot make that operation atomic. Signing out prevents subsequent publishing requests; it cannot recall a request already sent.

## Deployment and public data

A confirmed publish means the PR merged into `publishBranch`, not that your site deployed successfully. Connect that branch to your host's production build, configure a workspace branch build for draft previews if needed, and inspect build/deployment results on the host. Rigel does not configure branch builds or verify deployment completion. See [Preview hosts](preview-hosts.md) for that setup.

In GitHub mode, the public editor manifest includes schemas and configuration rather than build-time document, article, menu or copy values. Schemas and initial values are still public configuration; keep credentials out of them. Your website templates decide which content reaches public pages.

## Media in the repository

The media library reads the authenticated workspace branch, including files uploaded since the last site build. Uploads and downloaded image imports go into Astro's public directory under `mediaDir` (default `rigel-media`), relative to `repoRoot`. Rigel creates the folder and its `.rigel-media.json` metadata file on the first upload. Each upload commits the file and metadata together. Media metadata saves and confirmed deletions also commit immediately; they do not save an open article or publish the site.

The editor previews and downloads repository files through authenticated GitHub requests, including private repositories and assets that your host has not built yet. Temporary preview URLs stay in the browser and are released when their views close or the session changes. Stored content keeps the normal public media path. Modified dates are absent when GitHub supplies no file history.

Contents read/write permission covers media as well as content. You do not need another Worker, upload server or storage account. The existing file types and `maxFileSize` limit apply. Unsplash selections remain hotlinks under Unsplash's provider rules; other supported stock-photo imports are downloaded into the repository after confirmation. Use Publish separately to include saved media changes in the public site build.
