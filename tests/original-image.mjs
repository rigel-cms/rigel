import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { build, createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(root, "_temp/original-image");
const consumer = path.join(scratch, "consumer");
const harness = path.join(scratch, "harness");

function png(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b;
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const page = {
  hero: { image: "/images/cover.png", alt: "Saved description", href: "/gallery/" },
  secondary: { image: "/images/second.png" },
  legacy: { image: "/images/alternate.png" },
  unsafe: { image: "/images/second.png" },
  sections: [{ _key: "k1", _type: "feature", image: "/images/cover.png" }],
};

const astroPage = `---
import { Image, Picture } from "astro:assets";
import cover from "../assets/cover.png";
import alternate from "../assets/alternate.png";
import content from "../content/page.json";
const { hero, secondary, legacy, unsafe, sections } = content;
const assets = { "/images/cover.png": cover, "/images/alternate.png": alternate };
const heroAsset = assets[hero.image] ?? cover;
---
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Original image fixture</title><style>body{margin:0;font:16px/1.5 sans-serif}main{max-width:720px}</style></head>
<body>
<main data-rigel-doc="page:hero">
  <a id="hero-link" href={hero.href} data-rigel-href="hero.href" data-rigel-doc="page:hero">
    <Image id="hero" src={heroAsset} alt={hero.alt} widths={[32, 64]} sizes="100vw" data-rigel-image="hero.image" data-rigel-alt="hero.alt" data-rigel-src={hero.image} />
  </a>
  <Picture id="hero-picture" src={heroAsset} formats={["avif", "webp"]} alt={hero.alt} data-rigel-image="hero.image" data-rigel-src={hero.image} />
  <Image id="secondary" src={cover} alt="" data-rigel-image="secondary.image" data-rigel-src={secondary.image} />
  <img id="legacy" src="/images/second.png" srcset="/images/cover.png 1x" alt="Legacy image" width="64" height="48" data-rigel-image="legacy.image" />
  <img id="unsafe" src="/images/second.png" srcset="/images/second.png 1x" alt="" width="40" height="30" data-rigel-image="unsafe.image" data-rigel-src="javascript:alert(1)" />
  <img id="decorative" src="/images/second.png" alt="" width="40" height="30" />
  <div data-rigel-doc="page:other"><img id="other" src="/images/cover.png" alt="Other document image" width="40" height="30" data-rigel-image="image" data-rigel-doc="page:other" data-rigel-src="/images/second.png" /></div>
  <div data-rigel-each="sections" data-rigel-doc="page:hero">
    {sections.map((section) => (
      <section data-rigel-section={section._type} data-rigel-key={section._key} data-rigel-doc="page:hero">
        <img data-rigel-image={\`sections.\${section._key}.image\`} data-rigel-doc="page:hero" data-rigel-src="/images/cover.png" src="/images/cover.png" srcset="/images/cover.png 1x" alt="" width="40" height="30" />
      </section>
    ))}
    <template data-rigel-item-template="feature">
      <section data-rigel-section="feature" data-rigel-key="__item__" data-rigel-doc="page:hero">
        <img data-rigel-image="sections.__item__.image" data-rigel-doc="page:hero" data-rigel-src="/images/cover.png" src="/images/cover.png" srcset="/images/cover.png 1x" alt="" width="40" height="30" />
      </section>
    </template>
  </div>
</main>
</body>
</html>
`;

await rm(scratch, { recursive: true, force: true });
await mkdir(path.join(consumer, "src/assets"), { recursive: true });
await mkdir(path.join(consumer, "src/pages"), { recursive: true });
await mkdir(path.join(consumer, "src/content"), { recursive: true });
await mkdir(path.join(consumer, "public/images"), { recursive: true });
await mkdir(path.join(harness, "src"), { recursive: true });
await writeFile(path.join(consumer, "astro.config.mjs"), 'import { defineConfig } from "astro/config";\nexport default defineConfig({});\n');
await writeFile(path.join(consumer, "src/pages/index.astro"), astroPage);
await writeFile(path.join(consumer, "src/content/page.json"), JSON.stringify(page, null, 2) + "\n");
for (const [file, width, height, rgb] of [
  ["src/assets/cover.png", 64, 48, [255, 0, 0]],
  ["src/assets/alternate.png", 80, 60, [0, 0, 255]],
  ["public/images/cover.png", 64, 48, [255, 0, 0]],
  ["public/images/second.png", 40, 30, [0, 128, 0]],
  ["public/images/alternate.png", 80, 60, [0, 0, 255]],
]) {
  await mkdir(path.dirname(path.join(consumer, file)), { recursive: true });
  await writeFile(path.join(consumer, file), png(width, height, rgb));
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 200; i++) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error("Timed out: " + label);
}
function astroBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, "node_modules/.bin/astro"), ["build"], { cwd: consumer, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", chunk => (log += chunk));
    child.stderr.on("data", chunk => (log += chunk));
    child.on("exit", code => (code === 0 ? resolve(log) : reject(new Error(log))));
  });
}

