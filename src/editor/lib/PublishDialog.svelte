<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { PublishReview } from "./github-backend";
  let { review, loading, busy, error, message, onrefresh, onconfirm, onclose }: {
    review: PublishReview | null; loading: boolean; busy: boolean; error: string; message: string;
    onrefresh: () => void; onconfirm: () => void; onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let cancel: HTMLButtonElement;
  $effect(() => {
    dialog.showModal();
    cancel.focus();
    return () => dialog.close();
  });
</script>

<dialog bind:this={dialog} class="rigel rigel-modal-backdrop publish-dialog" aria-labelledby="publish-title" aria-describedby="publish-description" oncancel={(event) => { event.preventDefault(); if (!busy) onclose(); }}>
  <form class="rigel-modal" onsubmit={(event) => { event.preventDefault(); onconfirm(); }} aria-busy={loading || busy}>
    <div class="publish-head"><h2 id="publish-title">Publish saved changes</h2><button type="button" class="icon-btn" aria-label="Close publish review" disabled={busy} onclick={onclose}><Icon name="x" size={16} /></button></div>
    <p id="publish-description">Publish includes <strong>all saved changes on the drafts branch</strong>, including files outside CMS content folders. Unsaved edits are never included or saved automatically.</p>
    {#if loading}<p role="status">Loading the complete file review…</p>{/if}
    {#if review}
      <p><strong>{review.repo}</strong><br /><span class="publish-branch">{review.branch}</span> to <span class="publish-branch">{review.publishBranch}</span>, as one squash commit.</p>
      {#if review.needsSync}
        <p>The publishing branch has changes not in drafts, including earlier squash publishes. First, explicitly sync it into drafts using GitHub’s normal merge. This does not publish. Conflicts stop the sync. Then review the updated files again before publishing.</p>
        <p>These are the current tree differences, not the final publish list:</p>
      {/if}
      <p id="publish-file-count"><strong>{review.files.length} {review.files.length === 1 ? "file" : "files"}</strong></p>
      {#if review.files.length}
        <ul class="publish-files" tabindex="0" aria-label="All changed files" aria-describedby="publish-file-count">
          {#each review.files as file (file.filename)}
            <li><span class="publish-file-status">{file.status}</span><span>{file.filename}{#if file.previous_filename}<small>Previously: {file.previous_filename}</small>{/if}</span></li>
          {/each}
        </ul>
      {:else}<p>No saved changes to publish. The branch trees are identical.</p>{/if}
      <p class="hint">Both branch revisions are checked again before publishing. GitHub pins the draft revision, but cannot atomically lock the target revision; a target update in the final instant can still race. Required checks, reviews and branch protections apply.</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <div class="publish-actions">
      <button type="button" bind:this={cancel} class="outlined" disabled={busy} onclick={onclose}>{message ? "Close" : "Cancel"}</button>
      {#if !message}<button type="button" class="outlined" disabled={loading || busy} onclick={onrefresh}>Review again</button>{/if}
      {#if review && !message}<button id="confirm-publish" type="submit" class="primary" disabled={loading || busy || !review.files.length}>{busy ? "Working…" : review.needsSync ? "Sync drafts first" : "Confirm publish"}</button>{/if}
    </div>
  </form>
</dialog>

<style>
  .publish-dialog { box-sizing: border-box; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 1rem; border: none; color: var(--text); }
  .publish-dialog:not([open]) { display: none; }
  .publish-dialog::backdrop { background: transparent; }
  .publish-dialog .rigel-modal { box-sizing: border-box; width: min(42rem, 100%); max-height: calc(100dvh - 2rem); overflow-y: auto; overflow-wrap: anywhere; }
  .publish-head, .publish-actions { display: flex; align-items: center; gap: 0.75rem; }
  .publish-head { justify-content: space-between; }
  .publish-actions { justify-content: flex-end; flex-wrap: wrap; margin-top: 1.5rem; }
  .publish-dialog button { min-height: 44px; }
  .publish-head .icon-btn { min-width: 44px; }
  .publish-branch { font-weight: 600; }
  .publish-files { list-style: none; margin: 0; padding: 0; max-height: min(35dvh, 20rem); overflow-y: auto; border: 1px solid var(--border); }
  .publish-files li { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: 0.75rem; padding: 0.625rem; border-bottom: 1px solid var(--border); font-size: 0.8125rem; }
  .publish-files li:last-child { border-bottom: none; }
  .publish-files small { display: block; margin-top: 0.25rem; }
  .publish-file-status { text-transform: capitalize; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
