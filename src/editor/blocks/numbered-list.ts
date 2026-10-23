import { $createListNode, $createListItemNode } from "@lexical/list";
export const create = () => $createListNode("number").append($createListItemNode());
