<script lang="ts">
  import { t } from "../i18n";
  let { onclose }: { onclose: () => void } = $props();

  const rows: [string, string][] = $derived([
    [$t("shell.search"), $t("shell.searchShortcut")],
    [$t("shell.closeDialog"), $t("shell.escapeKey")],
  ]);
</script>

<div
  class="rigel-modal-backdrop rigel"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => e.key === "Escape" && onclose()}
>
  <div class="rigel-modal" role="dialog" aria-label={$t("shell.keyboardShortcuts")} onclick={(e) => e.stopPropagation()}>
    <h2>{$t("shell.keyboardShortcuts")}</h2>
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
</div>
