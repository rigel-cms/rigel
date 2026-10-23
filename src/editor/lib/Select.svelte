<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import type { ICONS } from "./icons";

  let { label = "", ariaLabel = label, title, icon, value = "", options, multiple = false, disabled = false, onchange = () => {} }: {
    label?: string;
    ariaLabel?: string;
    title?: string;
    icon?: keyof typeof ICONS;
    value?: string | string[];
    options: { value: string; label: string; icon?: keyof typeof ICONS; disabled?: boolean }[];
    multiple?: boolean;
    disabled?: boolean;
    onchange?: (value: string | string[]) => void;
  } = $props();
  const id = $props.id();
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let open = $state(false);
  let active = $state(-1);
  let placement = $state("");
  let search = "";
  let lastKey = 0;
  const selected = $derived(Array.isArray(value) ? value : [value]);
  const text = $derived(options.filter(option => selected.includes(option.value)).map(option => option.label).join(", "));

  function position() {
    if (!open || !trigger || !menu) return;
    const { innerWidth, innerHeight } = trigger.ownerDocument.defaultView!;
    const rect = trigger.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const upward = below < 160 && above > below;
    const height = Math.min(280, upward ? above : below);
    const width = Math.min(Math.max(rect.width, 160), innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    const top = upward ? Math.max(8, rect.top - Math.min(menu.scrollHeight + 2, height) - 4) : rect.bottom + 4;
    placement = `left:${left}px;top:${top}px;width:${width}px;max-height:${Math.max(32, height)}px`;
  }

  function close() {
    if (menu?.matches(":popover-open")) menu.hidePopover();
    open = false;
  }

  async function reveal(last = false) {
    if (disabled) return;
    active = options.findIndex(option => !option.disabled && selected.includes(option.value));
    if (active < 0) active = last ? options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0).at(-1) ?? -1 : options.findIndex(option => !option.disabled);
    open = true;
    search = "";
    menu.showPopover();
    await tick();
    position();
    await tick();
    position();
    menu.querySelector(`#${CSS.escape(id)}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    active = index;
    value = multiple ? selected.includes(option.value) ? selected.filter(item => item !== option.value) : [...selected, option.value] : option.value;
    if (!multiple) close();
    trigger.focus({ preventScroll: true });
    onchange(value);
  }

  async function onkey(event: KeyboardEvent) {
    const expanded = menu.matches(":popover-open");
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!expanded) await reveal(event.key === "ArrowUp" || event.key === "End");
      if (expanded || event.key === "Home" || event.key === "End") {
        const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
        const current = enabled.indexOf(active);
        active = (event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : enabled[(current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]) ?? -1;
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(active); else await reveal();
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close();
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!expanded) await reveal();
      search = event.timeStamp - lastKey > 700 ? event.key : search + event.key;
      lastKey = event.timeStamp;
      let match = options.findIndex((option, index) => index > active && !option.disabled && option.label.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()));
      if (match < 0) match = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()));
      if (match >= 0) active = match;
    } else return;
    await tick();
    menu.querySelector(`#${CSS.escape(id)}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }

  $effect(() => {
    void options;
    if (disabled) close();
  });

  $effect(() => {
    if (!open) return;
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(menu);
    const dialog = trigger.closest("dialog");
    if (dialog) observer.observe(dialog);
    const view = trigger.ownerDocument.defaultView!;
    const scroll = (event: Event) => { if (!(event.target as Node)?.nodeType || !menu.contains(event.target as Node)) position(); };
    view.addEventListener("resize", position); view.addEventListener("scroll", scroll, true);
    return () => { observer.disconnect(); view.removeEventListener("resize", position); view.removeEventListener("scroll", scroll, true); };
  });
</script>

<div class="custom-select" onfocusout={() => { if (open) requestAnimationFrame(() => { if (trigger.ownerDocument.activeElement?.tagName === "IFRAME") close(); }); }}>
  {#if label}<span class="select-label" id={`${id}-label`}>{label}</span>{/if}
  <button bind:this={trigger} type="button" class="select-trigger" class:icon-only={!!icon} role="combobox" aria-label={label ? undefined : ariaLabel} aria-labelledby={label ? `${id}-label` : undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} popovertarget={`${id}-list`} {title} {disabled} onclick={event => { event.preventDefault(); menu.matches(":popover-open") ? close() : void reveal(); }} onkeydown={onkey}>
    {#if icon}<Icon name={icon} size={18} />{:else}<span>{text || (multiple ? `Select ${label.toLowerCase() || "options"}…` : "Choose…")}</span><Icon name="caretDown" size={12} />{/if}
  </button>
  <select hidden aria-hidden="true" tabindex="-1" aria-label={ariaLabel} {multiple} {disabled} {value} onchange={event => { value = multiple ? Array.from(event.currentTarget.selectedOptions, option => option.value) : event.currentTarget.value; onchange(value); }}>
    {#each options as option (option.value)}<option value={option.value} disabled={option.disabled}>{option.label}</option>{/each}
  </select>
  <div bind:this={menu} id={`${id}-list`} class="select-menu" popover="auto" role="listbox" aria-label={ariaLabel} aria-multiselectable={multiple || undefined} style={placement} ontoggle={event => { open = event.currentTarget.matches(":popover-open"); }} onkeydown={onkey}>
    {#each options as option, index (option.value)}
      <div id={`${id}-option-${index}`} class="select-option" class:active={active === index} role="option" tabindex="-1" aria-selected={selected.includes(option.value)} aria-disabled={option.disabled || undefined} onpointermove={() => { if (!option.disabled) active = index; }} onpointerdown={event => event.preventDefault()} onclick={event => { event.preventDefault(); choose(index); }}>
        {#if option.icon}<Icon name={option.icon} size={16} />{/if}
        <span>{option.label}</span><span class="select-check" aria-hidden="true">{selected.includes(option.value) ? "✓" : ""}</span>
      </div>
    {/each}
    {#if !options.length}<p class="select-empty">No options available.</p>{/if}
  </div>
</div>
