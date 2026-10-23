import { validateBody, type ArticleBody, type ArticleNode } from "./article-body";
import { safePreviewUrl } from "./preview-urls";

const escape = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function renderText(node: ArticleNode): string {
  let text = escape(node.text);
  const format = Number(node.format);
  for (const [bit, tag] of [[16, "code"], [1, "strong"], [2, "em"], [4, "s"], [8, "u"], [32, "sub"], [64, "sup"], [128, "mark"]] as const) if (format & bit) text = `<${tag}>${text}</${tag}>`;
  return text;
}

export function renderArticle(body: ArticleBody): string {
  validateBody(body);
  function walk(node: ArticleNode): string {
    const content = () => (node.children ?? []).map(walk).join("");
    if (node.type === "text") return renderText(node);
    if (node.type === "linebreak") return "<br>";
    if (node.type === "root") return content();
    if (node.type === "paragraph") return `<p>${content()}</p>`;
    if (node.type === "heading") return `<${node.tag}>${content()}</${node.tag}>`;
    if (node.type === "quote") return `<blockquote>${content()}</blockquote>`;
    if (node.type === "code") return `<pre><code>${escape(plain(node))}</code></pre>`;
    if (node.type === "list") return node.listType === "number" ? `<ol start="${node.start ?? 1}">${content()}</ol>` : `<ul>${content()}</ul>`;
    if (node.type === "listitem") return `<li>${content()}</li>`;
    if (node.type === "table") {
      const rows = node.children!;
      const header = rows[0].children!.every(cell => Number(cell.headerState) & 1);
      return `<table>${header ? `<thead>${walk(rows[0])}</thead>` : ""}<tbody>${rows.slice(header ? 1 : 0).map(walk).join("")}</tbody></table>`;
    }
    if (node.type === "tablerow") return `<tr>${content()}</tr>`;
    if (node.type === "tablecell") return Number(node.headerState) ? `<th scope="${Number(node.headerState) & 1 ? "col" : "row"}">${content()}</th>` : `<td>${content()}</td>`;
    if (node.type === "link") return safePreviewUrl(node.url!) ? `<a href="${escape(node.url)}">${content()}</a>` : content();
    if (node.type === "divider") return "<hr>";
    if (node.type === "image") {
      if (!safePreviewUrl(node.src!, true)) return "";
      const credit = node.credit ? (node.creditURL && safePreviewUrl(node.creditURL) ? `<a href="${escape(node.creditURL)}">${escape(node.credit)}</a>` : escape(node.credit)) : "";
      const image = `<img src="${escape(node.src)}" alt="${escape(node.alt)}">`;
      return `<figure>${node.url ? `<a href="${escape(node.url)}">${image}</a>` : image}${credit ? `<figcaption>${credit}</figcaption>` : ""}</figure>`;
    }
    return "";
  }
  return walk(body.root as unknown as ArticleNode);
}

function plain(node: ArticleNode): string {
  return node.type === "text" ? node.text ?? "" : node.type === "linebreak" ? "\n" : (node.children ?? []).map(plain).join("");
}

export function articleMarkdown(body: ArticleBody): string {
  validateBody(body);
  const escaped = (text: string) => text.replace(/[\\`*_[\]<>#~]/g, "\\$&");
  function walk(node: ArticleNode, depth = 0): string {
    const content = () => (node.children ?? []).map(child => walk(child, depth)).join("");
    if (node.type === "text") {
      let text = escaped(node.text ?? "");
      const format = Number(node.format);
      if (format & (8 | 32 | 64 | 128)) return renderText(node);
      if (format & 16) { const ticks = "`".repeat(Math.max(1, ...(node.text?.match(/`+/g) ?? []).map(run => run.length + 1))); text = ticks + " " + (node.text ?? "") + " " + ticks; }
      if (format & 1) text = `**${text}**`;
      if (format & 2) text = `*${text}*`;
      if (format & 4) text = `~~${text}~~`;
      return text;
    }
    if (node.type === "linebreak") return "\n";
    if (node.type === "paragraph") return content() + "\n\n";
    if (node.type === "heading") return "#".repeat(Number(node.tag?.slice(1))) + " " + content() + "\n\n";
    if (node.type === "quote") return content().trimEnd().split("\n").map(line => "> " + line).join("\n") + "\n\n";
    if (node.type === "code") { const text = plain(node); const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map(run => run.length + 1))); return fence + "\n" + text + "\n" + fence + "\n\n"; }
    if (node.type === "list") return (node.children ?? []).map((child, index) => "  ".repeat(depth) + (node.listType === "number" ? `${(node.start ?? 1) + index}. ` : "- ") + walk(child, depth + 1).trimEnd() + "\n").join("") + "\n";
    if (node.type === "table") {
      const rows = node.children!;
      const row = (cells: ArticleNode[]) => "| " + cells.map(cell => walk(cell).trim().replace(/\|/g, "\\|").replace(/\n+/g, "<br>")).join(" | ") + " |\n";
      const header = rows[0].children!.every(cell => Number(cell.headerState) & 1);
      return (header ? row(rows[0].children!) : "| " + rows[0].children!.map(() => " ").join(" | ") + " |\n") + "| " + rows[0].children!.map(() => "---").join(" | ") + " |\n" + rows.slice(header ? 1 : 0).map(item => row(item.children!)).join("") + "\n";
    }
    if (node.type === "link") return safePreviewUrl(node.url!) ? `[${content()}](<${node.url!.replace(/[<>]/g, character => encodeURIComponent(character))}>)` : content();
    if (node.type === "image") {
      if (!safePreviewUrl(node.src!, true)) return "";
      const image = `![${escaped(node.alt ?? "")}](<${node.src!.replace(/[<>]/g, character => encodeURIComponent(character))}>)`;
      return (node.url ? `[${image}](<${node.url.replace(/[<>]/g, character => encodeURIComponent(character))}>)` : image) + "\n\n";
    }
    if (node.type === "divider") return "---\n\n";
    return content();
  }
  return walk(body.root as unknown as ArticleNode).trimEnd() + "\n";
}
