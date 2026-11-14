<script>
  import VisualEditor from '../../src/editor/lib/VisualEditor.svelte';
  import MarkdownEditor from '../../src/editor/lib/MarkdownEditor.svelte';
  import BlockEditor from '../../src/editor/lib/BlockEditor.svelte';
  import { markdownToBody } from '../../src/editor/lib/markdown-blocks';
  const source = '## Heading\n\nBefore [one **two** *three* four](/old) after [other](/other).';
  const docType = { name: 'page', title: 'Page', folder: 'pages', type: 'document', fields: [{ key: 'copy', label: 'Copy', type: 'markdown' }, { key: 'legacy', label: 'Legacy', type: 'markdown' }] };
  let values = $state({ copy: source, legacy: source.replace('(/old)', '(/old "Title")') });
  let markdown = $state(source);
  let body = $state(markdownToBody(source));
</script>
<div class="rigel" style="display:block">
  <output id="draft" hidden>{JSON.stringify(values)}</output>
  <VisualEditor docId="page:sample" schema={{ documents: [docType], objects: [] }} {docType} {values} previewPath="/preview.html" bodyInline={true} creating={false} devMode={false} onchange={next => values = next} />
  <section id="markdown"><MarkdownEditor label="Markdown" value={markdown} oninput={next => markdown = next} /></section>
  <section id="blocks"><BlockEditor value={body} oninput={next => body = next} /></section>
</div>
