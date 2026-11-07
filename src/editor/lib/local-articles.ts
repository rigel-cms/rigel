import { validateBody, type ArticleBody } from "../../article-body";
import { isPlainObject } from "../../schema/validate";
import { translate } from "../i18n";

type Article = { frontmatter: Record<string, unknown>; body: ArticleBody };
const cache = new Map<string, { article: Article; bytes: number }>();
const pending = new Map<string, Promise<Article>>();
let revision = 0;
const key = (collection: string, slug: string) => JSON.stringify([collection, slug]);
export function resetLocalArticles() { revision++; cache.clear(); pending.clear(); }
export function cacheLocalArticle(collection: string, slug: string, article: Article) {
  const id = key(collection, slug), bytes = new TextEncoder().encode(JSON.stringify(article)).byteLength;
  cache.delete(id); cache.set(id, { article: structuredClone(article), bytes });
  let total = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (cache.size > 64 || total > 16 * 1024 * 1024) { const oldest = cache.keys().next().value!; total -= cache.get(oldest)!.bytes; cache.delete(oldest); }
}
export async function readLocalArticle(collection: string, slug: string): Promise<Article> {
  const id = key(collection, slug), cached = cache.get(id);
  if (cached) { cache.delete(id); cache.set(id, cached); return structuredClone(cached.article); }
  if (pending.has(id)) return pending.get(id)!;
  const started = revision;
  const task = (async () => {
    const response = await fetch(`/rigel/api/local/${encodeURIComponent(collection)}/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    if (started !== revision) throw new Error(translate("connection.reloadContent"));
    if (!isPlainObject(data) || !isPlainObject(data.frontmatter)) throw new Error(translate("connection.invalidArticle"));
    validateBody(data.body, translate);
    const article = data as Article;
    cacheLocalArticle(collection, slug, article);
    return structuredClone(article);
  })();
  pending.set(id, task);
  try { return await task; } finally { if (pending.get(id) === task) pending.delete(id); }
}
