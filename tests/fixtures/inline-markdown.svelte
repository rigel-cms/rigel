<script>
  import VisualEditor from '../../src/editor/lib/VisualEditor.svelte';
  import CollectionPanel from '../../src/editor/lib/CollectionPanel.svelte';
  const docType = {
    name: 'page',
    title: 'Page',
    type: 'document',
    folder: 'pages',
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'draft', label: 'Draft', type: 'boolean' },
      { key: 'copy', label: 'Copy', type: 'markdown' },
      { key: 'notice', label: 'Notice', type: 'markdown' },
      { key: 'legacy', label: 'Legacy', type: 'markdown' },
      {
        key: 'contact', label: 'Contact', type: 'object', fields: [
          { key: 'enabled', label: 'Enabled', type: 'boolean' },
          { key: 'blurb', label: 'Blurb', type: 'markdown' },
        ],
      },
      {
        key: 'faq',
        label: 'FAQ',
        type: 'array',
        items: [{ type: 'object', title: 'Question', fields: [
          { key: 'question', label: 'Question', type: 'string' },
          { key: 'answer', label: 'Answer', type: 'markdown', sidebarOnly: true },
        ] }],
      },
    ],
  };
  const schema = { documents: [docType], objects: [] };
  let values = $state({
    title: 'Sample page',
    copy: '## Native copy\n\nWebsite **presentation** stays readable.\n\nAnother paragraph.',
    notice: 'Short legal notice.',
    legacy: 'Legacy <span class="badge">tag</span> copy.',
    contact: { blurb: 'Write to us.' },
    faq: [{ _key: 'shipping', question: 'How soon do you ship?', answer: 'Within two days.' }],
  });
  let saved = $state(JSON.stringify(values));
  let bodyInline = $state(true);
</script>
<div data-theme="dark" class="rigel">
  <button id="save" onclick={() => saved = JSON.stringify(values)}>Save</button>
  <output id="draft" hidden>{JSON.stringify(values)}</output><output id="saved" hidden>{saved}</output>
  <button id="toggle-inline" hidden onclick={() => bodyInline = !bodyInline}>Toggle inline editing</button>
  <VisualEditor docId="page:sample" {schema} {docType} {values} previewPath="/preview.html" {bodyInline} creating={false} devMode={false} onchange={next => values = next} />
  <div id="collection-spacing" hidden>
    <CollectionPanel fields={[{ key: 'draft', label: 'Draft', type: 'boolean' }, { key: 'summary', label: 'Summary', type: 'markdown' }]} values={{ draft: true, summary: 'Article summary.' }} storageSlug="sample" body={{ root: { type: 'root', version: 1, children: Array.from({ length: 40 }, (_, index) => ({ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text: `Article paragraph ${index + 1}.`, format: 0, detail: 0, mode: 'normal', style: '' }], direction: null, format: '', indent: 0, textFormat: 0, textStyle: '' })), direction: null, format: '', indent: 0 } }} selected={null} focusToken={0} devMode={false} inlineFields={['summary']} onchange={() => {}} onbody={() => {}} />
  </div>
</div>
