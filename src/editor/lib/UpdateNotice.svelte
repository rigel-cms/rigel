<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import { releaseNotesUrl } from "./updates";

  let { version, ondismiss }: { version: string; ondismiss: () => void } = $props();
</script>

<div class="update-notice" role="status">
  <div>
    <strong>{$t("shell.updateAvailable", { version })}</strong>
    <p>{$t("shell.updateInstructions")}</p>
    <a href={releaseNotesUrl} target="_blank" rel="noopener noreferrer">{$t("shell.updateReleaseNotes")}</a>
  </div>
  <button type="button" class="icon-btn" aria-label={$t("shell.dismissUpdate")} onclick={ondismiss}><Icon name="x" size={16} /></button>
</div>

<style>
  .update-notice { display: flex; align-items: start; gap: 1rem; margin-top: 2rem; padding: 1rem; border: 1px solid var(--border); background: var(--panel); color: var(--text-2); font-size: 0.875rem; text-align: left; overflow-wrap: anywhere; }
  .update-notice > div { min-width: 0; }
  .update-notice strong { color: var(--text); font-weight: 500; }
  .update-notice p { margin: 0.5rem 0; font-size: inherit; line-height: 1.5; }
  .update-notice a { color: var(--text); text-underline-offset: 3px; }
  .update-notice button { flex-shrink: 0; }
</style>
