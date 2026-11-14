<script>
  import { resetMediaPreviews, refreshMediaPreviews } from '../../src/editor/lib/media-backend';
  import ImagePicker from '../../src/editor/lib/ImagePicker.svelte';
  import Toaster from '../../src/editor/lib/Toaster.svelte';
  let mounted = $state(true);
</script>
<div class="rigel"><div class="content" style="flex: 1; min-width: 0"><main class="wide">
  {#if mounted}<ImagePicker inline />{/if}
</main>
  <button data-reset onclick={() => { resetMediaPreviews(); refreshMediaPreviews(); }}>Reset connection</button>
  <button data-unmount onclick={() => mounted = !mounted}>Toggle library</button>
  <div data-picker="image"><ImagePicker /></div>
  <div data-picker="file"><ImagePicker kind="file" /></div>
  <div data-picker="video"><ImagePicker kind="video" /></div>
</div><Toaster /></div>
