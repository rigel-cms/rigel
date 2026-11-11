import { get, writable } from "svelte/store";

export type Toast = {
  id: number;
  kind: "info" | "progress" | "success" | "error";
  message: string;
  actions?: { label: string; run: () => void; disabled?: boolean }[];
  ondismiss?: () => void;
};
const state = writable<Toast[]>([]);
export const toasts = { subscribe: state.subscribe };
let nextId = 0;
const pausedIds = new Set<number>();
const timers = new Map<number, { handle?: ReturnType<typeof setTimeout>; remaining: number; started: number; paused: boolean }>();
function schedule(id: number, kind: Toast["kind"]) {
  const previous = timers.get(id);
  clearTimeout(previous?.handle);
  timers.delete(id);
  if (kind !== "info" && kind !== "success") return;
  timers.set(id, { remaining: 6000, started: Date.now(), paused: pausedIds.has(id) });
  pauseToast(id, pausedIds.has(id));
}
export function createToast(toast: Omit<Toast, "id">) {
  const id = ++nextId;
  state.update(items => [...items, { ...toast, id }]);
  schedule(id, toast.kind);
  return id;
}
export function updateToast(id: number, patch: Partial<Omit<Toast, "id">>) {
  const item = get(state).find(item => item.id === id);
  if (!item) return;
  state.update(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  if (patch.kind) schedule(id, patch.kind);
}
export function dismissToast(id: number) {
  const item = get(state).find(item => item.id === id);
  clearTimeout(timers.get(id)?.handle);
  timers.delete(id); pausedIds.delete(id);
  state.update(items => items.filter(item => item.id !== id));
  item?.ondismiss?.();
}
export function resetToasts() {
  for (const timer of timers.values()) clearTimeout(timer.handle);
  timers.clear(); pausedIds.clear(); state.set([]);
}
export function pauseToast(id: number, paused: boolean) {
  if (paused) pausedIds.add(id); else pausedIds.delete(id);
  const timer = timers.get(id);
  if (!timer) return;
  clearTimeout(timer.handle);
  if (!timer.paused && timer.handle) timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
  timer.paused = paused; timer.handle = undefined;
  if (!paused) {
    timer.started = Date.now();
    timer.handle = setTimeout(() => dismissToast(id), timer.remaining);
  }
}
