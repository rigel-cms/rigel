export function createCopyStore<T>(initial: T) {
  let snapshot = JSON.stringify(initial);
  let draft = $state<T>(initial);

  const dirty = $derived(JSON.stringify(draft) !== snapshot);

  function touch(next: T) {
    draft = next;
  }

  function commit() {
    snapshot = JSON.stringify(draft);
  }

  function reset(next: T) {
    snapshot = JSON.stringify(next);
    draft = next;
  }

  return {
    get draft() {
      return draft;
    },
    get dirty() {
      return dirty;
    },
    touch,
    commit,
    reset,
  };
}

export type CopyStore<T> = ReturnType<typeof createCopyStore<T>>;
