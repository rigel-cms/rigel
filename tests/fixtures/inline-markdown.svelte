<script>
  import VisualEditor from '../../src/editor/lib/VisualEditor.svelte';
  const docType = {
    name: 'page',
    title: 'Page',
    type: 'document',
    folder: 'pages',
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'copy', label: 'Copy', type: 'markdown' },
      { key: 'notice', label: 'Notice', type: 'markdown' },
      { key: 'legacy', label: 'Legacy', type: 'markdown' },
      {
        key: 'contact', label: 'Contact', type: 'object', fields: [
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
</div>
