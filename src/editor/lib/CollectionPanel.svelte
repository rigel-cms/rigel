<script lang="ts">
  import { tick } from "svelte";
  import type { CollectionField } from "../../manifest/types";
  import type { SelectedField } from "./schema-edit";
  import ImagePicker from "./ImagePicker.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import DatePicker from "./DatePicker.svelte";
  import BlockEditor from "./BlockEditor.svelte";
  import type { ArticleBody } from "../../article-body";
  import PropertiesTabs from "./PropertiesTabs.svelte";
  import SeoGuidance from "./SeoGuidance.svelte";
  import ReferenceSelect from "./ReferenceSelect.svelte";
  import { referenceOptions } from "../../manifest/references";
  import { isSeoField } from "../../manifest/seo";
  import type { ContentDocument } from "../../schema/types";
  import { slugify } from "../../slugs";

  let { fields, values, storageSlug, body, selected, focusToken, devMode, documents = [], bodyInline = false, bodyLoading = false, oneditbody = () => {}, onchange, onbody }: {
    fields: CollectionField[];
    values: Record<string, unknown>;
    storageSlug: string;
    body: ArticleBody;
    bodyInline?: boolean;
    bodyLoading?: boolean;
    oneditbody?: () => void;
    selected: SelectedField | null;
    focusToken: number;
    devMode: boolean;
    documents?: ContentDocument[];
    onchange: (key: string, value: unknown) => void;
    onbody: (body: ArticleBody) => void;
  } = $props();
  let host: HTMLDivElement;
  let tab = $state<"content" | "seo">("content");

  $effect(() => {
    void focusToken;
    const path = selected?.path;
    if (!path || !focusToken) return;
    tab = "content";
    void tick().then(() => {
      const field = host?.querySelector(`[data-collection-field="${CSS.escape(path)}"]`);
      const control = (path === "$body" ? field?.querySelector<HTMLElement>('[contenteditable="true"]') : field?.querySelector<HTMLElement>('button[role="combobox"], input, textarea, [contenteditable="true"]')) ?? field?.querySelector<HTMLElement>('button');
      control?.focus();
      control?.scrollIntoView({ block: "nearest" });
    });
  });
</script>

<div class="schema-panel collection-panel" bind:this={host}>
  <PropertiesTabs bind:tab />
  <div id="properties-content" role="tabpanel" aria-labelledby="properties-tab-content" hidden={tab !== "content"}>
  <section>
    <h3>Article details</h3>
    <label><span>URL slug</span><input type="text" value={String(values.slug ?? storageSlug)} oninput={(event) => onchange("slug", event.currentTarget.value)} onblur={() => { if (Object.hasOwn(values, "slug")) onchange("slug", slugify(String(values.slug))); }} /></label>
    <p class="hint">Changes the URL, not the content filename. The website route must use the slug metadata.</p>
    {#each fields.filter(field => field.key !== "slug" && !isSeoField(field.key)) as field (field.key)}
      <div data-collection-field={field.key}>
        {#if field.type === "reference"}
          <ReferenceSelect label={field.label} value={values[field.key]} options={referenceOptions(field, documents)} multiple={field.multiple} onchange={(value) => onchange(field.key, value)} />
        {:else if field.type === "boolean"}
          <label class="inline">
            <input type="checkbox" role="switch" class="switch" checked={Boolean(values[field.key])} onchange={(event) => onchange(field.key, event.currentTarget.checked)} />
            <span>{field.label}{devMode ? ` (${field.key})` : ""}</span>
          </label>
        {:else if field.type === "markdown"}
          <MarkdownEditor label={field.label} value={String(values[field.key] ?? "")} oninput={(value) => onchange(field.key, value)} />
        {:else if field.type === "image"}
          <label><span>{field.label}{devMode ? ` (${field.key})` : ""}</span><ImagePicker value={String(values[field.key] ?? "")} onpick={(value) => onchange(field.key, value)} /></label>
        {:else if field.type === "tags"}
          <label>
            <span>{field.label}{devMode ? ` (${field.key})` : ""} (comma-separated)</span>
            <input type="text" value={Array.isArray(values[field.key]) ? (values[field.key] as string[]).join(", ") : String(values[field.key] ?? "")} oninput={(event) => onchange(field.key, event.currentTarget.value.split(",").map(value => value.trim()).filter(Boolean))} />
          </label>
        {:else if field.type === "date"}
          <DatePicker label={`${field.label}${devMode ? ` (${field.key})` : ""}`} value={String(values[field.key] ?? "")} onchange={(value) => onchange(field.key, value)} />
        {:else if field.type === "text"}
          <label><span>{field.label}{devMode ? ` (${field.key})` : ""}</span><textarea value={String(values[field.key] ?? "")} oninput={(event) => onchange(field.key, event.currentTarget.value)}></textarea></label>
        {:else}
          <label><span>{field.label}{devMode ? ` (${field.key})` : ""}</span><input type="text" value={String(values[field.key] ?? "")} oninput={(event) => onchange(field.key, event.currentTarget.value)} /></label>
        {/if}
      </div>
    {/each}
  </section>
  <section data-collection-field="$body">
    {#if bodyInline}
      <button class="outlined" disabled={bodyLoading} onclick={oneditbody}>Edit article body in preview</button>
      <p class="hint">{bodyLoading ? "Loading preview…" : "Click the article body in the preview to edit. Content changes require Save."}</p>
    {:else}<BlockEditor value={body} oninput={onbody} />{/if}
  </section>
  </div>
  <div id="properties-seo" role="tabpanel" aria-labelledby="properties-tab-seo" hidden={tab !== "seo"}>
  <section class="seo-fields">
    <h3>SEO</h3>
    {#each fields.filter(field => isSeoField(field.key)) as field (field.key)}
      <div data-collection-field={field.key}>
        <label>
          <span>{field.label}</span>
          {#if field.type === "image"}<ImagePicker value={String(values[field.key] ?? "")} onpick={(value) => onchange(field.key, value)} />
          {:else if field.type === "text"}<textarea rows="3" value={String(values[field.key] ?? "")} oninput={(event) => onchange(field.key, event.currentTarget.value)}></textarea>
          {:else}<input type="text" value={String(values[field.key] ?? "")} oninput={(event) => onchange(field.key, event.currentTarget.value)} />{/if}
        </label>
        <SeoGuidance field={field.key} value={values[field.key]} />
      </div>
    {/each}
  </section>
  </div>
</div>
