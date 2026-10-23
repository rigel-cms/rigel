export function slugify(input: string, existingSlugs: Iterable<string> = []): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining marks → strip (é→e)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!base) return "";
  const existing = new Set(existingSlugs);
  let slug = base;
  for (let suffix = 2; existing.has(slug); suffix++) slug = `${base}-${suffix}`;
  return slug;
}
