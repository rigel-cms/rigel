<script lang="ts">
  let { onclose }: { onclose: () => void } = $props();

  const rows: [string, string][] = [
    ["Search", "⌘/Ctrl + K"],
    ["Close dialog", "Esc"],
  ];
</script>

<div
  class="rigel-modal-backdrop rigel"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => e.key === "Escape" && onclose()}
>
  <div class="rigel-modal" role="dialog" aria-label="Keyboard shortcuts" onclick={(e) => e.stopPropagation()}>
    <h2>Keyboard shortcuts</h2>
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
