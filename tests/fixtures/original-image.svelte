<script>
  import VisualEditor from "../../src/editor/lib/VisualEditor.svelte";

  const feature = { name: "feature", title: "Feature", type: "section", fields: [{ key: "image", label: "Feature image", type: "image" }] };
  const docType = {
    name: "page",
    title: "Page",
    type: "document",
    folder: "pages",
    fields: [
      { key: "hero", label: "Hero", type: "object", fields: [
        { key: "image", label: "Hero image", type: "image" },
        { key: "alt", label: "Hero alt", type: "string" },
        { key: "href", label: "Hero link", type: "url" },
      ] },
      { key: "secondary", label: "Secondary", type: "object", fields: [{ key: "image", label: "Secondary image", type: "image" }] },
      { key: "legacy", label: "Legacy", type: "object", fields: [{ key: "image", label: "Legacy image", type: "image" }] },
      { key: "unsafe", label: "Unsafe", type: "object", fields: [{ key: "image", label: "Unsafe image", type: "image" }] },
    ],
  };
  const schema = { documents: [docType], objects: [feature] };
  const documents = { "page:other": { image: "/images/second.png" } };
  const initial = {
    hero: { image: "/images/cover.png", alt: "Saved description", href: "/gallery/" },
    secondary: { image: "/images/second.png" },
    legacy: { image: "/images/alternate.png" },
    unsafe: { image: "/images/second.png" },
    sections: [{ _key: "k1", _type: "feature", image: "/images/cover.png" }],
  };
  let values = $state(structuredClone(initial));
  let saved = $state(JSON.stringify(initial));
  window.__rigel = {
    edit: (next) => { values = structuredClone(next); },
    initial: () => JSON.stringify(initial),
    draft: () => JSON.stringify(values),
    saved: () => saved,
    documents,
  };
</script>

<div class="rigel" data-theme="light" style="height:900px">
  <button id="save" onclick={() => (saved = JSON.stringify(values))}>Save</button>
  <output id="draft" hidden>{JSON.stringify(values)}</output>
  <output id="saved" hidden>{saved}</output>
  <VisualEditor
    docId="page:hero"
    {schema}
    {docType}
    {values}
    {documents}
    previewPath="/preview.html"
    creating={false}
    devMode={false}
    onchange={(next) => (values = next)}
  />
</div>
