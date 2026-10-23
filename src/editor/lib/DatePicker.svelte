<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import Select from "./Select.svelte";
  import { formatDate, months, monthDays, moveDay, moveMonth, parseDate, todayDate } from "./calendar";

  let { label, value = "", required = false, onchange }: { label: string; value?: string; required?: boolean; onchange: (value: string) => void } = $props();
  const id = $props.id();
  const monthOptions = months.map((label, index) => ({ label, value: String(index + 1) }));
  let host: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let open = $state(false);
  let focused = $state(todayDate());
  let today = $state(todayDate());
  let placement = $state("");
  const year = $derived(Number(focused.slice(0, 4)));
  const month = $derived(Number(focused.slice(5, 7)));
  const cells = $derived(monthDays(focused));
  const weeks = $derived(Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7)));
  const heading = $derived(`${months[month - 1]} ${year}`);

  function position() {
    if (!open || !trigger || !menu) return;
    const view = trigger.ownerDocument.defaultView!, rect = trigger.getBoundingClientRect();
    const width = Math.min(336, view.innerWidth - 16), height = Math.min(menu.scrollHeight + 2, view.innerHeight - 16);
    const below = view.innerHeight - rect.bottom - 8, above = rect.top - 8;
    const top = below >= height || below >= above ? rect.bottom + 4 : rect.top - height - 4;
    placement = `width:${width}px;left:${Math.max(8, Math.min(rect.left, view.innerWidth - width - 8))}px;top:${Math.max(8, Math.min(top, view.innerHeight - height - 8))}px;max-height:${view.innerHeight - 16}px`;
  }

  function close(restoreFocus = false) {
    if (menu?.matches(":popover-open")) menu.hidePopover();
    open = false;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  async function focusDay() {
    await tick();
    menu.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
  }

  async function reveal() {
    today = todayDate();
    focused = parseDate(value) ? value : today;
    trigger.scrollIntoView({ block: "nearest" });
    open = true;
    menu.showPopover();
    await tick();
    position();
    await focusDay();
  }

  function choose(next: string) {
    if ((next && !parseDate(next)) || (!next && required)) return;
    onchange(next);
    close(true);
  }

  function setYear(event: Event) {
    const input = event.currentTarget as HTMLInputElement, next = Number(input.value);
    if (Number.isInteger(next) && next >= 1 && next <= 9999) focused = moveMonth(focused, (next - year) * 12);
    input.value = String(Number(focused.slice(0, 4)));
  }

  async function gridKey(event: KeyboardEvent) {
    const date = parseDate(focused)!;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getUTCDay(), End: 6 - date.getUTCDay() };
    if (event.key in offsets) focused = moveDay(focused, offsets[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") focused = moveMonth(focused, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
    else return;
    event.preventDefault();
    await focusDay();
  }

  $effect(() => {
    if (!open) return;
    const view = trigger.ownerDocument.defaultView!;
    const observer = new ResizeObserver(position);
    observer.observe(trigger); observer.observe(menu);
    const scroll = (event: Event) => { if (!(event.target as Node)?.nodeType || !menu.contains(event.target as Node)) position(); };
    view.addEventListener("resize", position); view.addEventListener("scroll", scroll, true);
    return () => { observer.disconnect(); view.removeEventListener("resize", position); view.removeEventListener("scroll", scroll, true); };
  });
</script>

<div class="date-picker" bind:this={host} onfocusout={() => { if (open) requestAnimationFrame(() => { if (!host?.contains(trigger.ownerDocument.activeElement)) close(); }); }}>
  <span class="select-label" id={`${id}-label`}>{label}</span>
  <button bind:this={trigger} type="button" class="select-trigger date-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-calendar`} popovertarget={`${id}-calendar`} onclick={event => { event.preventDefault(); menu.matches(':popover-open') ? close() : void reveal(); }} onkeydown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); void reveal(); } }}>
    <span id={`${id}-value`}>{formatDate(value) || "Choose date…"}</span><Icon name="calendar" size={18} />
  </button>
  <div bind:this={menu} id={`${id}-calendar`} class="date-popover" popover="auto" role="dialog" aria-label={`${label} calendar`} style={placement} ontoggle={event => { open = event.currentTarget.matches(':popover-open'); }} onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}>
    <div class="date-header">
      <button type="button" class="date-previous" aria-label="Previous month" disabled={focused.startsWith('0001-01')} onclick={() => focused = moveMonth(focused, -1)}><Icon name="caretRight" size={16} /></button>
      <Select ariaLabel="Calendar month" value={String(month)} options={monthOptions} onchange={next => focused = moveMonth(focused, Number(next) - month)} />
      <input type="number" aria-label="Calendar year" min="1" max="9999" value={year} onchange={setYear} onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); setYear(event); void focusDay(); } }} />
      <button type="button" aria-label="Next month" disabled={focused.startsWith('9999-12')} onclick={() => focused = moveMonth(focused, 1)}><Icon name="caretRight" size={16} /></button>
    </div>
    <span class="sr-only" id={`${id}-month`} aria-live="polite">{heading}</span>
    <table class="date-grid" role="grid" aria-labelledby={`${id}-month`} onkeydown={gridKey}>
      <thead><tr>{#each ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as day}<th scope="col" aria-label={day}>{day.slice(0, 2)}</th>{/each}</tr></thead>
      <tbody>{#each weeks as week}<tr>{#each week as day}<td role="gridcell" aria-selected={day ? day.value === value : undefined}>{#if day}<button type="button" data-date={day.value} tabindex={day.value === focused ? 0 : -1} aria-label={formatDate(day.value)} aria-current={day.value === today ? 'date' : undefined} onfocus={() => focused = day.value} onclick={() => choose(day.value)}>{day.day}</button>{/if}</td>{/each}</tr>{/each}</tbody>
    </table>
    <div class="date-actions"><button type="button" class="outlined" onclick={() => choose(todayDate())}>Today</button><button type="button" class="outlined" disabled={required || !value} onclick={() => choose('')}>Clear</button></div>
  </div>
</div>