const checks = [];
function ok(condition, label) {
  assert.equal(condition, true, label);
  checks.push(label);
}

const dictionaries = { en: {} };
for (const file of await readdir(path.join(root, "src/editor/i18n/en"))) if (file.endsWith(".json")) Object.assign(dictionaries.en, JSON.parse(await readFile(path.join(root, "src/editor/i18n/en", file), "utf8")));
const virtual = {
  name: "original-image-config",
  resolveId: id => (id.startsWith("virtual:rigel-") ? "\0" + id : undefined),
  load(id) {
    if (!id.startsWith("\0virtual:rigel-")) return undefined;
    if (id.endsWith("config")) return "export default " + JSON.stringify({ backend: "local", languages: ["en"], defaultLanguage: "en", maxFileSize: 2097152 });
    if (id.endsWith("i18n")) return "export default " + JSON.stringify(dictionaries);
    if (id.endsWith("extensions")) return "export default []";
    return "export default {}";
  },
};
const options = {
  configFile: false,
  root: harness,
  publicDir: false,
  logLevel: "error",
  plugins: [virtual, svelte()],
  resolve: { alias: { "/src": path.join(root, "src"), "/tests": path.join(root, "tests") }, dedupe: ["svelte"] },
  build: { outDir: path.join(harness, "dist"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
};

let vite, chrome, ws;
const exceptions = [];
try {
  const buildLog = await astroBuild();
  await writeFile(path.join(scratch, "astro-build-a.log"), buildLog);
  const builtA = await readFile(path.join(consumer, "dist/index.html"), "utf8");

  ok(/data-rigel-image="hero\.image"/.test(builtA), "built HTML keeps the field binding");
  ok(/data-rigel-src="\/images\/cover\.png"/.test(builtA), "built HTML keeps the original source metadata");
  ok(/data-rigel-alt="hero\.alt"/.test(builtA), "built HTML keeps the alt binding");
  ok(/<img[^>]+src="\/_astro\/[^"]+"[^>]+srcset="[^"]*32w[^"]*64w[^"]*"/.test(builtA), "built Image keeps a hashed src and two responsive candidates");
  ok(/<picture[^>]*><source srcset="\/_astro\/[^"]+\.avif" type="image\/avif"><source srcset="\/_astro\/[^"]+\.webp" type="image\/webp">/.test(builtA), "built Picture keeps AVIF and WebP sources");
  ok(/width="64" height="48"/.test(builtA), "built Image keeps layout dimensions");
  ok(/data-rigel-image="sections\.__item__\.image"/.test(builtA), "built template keeps the item image binding");
  ok(/id="decorative" src="\/images\/second\.png" alt="" width="40" height="30"/.test(builtA), "decorative image stays unbound");

  await writeFile(path.join(harness, "index.html"), '<!doctype html><html data-theme="light"><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
  await writeFile(path.join(harness, "main.js"), `import { mount } from 'svelte'; import App from '/tests/fixtures/original-image.svelte'; import '/src/editor/styles.css'; mount(App, {target: document.getElementById('app')});`);
  await build(options);
  await cp(path.join(consumer, "dist/index.html"), path.join(harness, "dist/preview.html"));
  await cp(path.join(consumer, "dist/_astro"), path.join(harness, "dist/_astro"), { recursive: true, force: true });
  await cp(path.join(consumer, "dist/images"), path.join(harness, "dist/images"), { recursive: true, force: true });

  vite = await createServer({ ...options, root: path.join(harness, "dist"), plugins: [] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const port = await until(async () => { try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return false; } }, "Chrome");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  async function evaluate(expression) {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const wait = (expression, label) => until(() => evaluate(expression), label);
  const frame = "document.querySelector('iframe').contentDocument";
  const hero = `${frame}.querySelector('#hero')`;
  async function shown(selector) {
    return evaluate(`(async()=>{const img=${selector}; if(!img||!img.complete||!img.currentSrc) return null; const probe=new Image(); probe.src=img.currentSrc; await probe.decode().catch(()=>{}); const canvas=document.createElement('canvas'); canvas.width=canvas.height=1; const context=canvas.getContext('2d'); context.drawImage(img,0,0,1,1); const color=[...context.getImageData(0,0,1,1).data].slice(0,3).join(','); return {file:img.currentSrc.split('/').pop(), width:probe.naturalWidth, height:probe.naturalHeight, color};})()`);
  }
  const shows = async (selector, expected, label) => ok(JSON.stringify(await shown(selector)) === JSON.stringify(expected), label);
  const showsSoon = (selector, file, label) => until(async () => (await shown(selector))?.file === file, label);
  async function check(expression, label) {
    const result = await evaluate(expression);
    if (!result) console.error(label, await evaluate(`(()=>{const a=document.querySelector('#draft').textContent, b=window.__rigel.initial(); return {a:a.length, b:b.length, same:a===b, tailA:a.slice(-30), tailB:b.slice(-30), types:[typeof a, typeof b]};})()`));
    ok(result, label);
  }

  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: origin });
  await wait(`!!document.querySelector('iframe.revealed') && !!${frame}.querySelector('#hero')`, "preview ready");
  await showsSoon(hero, "cover.png", "hero preview shows the original file");

  await shows(hero, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "annotated image decodes to the original bytes, not the optimized candidate");
  await check(`!${hero}.hasAttribute('srcset') && !${hero}.hasAttribute('sizes')`, "annotated image drops the overriding candidates");
  await check(`${hero}.getAttribute('alt') === 'Saved description'`, "alt binding still applies");
  await check(`(()=>{const img=${frame}.querySelector('#hero-picture'); return !!img.closest('picture') && [...img.closest('picture').querySelectorAll('source')].every(s => !s.hasAttribute('srcset'));})()`, "picture sources lose their candidates");
  await shows(`${frame}.querySelector('#hero-picture')`, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "picture img decodes to the original bytes");
  await shows(`${frame}.querySelector('#secondary')`, { file: "second.png", width: 40, height: 30, color: "0,128,0" }, "second annotated image uses its own field value");
  await shows(`${frame}.querySelector('#legacy')`, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "unannotated legacy image keeps its previous srcset behavior");
  await check(`${frame}.querySelector('#legacy').hasAttribute('srcset') && ${frame}.querySelector('#legacy').getAttribute('src') === '/images/alternate.png'`, "unannotated legacy markup is patched as before");
  await shows(`${frame}.querySelector('#unsafe')`, { file: "second.png", width: 40, height: 30, color: "0,128,0" }, "an unsafe metadata value is never loaded");
  await check(`${frame}.querySelector('#decorative').getAttribute('src') === '/images/second.png'`, "decorative image is untouched");
  await shows(`${frame}.querySelector('#other')`, { file: "second.png", width: 40, height: 30, color: "0,128,0" }, "second document image uses its own values");
  await shows(`${frame}.querySelector('[data-rigel-key="k1"] img')`, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "repeated section image uses its own path");
  await check(`!${frame}.querySelector('[data-rigel-key="k1"] img').hasAttribute('srcset')`, "repeated section image drops candidates too");

  await check(`document.querySelector('#draft').textContent === document.querySelector('#saved').textContent`, "opening the preview changes no content");
  await check(`document.querySelector('#draft').textContent === window.__rigel.initial()`, "draft still holds the canonical original reference");

  await evaluate(`${frame}.querySelector('#hero').click()`);
  await wait(`!!document.querySelector('.section-properties .image-field')`, "properties panel for the image field");
  await check(`document.querySelector('.section-properties .image-field img.preview').getAttribute('src') === '/images/cover.png'`, "image field preview uses the content value, not a hashed URL");
  await evaluate(`document.querySelector('.section-properties .image-field button').click()`);
  await wait(`!!document.querySelector('dialog[open]')`, "image picker opened");
  await evaluate(`document.querySelector('dialog[open] [data-source="url"]').click()`);
  await wait(`!!document.querySelector('dialog[open] input[type=url]')`, "picker URL tab");
  const pickerValue = await evaluate(`document.querySelector('dialog[open] input[type=url]').value`);
  ok(pickerValue === "/images/cover.png", "picker initializes with the original URL");
  await evaluate(`(()=>{const input=document.querySelector('dialog[open] input[type=url]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'javascript:alert(1)'); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Use this URL').click()`);
  await wait(`!!document.querySelector('dialog[open] [role=alert]')`, "unsafe URL rejected by the picker");
  await check(`document.querySelector('#draft').textContent === window.__rigel.initial()`, "rejected URL never reaches the draft");
  await evaluate(`document.querySelector('dialog[open] button[aria-label="Close"]').click()`);
  await wait(`!document.querySelector('dialog[open]')`, "picker closed");
  await check(`document.querySelector('#draft').textContent === document.querySelector('#saved').textContent`, "closing the picker does not dirty content");

  const altOnly = structuredClone(page);
  altOnly.hero.alt = "Updated description";
  await evaluate(`window.__rigel.edit(${JSON.stringify(altOnly)})`);
  await check(`${hero}.getAttribute('alt') === 'Updated description'`, "alt-only edit updates the alt");
  await shows(hero, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "alt-only edit keeps the same image");
  await check(`!${hero}.hasAttribute('srcset')`, "alt-only edit keeps optimized candidates disabled");

  const swapped = structuredClone(altOnly);
  swapped.hero.image = "/images/second.png";
  await evaluate(`window.__rigel.edit(${JSON.stringify(swapped)})`);
  await showsSoon(hero, "second.png", "first swap loaded");
  await shows(hero, { file: "second.png", width: 40, height: 30, color: "0,128,0" }, "first draft swap decodes to the replacement bytes");
  await shows(`${frame}.querySelector('#hero-picture')`, { file: "second.png", width: 40, height: 30, color: "0,128,0" }, "first draft swap also reaches the picture");
  await shows(`${frame}.querySelector('#secondary')`, { file: "second.png", width: 40, height: 30, color: "0,128,0" }, "swapping one image leaves the other alone");

  const swappedAgain = structuredClone(swapped);
  swappedAgain.hero.image = "/images/alternate.png";
  await evaluate(`window.__rigel.edit(${JSON.stringify(swappedAgain)})`);
  await showsSoon(hero, "alternate.png", "second swap loaded");
  await shows(hero, { file: "alternate.png", width: 80, height: 60, color: "0,0,255" }, "second draft swap decodes to the second replacement bytes");
  await check(`!${hero}.currentSrc.includes('_astro')`, "no generated hash is ever requested in preview");

  await evaluate(`window.__rigel.edit(${JSON.stringify(altOnly)})`);
  await showsSoon(hero, "cover.png", "revert loaded");
  await shows(hero, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "reverting the draft shows the original bytes again");

  await evaluate(`document.querySelector('#save').click()`);
  const savedValues = JSON.parse(await evaluate(`document.querySelector('#saved').textContent`));
  ok(savedValues.hero.image === "/images/cover.png" && savedValues.hero.alt === "Updated description", "Save keeps the original reference and the alt edit");
  ok(!JSON.stringify(savedValues).includes("_astro"), "Save payload contains no generated hash");

  const unsafeValues = structuredClone(swappedAgain);
  unsafeValues.unsafe.image = "javascript:alert(1)";
  await evaluate(`window.__rigel.edit(${JSON.stringify(unsafeValues)})`);
  await check(`(()=>{const el=${frame}.querySelector('#unsafe'); return !el.hasAttribute('src') && !el.hasAttribute('srcset') && !el.currentSrc;})()`, "unsafe draft value loads nothing");
  unsafeValues.unsafe.image = "";
  await evaluate(`window.__rigel.edit(${JSON.stringify(unsafeValues)})`);
  await check(`(()=>{const el=${frame}.querySelector('#unsafe'); return !el.hasAttribute('src') && !el.hasAttribute('srcset');})()`, "blank draft value renders no source");

  const grown = structuredClone(unsafeValues);
  grown.unsafe.image = "/images/second.png";
  grown.sections = [...page.sections, { _key: "k2", _type: "feature", image: "/images/alternate.png" }];
  await evaluate(`window.__rigel.edit(${JSON.stringify(grown)})`);
  await wait(`${frame}.querySelectorAll('[data-rigel-key]').length === 2`, "cloned section rendered");
  await shows(`${frame}.querySelector('[data-rigel-key="k2"] img')`, { file: "alternate.png", width: 80, height: 60, color: "0,0,255" }, "cloned template image follows its own field");
  await check(`!${frame}.querySelector('[data-rigel-key="k2"] img').hasAttribute('srcset')`, "cloned template image drops candidates");
  await shows(`${frame}.querySelector('[data-rigel-key="k1"] img')`, { file: "cover.png", width: 64, height: 48, color: "255,0,0" }, "existing section image keeps its own value");

  await evaluate(`[...document.querySelectorAll('.mode-toggle button')].find(b => b.textContent.trim() === 'Browse').click()`);
  await shows(hero, { file: "alternate.png", width: 80, height: 60, color: "0,0,255" }, "browse mode keeps the draft image visible");

  // Rebuild the consumer with updated content: hash changes, metadata follows, content stays hash-free.
  await writeFile(path.join(consumer, "src/content/page.json"), JSON.stringify({ ...page, hero: { ...page.hero, image: "/images/alternate.png" } }, null, 2) + "\n");
  const rebuildLog = await astroBuild();
  await writeFile(path.join(scratch, "astro-build-b.log"), rebuildLog);
  const builtB = await readFile(path.join(consumer, "dist/index.html"), "utf8");
  const heroSrc = html => /<img[^>]*id="hero"[^>]*>/.exec(html)?.[0].match(/src="([^"]+)"/)?.[1];
  const heroSrcA = heroSrc(builtA);
  const heroSrcB = heroSrc(builtB);
  ok(!!heroSrcA && !!heroSrcB && heroSrcA !== heroSrcB, "rebuild produces a new hashed optimized source");
  ok(/data-rigel-src="\/images\/alternate\.png"/.test(builtB), "rebuild carries the updated original metadata");
  ok(/\ssrcset="[^"]*32w[^"]*64w[^"]*"/.test(builtB), "rebuild still renders responsive candidates");
  const savedContent = await readFile(path.join(consumer, "src/content/page.json"), "utf8");
  ok(!savedContent.includes("_astro"), "saved content holds no generated hash");

  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks: checks.length, heroSrcA, heroSrcB, result: "PASS (real Astro build + Rigel preview)" }));
} finally {
  ws?.close();
  chrome?.kill();
  await vite?.close();
}
