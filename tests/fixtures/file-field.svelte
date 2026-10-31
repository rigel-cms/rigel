<script>
  import SchemaField from '../../src/editor/lib/SchemaField.svelte';
  import ImagePicker from '../../src/editor/lib/ImagePicker.svelte';
  import { patchPreview } from '../../src/preview';
  const field = { key: 'csv', label: 'CSV document', type: 'file', accept: '.csv', required: true };
  const schema = { documents: [], objects: [] };
  let value = $state('/rigel-media/original.csv');
  let saved = $state(value);
  let frame = $state();
  function preview() { if (frame?.contentDocument) patchPreview(frame.contentDocument, { csv: value }, ''); }
  $effect(() => { value; preview(); });
</script>
<div class="rigel" id="file-field">
  <SchemaField {schema} {field} {value} base="csv" documents={[]} onvalue={next => value = next} />
  <button id="save" onclick={() => saved = value}>Save</button>
  <output id="draft">{value}</output><output id="saved">{saved}</output>
  <iframe title="Preview" bind:this={frame} srcdoc={'<a data-rigel-href="csv" href="/rigel-media/original.csv">Download file</a>'}></iframe>
</div>
<div class="rigel" id="image-field"><ImagePicker /></div>
<div class="rigel" id="video-field"><ImagePicker kind="video" /></div>
