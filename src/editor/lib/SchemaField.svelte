<script lang="ts">
  import { t } from "../i18n";
  import ImagePicker from "./ImagePicker.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import SchemaField from "./SchemaField.svelte";
  import Select from "./Select.svelte";
  import Icon from "./Icon.svelte";
  import DatePicker from "./DatePicker.svelte";
  import {
    blankItem,
    duplicateItem,
    itemFields,
    moveItem,
    objectFields,
    referenceOptions,
  } from "./schema-edit";
  import { newKey } from "../../schema/paths";
  import type { ContentDocument, FieldDef, Schema } from "../../schema/types";

  let {
    schema, field, value, base, documents, devMode = false, onvalue,
  }: {
    schema: Schema;
    field: FieldDef;
    value: unknown;
    base: string;
    documents: ContentDocument[];
    devMode?: boolean;
    onvalue: (next: unknown) => void;
  } = $props();

  const id = $props.id();
  let revealed = $state(false);
  const color = $derived(field.type === "color" && typeof value === "string" ? normalizeColor(value) : "");
  const itemList = $derived(field.type === "array" && Array.isArray(value) ? (value as unknown[]) : []);
  const itemSchema = $derived(field.type === "array" ? itemFields(schema, field) : []);
  const objectSchema = $derived(field.type === "object" ? objectFields(schema, field) : []);
  const options = $derived(field.type === "reference" ? referenceOptions(documents, field.to ?? []) : []);
  const fieldLabel = $derived(field.labelKey ? $t(field.labelKey) : field.label);
  const label = $derived(`${fieldLabel}${field.required ? " *" : ""}${devMode ? ` (${field.key})` : ""}`);

  function normalizeColor(input: string): string {
    const hex = input.trim().replace(/^#/, "");
    if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return input;
    return `#${(hex.length === 3 ? [...hex].map(character => character.repeat(2)).join("") : hex).toLowerCase()}`;
  }

  function setItem(index: number, item: unknown) {
    const next = [...itemList];
    next[index] = item;
    onvalue(next);
  }
</script>

<div data-schema-path={base}>
{#if field.type === "string" || field.type === "url"}
  <label>
    <span>{label}</span>
    <input type={(field.type as string) === "url" ? "url" : "text"} value={typeof value === "string" ? value : ""} placeholder={field.placeholder ?? ""} oninput={(event) => onvalue(event.currentTarget.value)} />
  </label>
{:else if field.type === "color"}
  <div class="schema-field">
    <label for={id}><span>{label}</span></label>
    <div class="schema-color">
      <input type="color" aria-label={$t("fields.colorPicker", { label: fieldLabel })} value={/^#[0-9a-f]{6}$/.test(color) ? color : "#000000"} oninput={(event) => onvalue(event.currentTarget.value)} />
      <input id={id} type="text" aria-label={$t("fields.colorHexValue", { label: fieldLabel })} value={typeof value === "string" ? value : ""} placeholder="#000000" spellcheck={false} oninput={(event) => onvalue(event.currentTarget.value)} onblur={(event) => onvalue(normalizeColor(event.currentTarget.value))} />
    </div>
  </div>
{:else if field.type === "code"}
  <label>
    <span>{label}</span>
    <textarea class="schema-code" rows="8" spellcheck={false} value={typeof value === "string" ? value : ""} oninput={(event) => onvalue(event.currentTarget.value)}></textarea>
  </label>
{:else if field.type === "password"}
  <div class="schema-field">
    <label for={id}><span>{label}</span></label>
    <div class="secret-input">
      <input id={id} type={revealed ? "text" : "password"} value={typeof value === "string" ? value : ""} placeholder={field.placeholder ?? ""} autocomplete="off" spellcheck={false} oninput={(event) => onvalue(event.currentTarget.value)} />
      <button type="button" aria-label={$t(revealed ? "fields.hideValue" : "fields.showValue", { label: fieldLabel })} aria-controls={id} aria-pressed={revealed} onclick={() => revealed = !revealed}><Icon name={revealed ? "eyeSlash" : "eye"} size={18} /></button>
    </div>
  </div>
{:else if field.type === "text"}
  <label>
    <span>{label}</span>
    <textarea rows="3" value={typeof value === "string" ? value : ""} oninput={(event) => onvalue(event.currentTarget.value)}></textarea>
  </label>
{:else if field.type === "markdown"}
  <MarkdownEditor label={fieldLabel} value={typeof value === "string" ? value : ""} oninput={(next) => onvalue(next)} />
{:else if field.type === "image" || field.type === "file"}
  <div class="schema-field">
    <span class="schema-label">{label}</span>
    <ImagePicker kind={field.type} accept={field.accept} value={typeof value === "string" ? value : ""} onpick={(url) => onvalue(url)} />
  </div>
{:else if field.type === "boolean"}
  <label class="inline">
    <input type="checkbox" role="switch" class="switch" checked={value === true} onchange={(event) => onvalue(event.currentTarget.checked)} />
    <span>{label}</span>
  </label>
{:else if field.type === "number"}
  <label>
    <span>{label}</span>
    <input type="number" value={typeof value === "number" ? value : ""} oninput={(event) => onvalue(event.currentTarget.value === "" ? 0 : Number(event.currentTarget.value))} />
  </label>
{:else if field.type === "date"}
  <DatePicker {label} value={typeof value === "string" ? value : ""} required={field.required} onchange={next => onvalue(next || undefined)} />
{:else if field.type === "reference"}
  <Select {label} value={value && typeof value === "object" ? String((value as Record<string, unknown>)._ref ?? "") : ""} options={[{ value: "", label: $t("fields.choose") }, ...options.map(option => ({ value: option.id, label: String(option.data.title ?? option.data.name ?? option.slug) }))]} onchange={next => onvalue(next ? { _ref: String(next) } : undefined)} />
{:else if field.type === "object"}
  <fieldset class="schema-object">
    <legend>{label}</legend>
    {#each objectSchema as sub (sub.key)}
      <SchemaField
        {schema}
        {documents}
        {devMode}
        field={sub}
        base={`${base}.${sub.key}`}
        value={value && typeof value === "object" ? (value as Record<string, unknown>)[sub.key] : undefined}
        onvalue={(next) => onvalue({ ...(value && typeof value === "object" ? value : {}), [sub.key]: next })}
      />
    {/each}
  </fieldset>
{:else if field.type === "array"}
  <div class="schema-array">
    <div class="schema-label">{label}</div>
    {#each itemList as item, index (`${base}.${item && typeof item === "object" ? (item as Record<string, unknown>)._key ?? index : index}`)}
      <div class="schema-item" data-schema-path={`${base}.${item && typeof item === "object" ? (item as Record<string, unknown>)._key ?? index : index}`}>
        <div class="schema-item-head">
          <span>{$t("fields.itemNumber", { number: index + 1 })}</span>
          <span class="schema-key">{(item && typeof item === "object" ? (item as Record<string, unknown>)._key : "") ?? ""}</span>
          <div class="schema-item-actions">
            <button type="button" aria-label={$t("fields.moveItemUp", { label: fieldLabel, number: index + 1 })} data-tooltip={$t("fields.moveUp")} disabled={index === 0} onclick={() => onvalue(moveItem(itemList, index, -1))}>↑</button>
            <button type="button" aria-label={$t("fields.moveItemDown", { label: fieldLabel, number: index + 1 })} data-tooltip={$t("fields.moveDown")} disabled={index === itemList.length - 1} onclick={() => onvalue(moveItem(itemList, index, 1))}>↓</button>
            <button type="button" aria-label={$t("fields.duplicateItem", { label: fieldLabel, number: index + 1 })} data-tooltip={$t("fields.duplicate")} onclick={() => onvalue(duplicateItem(itemList, index))}>⧉</button>
            <button type="button" aria-label={$t("fields.removeItem", { label: fieldLabel, number: index + 1 })} data-tooltip={$t("fields.remove")} onclick={() => onvalue(itemList.filter((_, position) => position !== index))}>×</button>
          </div>
        </div>
        {#if itemSchema.length}
          {#each itemSchema as sub (sub.key)}
            <SchemaField
              {schema}
              {documents}
              {devMode}
              field={sub}
              base={`${base}.${(item as Record<string, unknown>)._key}.${sub.key}`}
              value={item && typeof item === "object" ? (item as Record<string, unknown>)[sub.key] : undefined}
              onvalue={(next) => setItem(index, { ...(item as Record<string, unknown>), [sub.key]: next })}
            />
          {/each}
        {:else}
          <input type="text" aria-label={$t("fields.itemLabel", { label: fieldLabel, number: index + 1 })} value={typeof item === "string" ? item : ""} oninput={(event) => setItem(index, event.currentTarget.value)} />
        {/if}
      </div>
    {/each}
    <button type="button" class="outlined" onclick={() => onvalue([...itemList, itemSchema.length ? blankItem(itemSchema) : field.items?.some((item) => item.type === "reference") ? { _key: newKey(), _ref: "" } : ""])}>{$t("fields.addItem")}</button>
  </div>
{/if}
</div>
