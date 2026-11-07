import { expect, test, vi, afterEach } from "vitest";
import { readLocalArticle, cacheLocalArticle, resetLocalArticles } from "./local-articles";
import { emptyBody } from "../../article-body";

afterEach(() => { vi.unstubAllGlobals(); resetLocalArticles(); });
test("local selection shares downloads and preserves verified saves until refresh", async () => {
  const article = { frontmatter: { title: "Original" }, body: emptyBody() };
  const request = vi.fn(async () => Response.json(article)); vi.stubGlobal("fetch", request);
  await Promise.all([readLocalArticle("blog", "hello"), readLocalArticle("blog", "hello")]);
  expect(request).toHaveBeenCalledTimes(1);
  cacheLocalArticle("blog", "hello", { ...article, frontmatter: { title: "Saved" } });
  expect((await readLocalArticle("blog", "hello")).frontmatter.title).toBe("Saved");
  resetLocalArticles();
  expect((await readLocalArticle("blog", "hello")).frontmatter.title).toBe("Original");
  expect(request).toHaveBeenCalledTimes(2);
});
