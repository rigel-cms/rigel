<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import { shortcutLabel } from "./shortcuts";
  let { onclose }: { onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let closeButton: HTMLButtonElement;

  const rows: [string, string][] = $derived([
    [$t("shell.searchContent"), shortcutLabel("search")],
    [$t("shell.save"), shortcutLabel("save")],
    [$t("shell.shortcutSwitchMode"), shortcutLabel("toggleMode")],
    [$t("shell.shortcutToggleSidebar"), shortcutLabel("toggleSidebar")],
    [$t("richtext.togglePropertiesPanel"), shortcutLabel("toggleProperties")],
    [$t("shell.shortcutHelp"), shortcutLabel("help")],
    [$t("shell.closeDialog"), "Esc"],
  ]);

  $effect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeButton?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="rigel rigel-modal-backdrop shortcuts-dialog"
  aria-labelledby="shortcuts-title"
  oncancel={(event) => { event.preventDefault(); onclose(); }}
  onclick={(event) => { if (event.target === dialog) onclose(); }}
>
  <div class="rigel-modal">
    <div class="media-head">
      <h2 id="shortcuts-title">{$t("shell.keyboardShortcuts")}</h2>
      <button bind:this={closeButton} type="button" class="close" aria-label={$t("shell.closeDialog")} onclick={onclose}><Icon name="x" size={14} weight="bold" /></button>
    </div>
    <table class="keys">
      <tbody>
        {#each rows as [action, key]}
          <tr>
            <td>{action}</td>
            <td><kbd>{key}</kbd></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</dialog>

<style>
  .shortcuts-dialog { box-sizing: border-box; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 1rem; border: none; color: var(--text); }
  .shortcuts-dialog .rigel-modal { box-sizing: border-box; }
  .shortcuts-dialog:not([open]) { display: none; }
  .shortcuts-dialog::backdrop { background: transparent; }

  .keys tbody tr { cursor: default; }
  .keys tbody tr:hover { background: transparent; }
  .keys tbody tr:hover td { color: inherit; }
  .keys td:first-child { padding-right: 1rem; }
  .keys td:last-child { text-align: right; white-space: nowrap; }
</style>
