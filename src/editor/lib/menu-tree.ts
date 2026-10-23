import type { MenuItem } from "../../manifest/menu";

export function menuRows(items: MenuItem[], parentId: string | null = null, depth = 1): { item: MenuItem; parentId: string | null; depth: number; previous?: string; next?: string }[] {
  return items.flatMap((item, index) => [
    { item, parentId, depth, previous: items[index - 1]?.id, next: items[index + 1]?.id },
    ...menuRows(item.children, item.id, depth + 1),
  ]);
}

export function editMenuItem(items: MenuItem[], id: string, update: (item: MenuItem) => MenuItem | null): MenuItem[] {
  return items.flatMap((item) => {
    if (item.id === id) { const next = update(item); return next ? [next] : []; }
    return [{ ...item, children: editMenuItem(item.children, id, update) }];
  });
}

export function moveMenuItem(items: MenuItem[], id: string, targetId: string | null, position: "before" | "after" | "inside", maxDepth: number): MenuItem[] {
  const source = menuRows(items).find((row) => row.item.id === id)?.item;
  if (!source) throw new Error("Menu item not found");
  if (targetId && menuRows([source]).some((row) => row.item.id === targetId)) throw new Error("An item cannot be moved into itself or its children");
  const next = editMenuItem(items, id, () => null);
  let found = targetId === null;
  function insert(list: MenuItem[]): MenuItem[] {
    return list.flatMap((item) => {
      if (item.id === targetId) {
        found = true;
        if (position === "inside") return [{ ...item, children: [...item.children, source!] }];
        return position === "before" ? [source!, item] : [item, source!];
      }
      return [{ ...item, children: insert(item.children) }];
    });
  }
  const result = targetId === null ? [...next, source] : insert(next);
  if (!found) throw new Error("Drop target no longer exists");
  if (menuRows(result).some((row) => row.depth > maxDepth)) throw new Error(`This move exceeds the ${maxDepth}-level limit`);
  return result;
}
