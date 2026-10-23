<script lang="ts">
  import type { ReferenceOption } from "../../manifest/references";
  import Select from "./Select.svelte";

  let { label, value, options, multiple = false, onchange }: {
    label: string;
    value: unknown;
    options: ReferenceOption[];
    multiple?: boolean;
    onchange: (value: string | string[]) => void;
  } = $props();
  const selected = $derived((Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === "string" && !!id));
  const missing = $derived(selected.filter(id => !options.some(option => option.value === id)));
</script>

<Select {label} {multiple} value={multiple ? selected : selected[0] ?? ""} options={[...(!multiple ? [{ value: "", label: `Select ${label.toLowerCase()}…` }] : []), ...options, ...missing.map(id => ({ value: id, label: `Unavailable (${id})` }))]} {onchange} />
{#if !options.length}<p class="hint">No entries have been declared yet.</p>{/if}
