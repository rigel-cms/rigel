import DOMPurify from "dompurify";

export async function fetchPreview(url: URL, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  } catch {
    throw new Error("Draft preview could not be fetched. Check the URL, HTTPS, CORS (Access-Control-Allow-Origin for this editor), redirects and the editor’s connect-src policy. Authentication cookies are not sent.");
  }
  if (!response.ok) throw new Error(`Draft preview returned HTTP ${response.status}. Check the draft deployment and mapped route.`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("Draft preview did not return HTML. Check the mapped route and Content-Type header.");
  const root = DOMPurify.sanitize(await response.text(), {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    ADD_TAGS: ["link"],
    FORBID_TAGS: ["script", "base", "meta", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcdoc", "action", "formaction", "autofocus"],
  }) as HTMLElement;
  for (const link of root.querySelectorAll("link")) {
    if (link.getAttribute("rel")?.toLowerCase() !== "stylesheet") link.remove();
  }
  const head = root.querySelector("head")!;
  const base = document.createElement("base"); base.href = url.href;
  const policy = document.createElement("meta"); policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'none'; style-src https: http: 'unsafe-inline'; img-src https: http: data: blob:; font-src https: http: data:; media-src https: http:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri " + url.origin;
  const referrer = document.createElement("meta"); referrer.name = "referrer"; referrer.content = "no-referrer";
  head.prepend(policy, referrer, base);
  return "<!doctype html>" + root.outerHTML;
}
