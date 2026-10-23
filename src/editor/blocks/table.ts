import { $createTableNodeWithDimensions } from "@lexical/table";

export function create() {
  return $createTableNodeWithDimensions(3, 3, { rows: true, columns: false });
}
