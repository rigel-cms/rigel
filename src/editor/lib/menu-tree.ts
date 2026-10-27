import type { MenuItem } from "../../manifest/menu";
import { translate } from "../i18n";

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
  if (!source) throw new Error(translate("fields.menuItemNotFound"));
  if (targetId && menuRows([source]).some((row) => row.item.id === targetId)) throw new Error(translate("fields.menuMoveIntoSelf"));
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
  if (!found) throw new Error(translate("fields.menuDropTargetMissing"));
  if (menuRows(result).some((row) => row.depth > maxDepth)) throw new Error(translate("fields.menuMoveDepthLimit", { maxDepth }));
  return result;
}
