import { afterEach, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { toasts, createToast, updateToast, dismissToast, resetToasts, pauseToast } from "./toasts";

afterEach(() => { resetToasts(); vi.useRealTimers(); });
it("creates, updates and dismisses the same notification", () => {
  const id = createToast({ kind: "progress", message: "Uploading 2 files" });
  updateToast(id, { message: "1 of 2 completed" });
  expect(get(toasts)).toEqual([expect.objectContaining({ id, kind: "progress", message: "1 of 2 completed" })]);
  dismissToast(id);
  expect(get(toasts)).toEqual([]);
});
it("expires only transient notices and pauses their remaining time", () => {
  vi.useFakeTimers();
  const transient = createToast({ kind: "success", message: "Stored" });
  const progress = createToast({ kind: "progress", message: "Uploading" });
  const error = createToast({ kind: "error", message: "Retry", ondismiss: vi.fn() });
  vi.advanceTimersByTime(2000);
  pauseToast(transient, true);
  vi.advanceTimersByTime(10000);
  expect(get(toasts).map(item => item.id)).toContain(transient);
  pauseToast(transient, false);
  vi.advanceTimersByTime(3999);
  expect(get(toasts).map(item => item.id)).toContain(transient);
  vi.advanceTimersByTime(1);
  expect(get(toasts).map(item => item.id)).toEqual([progress, error]);
  updateToast(progress, { kind: "info", message: "Finished" });
  vi.advanceTimersByTime(6000);
  expect(get(toasts).map(item => item.id)).toEqual([error]);
});
it("keeps a focused progress notification paused when it becomes success", () => {
  vi.useFakeTimers();
  const id = createToast({ kind: "progress", message: "Saving" });
  pauseToast(id, true);
  updateToast(id, { kind: "success", message: "Saved" });
  vi.advanceTimersByTime(10000);
  expect(get(toasts).map(item => item.id)).toEqual([id]);
  pauseToast(id, false);
  vi.advanceTimersByTime(6000);
  expect(get(toasts)).toEqual([]);
});
it("reset cancels timers; dismiss runs its action once and never resurrects entries", () => {
  vi.useFakeTimers();
  const ondismiss = vi.fn();
  const id = createToast({ kind: "error", message: "Failed", ondismiss });
  dismissToast(id); dismissToast(id);
  expect(ondismiss).toHaveBeenCalledTimes(1);
  createToast({ kind: "info", message: "Temporary" });
  resetToasts();
  expect(vi.getTimerCount()).toBe(0);
  updateToast(id, { message: "Too late" });
  expect(get(toasts)).toEqual([]);
});
