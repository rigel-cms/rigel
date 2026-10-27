import { expect, test } from "vitest";
import { slashCommand } from "./slash-command";

test("slash commands accept Unicode letters, combining marks and numbers", () => {
  for (const command of ["", "Heading 2", "Заголовок", "Vídeo", "Élément", "E\u0301le\u0301ment", "标题２", "code_block"]) {
    expect(`/${command}`.match(slashCommand)?.[1]).toBe(command);
  }
  for (const text of ["text/heading", "/heading/", "/heading\nmore", "/<script>", "/😀"]) {
    expect(text.match(slashCommand)).toBeNull();
  }
});
