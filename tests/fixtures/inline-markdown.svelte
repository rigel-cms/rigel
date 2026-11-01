<script>
  import VisualEditor from '../../src/editor/lib/VisualEditor.svelte';
  const docType = { name: 'page', title: 'Page', type: 'document', folder: 'pages', fields: [{ key: 'copy', label: 'Copy', type: 'markdown' }] };
  const schema = { documents: [docType], objects: [] };
  let values = $state({ copy: '## Native copy\n\nWebsite **presentation** stays readable.\n\nAnother paragraph.' });
  let saved = $state(values.copy);
</script>
<div data-theme="dark" class="rigel">
  <button id="save" onclick={() => saved = values.copy}>Save</button>
  <output id="draft">{values.copy}</output><output id="saved">{saved}</output>
  <VisualEditor docId="page:sample" {schema} {docType} {values} previewPath="/preview.html" creating={false} devMode={false} onchange={next => values = next} />
</div>
