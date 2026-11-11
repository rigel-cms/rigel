<script>
  import Settings from '../../src/editor/lib/Settings.svelte';
  import ImagePicker from '../../src/editor/lib/ImagePicker.svelte';
  import { getSettings, setSettings } from '../../src/editor/lib/settings';
  let s = $state(getSettings());
  let showSettings = $state(true);
  $effect(() => setSettings(s));
</script>
<div class="rigel"><ImagePicker inline /></div>
{#if showSettings}<Settings bind:s error="" saving={false} onerase={() => {}} onclose={() => showSettings = false} />{/if}
