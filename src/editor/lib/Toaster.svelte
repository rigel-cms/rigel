<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import { toasts, dismissToast, pauseToast, resetToasts } from "./toasts";
  let host: HTMLDivElement;
  onMount(() => {
    const parent = host.parentElement!;
    function place() {
      const dialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter(dialog => dialog.matches(":modal"));
      const target = dialogs.at(-1) ?? parent;
      if (host.parentElement !== target) { host.hidePopover(); target.append(host); }
      if (host.childElementCount && !host.matches(":popover-open")) host.showPopover();
      if (!host.childElementCount && host.matches(":popover-open")) host.hidePopover();
    }
    const observer = new MutationObserver(place);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    place();
    return () => { observer.disconnect(); host.hidePopover(); parent.append(host); resetToasts(); };
  });
  function pause(node: HTMLElement, id: number) {
    let hovered = false;
    const sync = () => pauseToast(id, hovered || node.contains(document.activeElement));
    const enter = () => { hovered = true; sync(); };
    const leave = () => { hovered = false; sync(); };
    const blur = () => queueMicrotask(sync);
    node.addEventListener("pointerenter", enter); node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", sync); node.addEventListener("focusout", blur);
    return { destroy() {
      node.removeEventListener("pointerenter", enter); node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", sync); node.removeEventListener("focusout", blur);
    } };
  }
</script>

<div class="toast-stack" popover="manual" bind:this={host}>
  {#each $toasts as toast (toast.id)}
    <div class="toast" data-kind={toast.kind} data-toast-id={toast.id} use:pause={toast.id}>
      <div class="toast-content">
        <p role={toast.kind === "error" ? "alert" : "status"} aria-atomic="true">{toast.message}</p>
        {#if toast.actions?.length}<div class="toast-actions">{#each toast.actions as action}<button type="button" class="outlined" disabled={action.disabled} onclick={action.run}>{action.label}</button>{/each}</div>{/if}
      </div>
      <button type="button" class="outlined icon-only" aria-label={$t("media.close")} onclick={() => dismissToast(toast.id)}><Icon name="x" size={16} /></button>
    </div>
  {/each}
</div>

<style>
  .toast-stack { position: fixed; inset: auto auto max(1rem, env(safe-area-inset-bottom)) 50%; transform: translateX(-50%); width: min(34rem, calc(100% - 2rem)); max-height: min(40dvh, 22rem); margin: 0; padding: 0; border: 0; background: transparent; color: var(--text); overflow: auto; overscroll-behavior: contain; pointer-events: none; }
  .toast-stack::backdrop { pointer-events: none; }
  .toast { display: flex; align-items: flex-start; gap: .75rem; padding: .75rem; border: 1px solid var(--border-control); background: var(--panel); color: var(--text); pointer-events: auto; }
  .toast + .toast { margin-top: .5rem; }
  .toast[data-kind="success"] { border-color: var(--success); }
  .toast[data-kind="error"] { border-color: var(--danger); }
  .toast-content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .toast-content p { margin: 0; font-size: .875rem; white-space: pre-line; }
  .toast-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
</style>
