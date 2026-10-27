<script lang="ts">
  import { t } from "../i18n";
  import type { CopyField } from "../manifest/types";
  import Field from "./Field.svelte";
  import ImagePicker from "./ImagePicker.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";

  let {
    field,
    value,
    oninput,
    devMode = false,
  }: {
    field: CopyField;
    value: unknown;
    oninput: (v: unknown) => void;
    devMode?: boolean;
  } = $props();

  const str = $derived(typeof value === "string" ? value : "");
  const label = $derived(`${field.label}${devMode ? ` (${field.key})` : ""}`);
</script>

{#if field.type === "string"}
  <label>
    <span>{label}</span>
    <input
      type="text"
      value={str}
      placeholder={field.placeholder ?? ""}
      oninput={(e) => oninput(e.currentTarget.value)}
    />
  </label>
{:else if field.type === "text"}
  <label>
    <span>{label}</span>
    <textarea rows="3" oninput={(e) => oninput(e.currentTarget.value)}>{str}</textarea>
  </label>
{:else if field.type === "markdown"}
  <MarkdownEditor value={str} {label} {oninput} />
{:else if field.type === "image"}
  <label>
    <span>{label}</span>
    <ImagePicker value={str} onpick={(url) => oninput(url)} />
  </label>
{:else if field.type === "list"}
  {@const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
  <div class="field-label">{label}</div>
  {#each items as item, i (i)}
    <div class="list-item">
      {#each field.item.fields as sub (sub.key)}
        <Field
          field={sub}
          {devMode}
          value={item[sub.key]}
          oninput={(v: unknown) => {
            const next = items.slice();
            next[i] = { ...item, [sub.key]: v };
            oninput(next);
          }}
        />
      {/each}
      <button
        class="remove"
        onclick={() => oninput(items.filter((_, j) => j !== i))}
      >
        {$t("fields.remove")}
      </button>
    </div>
  {/each}
  <button
    class="add"
    onclick={() => {
      const blank: Record<string, unknown> = {};
      for (const sub of field.item.fields) blank[sub.key] = "";
      oninput([...items, blank]);
    }}
  >
    {$t("fields.addItem")}
  </button>
{/if}