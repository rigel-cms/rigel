<script lang="ts">
  import SchemaField from "./SchemaField.svelte";
  import Icon from "./Icon.svelte";
  import PropertiesTabs from "./PropertiesTabs.svelte";
  import SeoGuidance from "./SeoGuidance.svelte";
  import Select from "./Select.svelte";
  import { tick } from "svelte";
  import {
    blankItem,
    duplicateItem,
    fieldForPath,
    moveItem,
    replaceAt,
    sectionLabel,
    sectionList,
    sectionTypeDef,
    type SelectedField,
  } from "./schema-edit";
  import { resolvePath } from "../../schema/paths";
  import { isSeoField } from "../../manifest/seo";
  import type { ContentDocument, DocumentDef, Schema } from "../../schema/types";
  import { slugify } from "../../slugs";

  let {
    schema, docType, values, docId, selected, creating, pending, documents, focusToken, devMode, onchange, onselect, oneditdocument,
  }: {
    schema: Schema;
    docType: DocumentDef;
    values: Record<string, unknown>;
    docId: string;
    selected: SelectedField | null;
    creating: boolean;
    pending: string[];
    documents: ContentDocument[];
    focusToken: number;
    devMode: boolean;
    onchange: (next: Record<string, unknown>) => void;
    onselect: (next: SelectedField | null) => void;
    oneditdocument: (id: string) => void;
  } = $props();

  let host: HTMLDivElement;
  let tab = $state<"content" | "seo">("content");
  let addType = $state("");
  const sections = $derived(sectionList(values));
  const allowedTypes = $derived(schema.objects.filter((object) => object.type === "section"));
  const selectedField = $derived(selected?.docId === docId ? fieldForPath(schema, docType, values, selected.path) : null);
  const selectedSection = $derived(selected?.sectionKey ? sectionTypeDef(schema, sections.find((section) => section._key === selected?.sectionKey)?._type) : undefined);
  const selectedValue = $derived(selected && selectedField ? resolvePath(values, selected.path).value : undefined);
  const docFields = $derived(docType.fields.filter((field) => field.key !== "sections" && (docType.shared || field.key !== "slug")));
  const seoFields = $derived(docType.shared ? [] : docFields.filter(field => isSeoField(field.key)));

  $effect(() => {
    void focusToken;
    const path = selected?.docId === docId ? selected.path : "";
    const sectionKey = selected?.docId === docId ? selected.sectionKey : undefined;
    tab = "content";
    if (!focusToken || !host) return;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      const properties = host.querySelector(sectionKey ? ".section-properties" : ".document-properties");
      const field = [...properties?.querySelectorAll<HTMLElement>("[data-schema-path]") ?? []].find((element) => element.dataset.schemaPath === path);
      const scope = field ?? properties;
      const target = scope?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?? scope?.querySelector<HTMLElement>('button[role="combobox"], input:not([type="hidden"]), textarea')
        ?? scope?.querySelector<HTMLElement>('button:not(:disabled)');
      target?.focus();
      target?.scrollIntoView({ block: "nearest" });
    });
    return () => { cancelled = true; };
  });

  function setSections(next: Record<string, unknown>[]) {
    onchange({ ...values, sections: next });
  }

  function addSection() {
    const def = schema.objects.find((object) => object.name === addType && object.type === "section");
    if (!def) return;
    const section = blankItem(def.fields);
    section._type = addType;
    setSections([...sections, section]);
    onselect({ docId, path: "", sectionKey: String(section._key) });
    addType = "";
  }

  function removeSection(index: number) {
    setSections(sections.filter((_, position) => position !== index));
  }
</script>

