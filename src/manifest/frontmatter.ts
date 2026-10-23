type MarkdownPost = { slug: string; frontmatter: Record<string, unknown>; body: string };

export function parseFrontmatter(raw: string): MarkdownPost {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm = m ? parseYamlFlat(m[1]) : {};
  const body = m ? m[2] : raw;
  return {
    slug: String(fm.slug ?? ""),
    frontmatter: fm,
    body: body.replace(/\r\n/g, "\n"),
  };
}

export function serializeFrontmatter(post: MarkdownPost): string {
  const lines = Object.entries(post.frontmatter).map(([k, v]) => {
    if (Array.isArray(v))
      return `${k}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
    if (typeof v === "boolean") return `${k}: ${v}`;
    return `${k}: ${JSON.stringify(String(v))}`;
  });
  return `---\n${lines.join("\n")}\n---\n${post.body.replace(/\n+$/, "")}\n`;
}

function parseYamlFlat(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of src.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let v: unknown = line.slice(i + 1).trim();
    if (typeof v === "string" && v.startsWith("[") && v.endsWith("]")) {
      v = v
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else if (v === "true" || v === "false") {
      v = v === "true";
    } else {
      v = unquote(v as string);
    }
    out[key] = v;
  }
  return out;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
