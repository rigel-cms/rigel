import { $createListNode, $createListItemNode } from "@lexical/list";
export const create = () => $createListNode("bullet").append($createListItemNode());
