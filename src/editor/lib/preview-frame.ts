import { translate } from "../i18n";
import DOMPurify from "dompurify";

export async function fetchPreview(url: URL, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  } catch {
    throw new Error(translate("richtext.previewFetchError"));
  }
  if (!response.ok) throw new Error(translate("richtext.previewHttpError", { status: response.status }));
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error(translate("richtext.previewHtmlError"));
  const root = DOMPurify.sanitize(await response.text(), {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    ADD_TAGS: ["link", "use"],
    FORBID_TAGS: ["script", "base", "meta", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc", "action", "formaction", "autofocus"],
  }) as HTMLElement;
  const symbols = new Map<string, Element | null>();
  for (const element of root.querySelectorAll("[id]")) {
    const id = element.id;
    symbols.set(id, symbols.has(id) || element.localName !== "symbol" || element.namespaceURI !== "http://www.w3.org/2000/svg" ? null : element.cloneNode(true) as Element);
  }
  let remaining = 4096;
  function expand(use: Element, ancestors: string[] = []) {
    const href = use.getAttribute("href") ?? use.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
    const id = /^#[A-Za-z_][\w:.-]*$/.test(href) ? href.slice(1) : "";
    const symbol = symbols.get(id);
    const size = symbol ? symbol.querySelectorAll("*").length + 1 : 0;
    if (!symbol || ancestors.includes(id) || ancestors.length >= 16 || size > remaining) {
      use.remove();
      return;
    }
    remaining -= size;
    const svg = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const source of [symbol, use]) {
      for (const attr of source.attributes) {
        if (!["id", "href", "xlink:href"].includes(attr.name)) svg.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      }
    }
    for (const child of symbol.childNodes) svg.append(child.cloneNode(true));
    for (const element of svg.querySelectorAll("[id]")) element.removeAttribute("id");
    for (const nested of svg.querySelectorAll("use")) expand(nested, [...ancestors, id]);
    use.replaceWith(svg);
  }
  for (const use of root.querySelectorAll("use")) expand(use);
  for (const link of root.querySelectorAll("link")) {
    if (link.getAttribute("rel")?.toLowerCase() !== "stylesheet") link.remove();
  }
  const head = root.querySelector("head")!;
  const base = document.createElement("base"); base.href = url.href;
  const policy = document.createElement("meta"); policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'none'; style-src https: http: 'unsafe-inline'; img-src https: http: data: blob:; font-src https: http: data:; media-src https: http: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri " + url.origin;
  const referrer = document.createElement("meta"); referrer.name = "referrer"; referrer.content = "no-referrer";
  head.prepend(policy, referrer, base);
  return "<!doctype html>" + root.outerHTML;
}