<div class="schema-panel" bind:this={host}>
  {#if docType.shared}
    <p class="shared-badge"><Icon name="info" size={12} /> {docType.demo ? "Field examples for testing. These values are separate from your website settings." : "Shared content. Changes appear on every page that references it."}</p>
  {/if}
  <div class:page-properties-header={!docType.shared}>
  {#if seoFields.length}<PropertiesTabs bind:tab />{/if}
  <section class="document-properties" hidden={tab !== "content"}>
    <h3>{docType.shared ? "Content" : "Page properties"}</h3>
    {#if !docType.shared}
      <label><span>URL slug</span><input type="text" value={String(values.slug ?? docId.slice(docType.name.length + 1))} oninput={(event) => onchange({ ...values, slug: event.currentTarget.value })} onblur={() => { if (Object.hasOwn(values, "slug")) onchange({ ...values, slug: slugify(String(values.slug)) }); }} /></label>
      <p class="hint">Changes the URL, not the document identifier or filename. The website route must use the slug metadata.</p>
    {/if}
    {#each docFields.filter(field => docType.shared || !isSeoField(field.key)) as field (field.key)}
      <div data-schema-path={field.key}>
        <SchemaField {schema} {documents} {devMode} {field} base={field.key} value={values[field.key]} onvalue={(next) => onchange(replaceAt(values, field.key, next))} />
      </div>
    {/each}
  </section>
  </div>
  <div id="properties-content" role={seoFields.length ? "tabpanel" : undefined} aria-labelledby={seoFields.length ? "properties-tab-content" : undefined} hidden={tab !== "content"}>
  {#if creating}
    <p class="panel-note">New page. Save writes the JSON file; the route appears once the site has the file.</p>
  {/if}
  {#if sections.length || values.sections !== undefined}
    <section>
      <h3>Structure</h3>
      <ul class="structure-list">
        {#each sections as section, index (section._key)}
          <li class:active={selected?.sectionKey === section._key}>
            <button type="button" class="structure-row" onclick={() => onselect({ docId, path: "", sectionKey: String(section._key) })}>
              <span>{sectionLabel(schema, section._type)}</span>
              {#if devMode}<span class="schema-key">{section._key}</span>{/if}
            </button>
            <div class="structure-actions">
              <button type="button" aria-label={`Move ${sectionLabel(schema, section._type)} up`} data-tooltip="Move up" disabled={index === 0} onclick={() => setSections(moveItem(sections, index, -1) as Record<string, unknown>[])}>↑</button>
              <button type="button" aria-label={`Move ${sectionLabel(schema, section._type)} down`} data-tooltip="Move down" disabled={index === sections.length - 1} onclick={() => setSections(moveItem(sections, index, 1) as Record<string, unknown>[])}>↓</button>
              <button type="button" aria-label={`Duplicate ${sectionLabel(schema, section._type)}`} data-tooltip="Duplicate" onclick={() => setSections(duplicateItem(sections, index) as Record<string, unknown>[])}>⧉</button>
              <button type="button" aria-label={`Remove ${sectionLabel(schema, section._type)}`} data-tooltip="Remove" onclick={() => removeSection(index)}>×</button>
            </div>
          </li>
        {/each}
      </ul>
      <div class="add-section">
        <Select ariaLabel="Section type to add" value={addType} onchange={next => { addType = String(next); }} options={[{ value: "", label: "Choose a section…" }, ...allowedTypes.map(type => ({ value: type.name, label: type.title }))]} />
        <button type="button" class="outlined" disabled={!addType} onclick={addSection}>Add section</button>
      </div>
      {#if pending.length}<p class="panel-note" role="status">{pending.length} new section{pending.length === 1 ? "" : "s"} will appear after Save.</p>{/if}
    </section>
  {/if}

  {#if selectedSection || (selectedField && selected?.path.includes("."))}
  <section class="section-properties">
    <h3>Section properties</h3>
    {#if selectedSection && selected?.sectionKey}
      <p class="selected-path">{selectedField ? `${selectedField.label} · ` : ""}{selectedSection.title}</p>
      {#each selectedSection.fields as field (field.key)}
        {@const reference = field.type === "reference" ? sections.find((section) => section._key === selected?.sectionKey)?.[field.key] as { _ref?: string } | undefined : undefined}
        <div data-schema-path={`sections.${selected.sectionKey}.${field.key}`}>
          <SchemaField
            {schema}
            {documents}
            {devMode}
            {field}
            base={`sections.${selected.sectionKey}.${field.key}`}
            value={sections.find((section) => section._key === selected?.sectionKey)?.[field.key]}
            onvalue={(next) => onchange(replaceAt(values, `sections.${selected!.sectionKey}.${field.key}`, next))}
          />
          {#if reference?._ref && documents.some((doc) => doc.id === reference._ref)}
            <button type="button" class="outlined" onclick={() => oneditdocument(reference._ref!)}>Edit {field.label.toLowerCase()} ↗</button>
          {/if}
        </div>
      {/each}
    {:else if selectedField && selected}
      <p class="selected-path">{selectedField.label}{selected.sectionKey ? ` · ${sectionLabel(schema, sections.find((section) => section._key === selected.sectionKey)?._type)}` : ""}</p>
      <SchemaField
        {schema}
        {documents}
        {devMode}
        field={selectedField}
        base={selected.path}
        value={selectedValue}
        onvalue={(next) => onchange(replaceAt(values, selected.path, next))}
      />

    {/if}
  </section>
  {/if}
  </div>
  {#if seoFields.length}
    <div id="properties-seo" role="tabpanel" aria-labelledby="properties-tab-seo" hidden={tab !== "seo"}>
    <section class="seo-fields">
      <h3>SEO</h3>
      {#each seoFields as field (field.key)}
        <div data-schema-path={field.key}>
          <SchemaField {schema} {documents} {devMode} {field} base={field.key} value={values[field.key]} onvalue={(next) => onchange(replaceAt(values, field.key, next))} />
          <SeoGuidance field={field.key} value={values[field.key]} />
        </div>
      {/each}
    </section>
    </div>
  {/if}
</div>
