export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  let html = "";
  let inCode = false;
  let inList = false;
  let para: string[] = [];

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const flushPara = () => {
    if (para.length) {
      html += `<p>${para.map(inline).join(" ")}</p>`;
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      html += inCode ? "</code></pre>" : "<pre><code>";
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html += esc(raw) + "\n";
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flushPara();
      closeList();
      const level = line.match(/^#+/)![0].length;
      html += `<h${level}>${inline(line.replace(/^#+\s*/, ""))}</h${level}>`;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`;
      continue;
    }
    if (line === "") {
      flushPara();
      closeList();
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeList();
  if (inCode) html += "</code></pre>";
  return html;
}
