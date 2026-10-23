export const VALUES_RE = /values:\s*\{[\s\S]*?\n\s*\},\n\}\);/;

function valuesLiteral(source: string) {
  let i = 0;
  let range: [number, number] | undefined;
  const fail = (): never => { throw new Error("Unsupported copy literal; use data-only defineCopy values"); };
  const skip = () => {
    while (true) {
      const match = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(source.slice(i));
      if (!match) break;
      i += match[0].length;
    }
  };
  const take = (text: string) => { skip(); if (!source.startsWith(text, i)) fail(); i += text.length; };
  const string = (): string => {
    const quote = source[i++];
    let value = "";
    while (i < source.length) {
      const char = source[i++];
      if (char === quote) return value;
      if (char === "\n" || char === "\r") fail();
      if (char !== "\\") { value += char; continue; }
      const escape = source[i++];
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "/": "/" };
      if (Object.hasOwn(simple, escape)) value += simple[escape];
      else if (escape === "u" || escape === "x") {
        const length = escape === "u" ? 4 : 2;
        const hex = source.slice(i, i + length);
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) fail();
        value += String.fromCharCode(parseInt(hex, 16)); i += length;
      } else fail();
    }
    return fail();
  };
  const value = (depth = 0): unknown => {
    if (depth > 100) fail();
    skip();
    if (source[i] === '"' || source[i] === "'") return string();
    const opener = source[i];
    if (opener === "{" || opener === "[") {
      i++;
      const object: Record<string, unknown> = {};
      const array: unknown[] = [];
      const end = opener === "{" ? "}" : "]";
      skip();
      while (source[i] !== end) {
        let key = "";
        if (opener === "{") {
          skip();
          if (source[i] === '"' || source[i] === "'") key = string();
          else {
            const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));
            if (!match) fail();
            key = match![0]; i += key.length;
          }
          if (["__proto__", "prototype", "constructor"].includes(key) || Object.hasOwn(object, key)) fail();
          take(":");
        }
        skip(); const start = i;
        const child = value(depth + 1);
        if (opener === "{") object[key] = child; else array.push(child);
        if (depth === 0 && key === "values") range = [start, i];
        skip();
        if (source[i] !== ",") break;
        i++; skip();
      }
      take(end);
      return opener === "{" ? object : array;
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
    if (!match) return fail();
    i += match[0].length;
    const result = JSON.parse(match[0]);
    if (typeof result === "number" && !Number.isFinite(result)) fail();
    return result;
  };
  skip();
  const imported = /^import\s*\{\s*defineCopy\s*\}\s*from\s*(["'])@rigel-cms\/rigel\/content\1\s*;/.exec(source.slice(i));
  if (imported) i += imported[0].length;
  take("export"); take("default"); take("defineCopy"); take("(");
  const page = value();
  take(")"); skip(); if (source[i] === ";") i++; skip();
  if (i !== source.length || !range || !page || typeof page !== "object" || Array.isArray(page)) fail();
  const values = (page as Record<string, unknown>).values;
  if (!values || typeof values !== "object" || Array.isArray(values)) fail();
  return { values: values as Record<string, unknown>, range: range! };
}

export function readValues(source: string): Record<string, unknown> {
  return valuesLiteral(source).values;
}

export function serializeValues(values: Record<string, unknown>): string {
  const groups = Object.entries(values)
    .map(([gid, fields]) => `    ${safeKey(gid)}: ${fmtValue(fields, 3)},`)
    .join("\n");
  return `{\n${groups}\n  }`;
}

export function applyValues(
  source: string,
  values: Record<string, unknown>,
): string {
  const { range: [start, end] } = valuesLiteral(source);
  const literal = serializeValues(values);
  readValues(`export default defineCopy({values:${literal}});`);
  return source.slice(0, start) + literal + source.slice(end);
}

function fmtValue(v: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const items = v.map((x) => `${pad}${inlineObj(x)}`).join(",\n");
    return `[\n${items},\n${"  ".repeat(indent - 1)}]`;
  }
  if (v !== null && typeof v === "object") {
    if (Object.keys(v).length === 0) return "{}";
    const entries = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${pad}${safeKey(k)}: ${fmtValue(x, indent + 1)}`)
      .join(",\n");
    return `{\n${entries},\n${"  ".repeat(indent - 1)}}`;
  }
  return JSON.stringify(v);
}

function inlineObj(v: unknown): string {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${safeKey(k)}: ${JSON.stringify(x)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return JSON.stringify(v);
}

function safeKey(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
}
