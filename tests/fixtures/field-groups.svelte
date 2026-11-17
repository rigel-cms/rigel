<script>
  import SchemaPanel from '../../src/editor/lib/SchemaPanel.svelte';
  import CollectionPanel from '../../src/editor/lib/CollectionPanel.svelte';
  const fields = [
    { key: 'title', label: 'Title', type: 'string' },
    { key: 'draft', label: 'Draft', type: 'boolean' },
    { key: 'custom', label: 'Custom', type: 'string' },
    { key: 'description', label: 'Summary', type: 'text', group: 'content' },
    { key: 'layout', label: 'Layout', type: 'string', group: 'page' },
    { key: 'keywords', label: 'Keywords', type: 'tags', group: 'seo' },
    { key: 'author', label: 'Author', type: 'reference', options: [{ value: 'alex', label: 'Alex' }], group: 'seo' },
    { key: 'publishedAt', label: 'Published', type: 'date', group: 'seo' },
    { key: 'notes', label: 'Notes', type: 'markdown', group: 'seo' },
    { key: 'metaTitle', label: 'SEO title', type: 'string' },
  ];
  const schemaFields = [...fields.filter(f => !['keywords', 'author'].includes(f.key)),
    { key: 'settings', label: 'Settings', type: 'object', group: 'seo', fields: [{ key: 'canonical', label: 'Canonical', type: 'url' }] },
    { key: 'keywords', label: 'Keywords', type: 'array', group: 'seo', items: [{ type: 'string' }] },
  ];
  const docType = { name: 'page', title: 'Pages', type: 'document', folder: 'pages', fields: schemaFields };
  const schema = { documents: [docType], objects: [] };
  let values = $state({ title: 'Home', custom: 'Content value', description: 'Summary value', layout: 'Wide', settings: { canonical: 'https://example.com' }, keywords: ['one'], notes: 'Notes', author: 'alex' });
  let selected = $state(null);
  let focusToken = $state(0);
  const body = { root: { type: 'root', version: 1, children: [], direction: null, format: '', indent: 0 } };
  function focus(path, docId = 'page:home') { selected = { docId, path }; focusToken++; }
</script>
<button id="focus-custom" onclick={() => focus('custom')}>Focus custom</button>
<button id="focus-nested" onclick={() => focus('settings.canonical')}>Focus nested</button>
<button id="focus-description" onclick={() => focus('description')}>Focus summary</button>
<button id="focus-collection-description" onclick={() => focus('description', 'blog:home')}>Focus article summary</button>
<div class="rigel" id="schema"><SchemaPanel {schema} {docType} {values} docId="page:home" {selected} creating={false} pending={[]} documents={[]} {focusToken} devMode={false} onchange={next => values = next} onselect={next => selected = next} oneditdocument={() => {}} /></div>
<div class="rigel" id="collection"><CollectionPanel {fields} {values} storageSlug="home" {body} selected={selected?.docId === 'blog:home' ? selected : null} {focusToken} devMode={false} ondelete={() => {}} onchange={(key, value) => values = { ...values, [key]: value }} onbody={() => {}} /></div>
<div class="rigel" id="shared"><SchemaPanel {schema} docType={{ ...docType, shared: true }} {values} docId="page:home" selected={null} creating={false} pending={[]} documents={[]} focusToken={0} devMode={false} onchange={next => values = next} onselect={() => {}} oneditdocument={() => {}} /></div>
<output id="values">{JSON.stringify(values)}</output>
