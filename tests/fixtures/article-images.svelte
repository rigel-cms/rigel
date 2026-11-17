<script>
  import BlockEditor from '../../src/editor/lib/BlockEditor.svelte';
  import { markdownToBody } from '../../src/editor/lib/markdown-blocks';
  let body = $state(markdownToBody('Before\n\nAfter'));
  let revision = $state(0);
  let inline = $state(true);
  let root = $state();
  window.articleFixture = {
    reset(children, mode = true) {
      body = { ...markdownToBody(''), root: { ...markdownToBody('').root, children } };
      inline = mode;
      revision++;
    },
    body: () => JSON.parse(JSON.stringify(body)),
  };
</script>
<div class="rigel" style="display:block;padding:120px 60px;max-width:900px">
  {#key revision}
    {#if inline}<article bind:this={root} style="font:20px/1.6 Georgia"></article>{/if}
    {#if !inline || root}<BlockEditor value={body} editableRoot={inline ? root : undefined} oninput={next => body = next} />{/if}
  {/key}
</div>
<style>
  :global(article > p) { margin: 32px 0; min-height:32px; }
  :global(article img) { max-height:120px; }
</style>
