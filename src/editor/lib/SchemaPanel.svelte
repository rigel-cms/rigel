<script lang="ts">
  import { t } from "../i18n";
  import SchemaField from "./SchemaField.svelte";
  import Icon from "./Icon.svelte";
  import PropertiesTabs from "./PropertiesTabs.svelte";
  import SeoGuidance from "./SeoGuidance.svelte";
  import Select from "./Select.svelte";
  import { onDestroy, tick } from "svelte";
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

  let dragging = $state<string | null>(null);
  let target = $state<number | null>(null);
  let message = $state("");
  let pointer: { key: string; docId: string; pointerId: number; x: number; y: number; handle: HTMLButtonElement } | null = null;

  function cancelDrag() {
    const active = pointer;
    pointer = null;
    dragging = null;
    target = null;
    if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
  }
  onDestroy(cancelDrag);

  function startDrag(event: PointerEvent, key: string) {
    if (event.button !== 0 || !event.isPrimary || pointer) return;
    const handle = event.currentTarget as HTMLButtonElement;
    pointer = { key, docId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, handle };
    handle.setPointerCapture(event.pointerId);
  }

  function dropAt(x: number, y: number) {
    const list = document.elementFromPoint(x, y)?.closest('.structure-list');
    const source = pointer?.handle.closest('li');
    if (!list || source?.parentElement !== list || pointer?.docId !== docId) return null;
    const rows = [...list.children];
    const before = rows.findIndex(row => { const rect = row.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
    const insertion = before < 0 ? rows.length : before;
    const from = sections.findIndex(section => section._key === pointer?.key);
    return from < 0 || insertion === from || insertion === from + 1 ? null : insertion;
  }

  function dragPointer(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    if (!dragging && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 5) return;
    dragging = pointer.key;
    target = dropAt(event.clientX, event.clientY);
  }

  function finishDrag(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    const captured = pointer.handle.hasPointerCapture(event.pointerId);
    const from = captured ? sections.findIndex(section => section._key === dragging) : -1;
    const insertion = dropAt(event.clientX, event.clientY);
    cancelDrag();
    if (from < 0 || insertion === null) return;
    const next = [...sections];
    const [section] = next.splice(from, 1);
    const index = insertion > from ? insertion - 1 : insertion;
    next.splice(index, 0, section);
    setSections(next);
    message = $t("fields.sectionMoved", { label: sectionLabel(schema, section._type), position: index + 1, count: next.length });
  }

  async function moveWithKeyboard(event: KeyboardEvent, index: number) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (pointer) return;
    const delta = event.key === "ArrowUp" ? -1 : 1;
    const position = index + delta;
    if (position < 0 || position >= sections.length) return;
    const handle = event.currentTarget as HTMLButtonElement;
    const label = sectionLabel(schema, sections[index]._type);
    setSections(moveItem(sections, index, delta) as Record<string, unknown>[]);
    message = $t("fields.sectionMoved", { label, position: position + 1, count: sections.length });
    await tick();
    handle.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointermove={dragPointer} onpointerup={finishDrag} onpointercancel={cancelDrag} onkeydown={event => { if (event.key === 'Escape' && pointer) { event.preventDefault(); cancelDrag(); message = $t('fields.menuMoveCancelled'); } }} />

<div class="schema-panel" bind:this={host}>
  {#if docType.shared}
    <p class="shared-badge"><Icon name="info" size={12} /> {$t(docType.demo ? "fields.demoContentNotice" : "fields.sharedContentNotice")}</p>
  {/if}
  {#if seoFields.length}<PropertiesTabs bind:tab />{/if}
  <div id="properties-content" role={seoFields.length ? "tabpanel" : undefined} aria-labelledby={seoFields.length ? "properties-tab-content" : undefined} hidden={tab !== "content"}>
  <section class="document-properties">
    <h3>{$t(docType.shared ? "fields.content" : "fields.pageProperties")}</h3>
    {#if !docType.shared}
      <label><span>{$t("fields.urlSlug")}</span><input type="text" value={String(values.slug ?? docId.slice(docType.name.length + 1))} oninput={(event) => onchange({ ...values, slug: event.currentTarget.value })} onblur={() => { if (Object.hasOwn(values, "slug")) onchange({ ...values, slug: slugify(String(values.slug)) }); }} /></label>
      <p class="hint">{$t("fields.documentSlugHint")}</p>
    {/if}
    {#each docFields.filter(field => docType.shared || !isSeoField(field.key)) as field (field.key)}
      <div data-schema-path={field.key}>
        <SchemaField {schema} {documents} {devMode} {field} base={field.key} value={values[field.key]} onvalue={(next) => onchange(replaceAt(values, field.key, next))} />
      </div>
    {/each}
  </section>
  {#if creating}
    <p class="panel-note">{$t("fields.newPageNotice")}</p>
  {/if}
  {#if sections.length || values.sections !== undefined}
    <section>
      <h3>{$t("fields.structure")}</h3>
      <p id="section-reorder-hint" class="reorder-status">{$t("fields.sectionReorderHint")}</p>
      <p class="reorder-status" role="status" aria-live="polite">{message}</p>
      <ul class="structure-list">
        {#each sections as section, index (section._key)}
          <li class:active={selected?.sectionKey === section._key} class:is-dragging={dragging === section._key} class:drop-before={target === index} class:drop-after={target === sections.length && index === sections.length - 1} data-section-key={section._key}>
            <button type="button" class="outlined icon-only section-drag" aria-label={$t("fields.reorderSection", { label: sectionLabel(schema, section._type) })} aria-describedby="section-reorder-hint" onpointerdown={event => startDrag(event, String(section._key))} onlostpointercapture={cancelDrag} onkeydown={event => moveWithKeyboard(event, index)}><Icon name="dotsSixVertical" /></button>
            <button type="button" class="structure-row" onclick={() => onselect({ docId, path: "", sectionKey: String(section._key) })}>
              <span>{sectionLabel(schema, section._type, $t("fields.section"))}</span>
              {#if devMode}<span class="schema-key">{section._key}</span>{/if}
            </button>
            <div class="structure-actions">
              <button type="button" aria-label={$t("fields.duplicateSection", { label: sectionLabel(schema, section._type) })} data-tooltip={$t("fields.duplicate")} onclick={() => setSections(duplicateItem(sections, index) as Record<string, unknown>[])}>⧉</button>
              <button type="button" aria-label={$t("fields.removeSection", { label: sectionLabel(schema, section._type) })} data-tooltip={$t("fields.remove")} onclick={() => removeSection(index)}>×</button>
            </div>
          </li>
        {/each}
      </ul>
      <div class="add-section">
        <Select ariaLabel={$t("fields.sectionTypeToAdd")} value={addType} onchange={next => { addType = String(next); }} options={[{ value: "", label: $t("fields.chooseSection") }, ...allowedTypes.map(type => ({ value: type.name, label: type.title }))]} />
        <button type="button" class="outlined" disabled={!addType} onclick={addSection}>{$t("fields.addSection")}</button>
      </div>
      {#if pending.length}<p class="panel-note" role="status">{$t("fields.pendingSections", { count: pending.length })}</p>{/if}
    </section>
  {/if}

  {#if selectedSection || (selectedField && selected?.path.includes("."))}
  <section class="section-properties">
    <h3>{$t("fields.sectionProperties")}</h3>
    {#if selectedSection && selected?.sectionKey}
      <p class="selected-path">{selectedField ? `${selectedField.labelKey ? $t(selectedField.labelKey) : selectedField.label} · ` : ""}{selectedSection.title}</p>
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
            <button type="button" class="outlined" onclick={() => oneditdocument(reference._ref!)}>{$t("fields.editReference", { label: field.label.toLowerCase() })}</button>
          {/if}
        </div>
      {/each}
    {:else if selectedField && selected}
      <p class="selected-path">{selectedField.labelKey ? $t(selectedField.labelKey) : selectedField.label}{selected.sectionKey ? ` · ${sectionLabel(schema, sections.find((section) => section._key === selected.sectionKey)?._type, $t("fields.section"))}` : ""}</p>
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
      <h3>{$t("fields.seo")}</h3>
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
