<script lang="ts">
  import { t } from "../i18n";
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
    <div class="publish-head"><h2 id="publish-title">{$t("connection.publishTitle")}</h2><button type="button" class="icon-btn" aria-label={$t("connection.closePublishReview")} disabled={busy} onclick={onclose}><Icon name="x" size={16} /></button></div>
    <p id="publish-description">{#each $t("connection.publishDescription", { scope: "{scope}" }).split("{scope}") as part, index}{#if index}<strong>{$t("connection.publishScope")}</strong>{/if}{part}{/each}</p>
    {#if loading}<p role="status">{$t("connection.loadingReview")}</p>{/if}
    {#if review}
      <p><strong>{review.repo}</strong><br />{#each $t("connection.publishBranches", { branch: "{branch}", publishBranch: "{publishBranch}" }).split(/(\{branch\}|\{publishBranch\})/) as part}{#if part === "{branch}"}<span class="publish-branch">{review.branch}</span>{:else if part === "{publishBranch}"}<span class="publish-branch">{review.publishBranch}</span>{:else}{part}{/if}{/each}</p>
      {#if review.needsSync}
        <p>{$t("connection.syncDescription")}</p>
        <p>{$t("connection.treeDifferences")}</p>
      {/if}
      <p id="publish-file-count"><strong>{$t("connection.fileCount", { count: review.files.length })}</strong></p>
      {#if review.files.length}
        <ul class="publish-files" tabindex="0" aria-label={$t("connection.allChangedFiles")} aria-describedby="publish-file-count">
          {#each review.files as file (file.filename)}
            <li><span class="publish-file-status">{$t(`connection.fileStatus.${file.status}`)}</span><span>{file.filename}{#if file.previous_filename}<small>{$t("connection.previousFilename", { filename: file.previous_filename })}</small>{/if}</span></li>
          {/each}
        </ul>
      {:else}<p>{$t("connection.noSavedChanges")}</p>{/if}
      <p class="hint">{$t("connection.publishSafety")}</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <div class="publish-actions">
      <button type="button" bind:this={cancel} class="outlined" disabled={busy} onclick={onclose}>{message ? $t("connection.close") : $t("connection.cancel")}</button>
      {#if !message}<button type="button" class="outlined" disabled={loading || busy} onclick={onrefresh}>{$t("connection.reviewAgain")}</button>{/if}
      {#if review && !message}<button id="confirm-publish" type="submit" class="primary" disabled={loading || busy || !review.files.length}>{busy ? $t("connection.working") : review.needsSync ? $t("connection.syncDraftsFirst") : $t("connection.confirmPublish")}</button>{/if}
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
