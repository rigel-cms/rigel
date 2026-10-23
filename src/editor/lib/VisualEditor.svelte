<script lang="ts">
  import { mount, unmount, onDestroy, tick, type Snippet } from "svelte";
  import BlockEditor from "./BlockEditor.svelte";
  import editorStyles from "../styles.css?inline";
  import type { ArticleBody } from "../../article-body";
  import { patchPreview } from "../../preview";
  import { anchorValue } from "../../preview";
  import SchemaPanel from "./SchemaPanel.svelte";
  import SidebarIcon from "./SidebarIcon.svelte";
  import Icon from "./Icon.svelte";
  import PreviewFrame from "./PreviewFrame.svelte";
  import { fieldForPath, replaceAt, type SelectedField } from "./schema-edit";
  import type { ContentDocument, DocumentDef, Schema } from "../../schema/types";

  let {
    docId, schema, docType, values, previewValues, documents = {}, previewPath, livePath = previewPath, body = "", bodyInline = false, onbody = () => {}, properties, creating, devMode, reloadToken = 0, onchange, oneditdocument = () => {},
  }: {
    docId: string;
    schema?: Schema;
    docType?: DocumentDef;
    values: Record<string, unknown>;
    previewValues?: Record<string, unknown>;
    documents?: Record<string, Record<string, unknown>>;
    previewPath: string | null;
    livePath?: string | null;
    body?: "" | import("../../article-body").ArticleBody;
    properties?: Snippet<[SelectedField | null, number, boolean, () => void]>;
    bodyInline?: boolean;
    onbody?: (body: ArticleBody) => void;
    creating: boolean;
    devMode: boolean;
    reloadToken?: number;
    onchange: (next: Record<string, unknown>) => void;
    oneditdocument?: (id: string) => void;
  } = $props();

  let frame: HTMLIFrameElement | undefined = $state();
  let stage: HTMLDivElement;
  let loaded = $state(false);
  let bodyAvailable = $state(false);
  const inlineBodyEnabled = $derived(bodyInline && loaded && bodyAvailable);
  let bodyEditor: ReturnType<typeof mount> | undefined;
  let bodyThemeObserver: MutationObserver | undefined;
  let editingBody: HTMLElement | null = null;
  let bodyContents: ChildNode[] = [];
  let bodyAttributes: [string, string | null][] = [];
  let bodyScope: HTMLElement | null = null;
  let error = $state("");
  let mode = $state<"browse" | "edit">("edit");
  let panelOpen = $state(true);
  let editorWidth = $state(0);
  let requestedWidth = $state(340);
  let resizing = $state(false);
  let resizePointer: { element: HTMLElement; id: number } | null = null;
  const panelMax = $derived(Math.max(280, Math.min(640, editorWidth - 328)));
  const panelWidth = $derived(Math.max(280, Math.min(panelMax, requestedWidth)));
  let selected = $state<SelectedField | null>(null);
  let pending = $state<string[]>([]);
  let focusToken = $state(0);
  let highlighted: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let structureSignature = "";
  let inline = $state<{ path: string; value: string; original: string; left: number; top: number; width: number; height: number; fontSize: string } | null>(null);
  let inlineInput: HTMLInputElement | undefined = $state();
  const documentList = $derived(Object.entries(documents).map(([id, data]) => ({
    id,
    type: id.slice(0, id.indexOf(":")),
    slug: id.slice(id.indexOf(":") + 1),
    data,
  })) as ContentDocument[]);

  function docElement(): Document | null {
    try {
      return frame?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  function clearHighlight() {
    highlighted?.style.removeProperty("outline");
    highlighted?.style.removeProperty("outline-offset");
    highlighted = null;
  }

  function clearHover() {
    if (hovered && hovered !== highlighted) hovered.style.removeProperty("outline");
    hovered = null;
  }

  function anchorSelector(path: string) {
    const escaped = CSS.escape(path);
    return `[data-rigel-text="${escaped}"],[data-rigel-richtext="${escaped}"],[data-rigel-image="${escaped}"],[data-rigel-alt="${escaped}"],[data-rigel-href="${escaped}"]`;
  }

  function applySelection(scroll = false) {
    const doc = docElement();
    if (!doc || !selected) return;
    clearHighlight();
    let element: HTMLElement | null = null;
    if (selected.path) {
      element = [...doc.querySelectorAll<HTMLElement>(anchorSelector(selected.path))].find(element => (element.getAttribute("data-rigel-doc") ?? docId) === selected?.docId) ?? null;
    }
    if (!element && selected.sectionKey) {
      element = doc.querySelector<HTMLElement>(`[data-rigel-section][data-rigel-key="${selected.sectionKey}"][data-rigel-doc="${selected.docId}"]`);
    }
    if (element && element !== editingBody) {
      element.style.setProperty("outline", "2px solid var(--accent, #005aa3)", "important");
      element.style.setProperty("outline-offset", "3px", "important");
      highlighted = element;
      if (scroll) element.scrollIntoView({ block: "center" });
    }
  }

  function applyStructure() {
    const doc = docElement();
    if (!doc) return;
    const sections = Array.isArray(values.sections) ? (values.sections as Record<string, unknown>[]) : [];
    const prepared = [...doc.querySelectorAll('[data-rigel-each="sections"]')].some(element => element.getAttribute("data-rigel-doc") === docId);
    if (prepared) { pending = []; return; }
    const elements = new Map<string, HTMLElement>();
    for (const element of doc.querySelectorAll<HTMLElement>(`[data-rigel-section][data-rigel-doc="${docId}"]`)) {
      const key = element.getAttribute("data-rigel-key");
      if (key) elements.set(key, element);
    }
    for (const [key, element] of elements) {
      if (!sections.some((section) => section._key === key)) {
        element.remove();
        elements.delete(key);
      }
    }
    const parent = elements.values().next().value?.parentElement;
    if (!parent) {
      pending = sections.map((section) => String(section._key)).filter((key) => !elements.has(key));
      return;
    }
    const onlySections = [...parent.children].every((child) => child.hasAttribute("data-rigel-section"));
    if (!onlySections) {
      pending = [];
      return;
    }
    for (const section of sections) {
      const element = elements.get(String(section._key));
      if (element) parent.appendChild(element);
    }
    pending = sections.map((section) => String(section._key)).filter((key) => !elements.has(key));
  }

  function patch() {
    const doc = docElement();
    if (!doc) return;
    patchPreview(doc, previewValues ?? values, body, { documents, primary: docId, editingBody });
    const signature = (Array.isArray(values.sections) ? (values.sections as Record<string, unknown>[]) : [])
      .map((section) => `${section._key}:${section._type}`)
      .join(",");
    if (signature !== structureSignature) {
      structureSignature = signature;
      applyStructure();
    }
    applySelection();
  }

  function fieldPathFrom(element: HTMLElement): { path: string; doc: string } | null {
    for (const attr of ["data-rigel-text", "data-rigel-richtext", "data-rigel-image", "data-rigel-alt", "data-rigel-href"]) {
      const value = element.getAttribute(attr);
      if (value) return { path: value, doc: element.getAttribute("data-rigel-doc") ?? docId };
    }
    return null;
  }

  function selectFromElement(element: HTMLElement) {
    const field = fieldPathFrom(element);
    const section = element.closest<HTMLElement>("[data-rigel-section]");
    const sectionKey = section?.getAttribute("data-rigel-key") ?? undefined;
    if (field && field.doc !== docId && section?.getAttribute("data-rigel-doc") === docId) selected = { docId, path: "", sectionKey };
    else if (field) selected = { docId: field.doc, path: field.path, sectionKey };
    else if (sectionKey) selected = { docId: docId, path: "", sectionKey };
    panelOpen = true;
    focusToken++;
    applySelection();
  }

  function eventElement(target: EventTarget | null): Element | null {
    return target && (target as Element).nodeType === 1 ? (target as Element) : null;
  }

  function stopBodyEdit() {
    if (!bodyEditor) return;
    void unmount(bodyEditor); bodyEditor = undefined;
    bodyThemeObserver?.disconnect(); bodyThemeObserver = undefined;
    editingBody?.replaceChildren(...bodyContents);
    for (const [name, value] of bodyAttributes) { if (value === null) editingBody?.removeAttribute(name); else editingBody?.setAttribute(name, value); }
    bodyAttributes = []; bodyScope?.remove(); bodyScope = null;
    editingBody = null; bodyContents = [];
    patch();
  }
  async function startBodyEdit(element: HTMLElement, event?: MouseEvent) {
    if (!body) return;
    if (bodyEditor) { element.focus(); return; }
    const doc = element.ownerDocument;
    const blockIndex = event ? [...element.children].findIndex(child => child.contains(event.target as Node)) : 0;
    const caret = event && doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    let offset = 0;
    if (caret && element.children[blockIndex]?.contains(caret.offsetNode)) {
      const range = doc.createRange(); range.selectNodeContents(element.children[blockIndex]); range.setEnd(caret.offsetNode, caret.offset); offset = range.toString().length;
    }
    let editorStyle = doc.querySelector<HTMLStyleElement>('style[data-rigel-editor-styles]');
    if (!editorStyle) { editorStyle = doc.createElement("style"); editorStyle.dataset.rigelEditorStyles = ""; doc.head.append(editorStyle); }
    if (editorStyle.textContent !== editorStyles) editorStyle.textContent = editorStyles;
    clearHover(); clearHighlight();
    editingBody = element; bodyContents = [...element.childNodes];
    bodyAttributes = ["class", "style", "role", "aria-label", "aria-multiline", "aria-keyshortcuts", "contenteditable", "data-lexical-editor", "spellcheck"].map(name => [name, element.getAttribute(name)]);
    const pre = doc.createElement("pre"), code = doc.createElement("code");
    pre.append(code); pre.style.cssText = "position:absolute;visibility:hidden"; element.append(pre);
    for (const [sample, properties] of [[pre, ["background-color", "padding", "margin", "border", "border-radius"]], [code, ["color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing"]]] as const) {
      const style = doc.defaultView!.getComputedStyle(sample);
      for (const property of properties) element.style.setProperty(`--rigel-code-${property}`, style.getPropertyValue(property));
    }
    pre.remove();
    const scope = doc.createElement("div");
    const syncTheme = () => { scope.dataset.theme = document.documentElement.dataset.theme; scope.dataset.contrast = document.documentElement.dataset.contrast; };
    syncTheme();
    const host = doc.createElement("div"); host.className = "rigel rigel-inline";
    scope.append(host); doc.body.append(scope); bodyScope = scope;
    bodyEditor = mount(BlockEditor, { target: host, props: { editableRoot: element, get value() { return body as ArticleBody; }, oninput: (next: ArticleBody) => onbody(next) } });
    bodyThemeObserver = new MutationObserver(syncTheme);
    bodyThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });
    await tick();
    const editable = element; editable.focus();
    const block = editable?.children[Math.max(0, blockIndex)];
    if (block) {
      const range = doc.createRange(); range.selectNodeContents(block); range.collapse(true);
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (offset <= (node.textContent?.length ?? 0)) { range.setStart(node, offset); range.collapse(true); break; }
        offset -= node.textContent?.length ?? 0;
      }
      const selection = doc.defaultView?.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
  }
  function focusBody() {
    const target = docElement()?.querySelector<HTMLElement>('[data-rigel-richtext="$body"]');
    if (inlineBodyEnabled && target) { target.scrollIntoView({ block: "center" }); void startBodyEdit(target); }
  }
  $effect(() => { if (!inlineBodyEnabled || mode !== "edit") stopBodyEdit(); });
  onDestroy(stopBodyEdit);

  function onClick(event: MouseEvent) {
    const target = eventElement(event.target);
    if (target && (editingBody?.contains(target) || bodyScope?.contains(target))) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode !== "edit") return;
    if (!target) return;
    const articleBody = target.closest<HTMLElement>('[data-rigel-richtext="$body"]');
    if (inlineBodyEnabled && articleBody) { void startBodyEdit(articleBody, event); return; }
    const element = target.closest<HTMLElement>("[data-rigel-text],[data-rigel-richtext],[data-rigel-image],[data-rigel-alt],[data-rigel-href],[data-rigel-section]");
    if (element) selectFromElement(element);
  }

  function onDoubleClick(event: MouseEvent) {
    if (mode !== "edit" || !schema || !docType) return;
    const target = eventElement(event.target);
    if (!target) return;
    const element = target.closest<HTMLElement>("[data-rigel-text]");
    if (!element) return;
    const field = fieldPathFrom(element);
    if (!field || field.doc !== docId) return;
    const def = fieldForPath(schema, docType, values, field.path);
    if (!def || def.type !== "string") return;
    event.preventDefault();
    const doc = docElement();
    const style = doc?.defaultView?.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (!frameRect) return;
    const value = String(anchorValue(values, field.path).value ?? "");
    inline = {
      path: field.path,
      value,
      original: value,
      left: frameRect.left - stageRect.left + rect.left,
      top: frameRect.top - stageRect.top + rect.top,
      width: Math.max(140, rect.width),
      height: Math.max(28, rect.height),
      fontSize: style?.fontSize ?? "16px",
    };
    queueMicrotask(() => inlineInput?.focus());
  }

  function closeInline(revert = false) {
    if (!inline) return;
    if (revert && inline.value !== inline.original) onchange(replaceAt(values, inline.path, inline.original));
    const path = inline.path;
    inline = null;
    const doc = docElement();
    const element = doc?.querySelector<HTMLElement>(`[data-rigel-text="${path}"][data-rigel-doc="${docId}"]`);
    element?.setAttribute("tabindex", "-1");
    queueMicrotask(() => element?.focus());
  }

  function onOver(event: MouseEvent) {
    if (mode !== "edit") return;
    const target = eventElement(event.target);
    if (target && (editingBody?.contains(target) || bodyScope?.contains(target))) return;
    if (!target) return;
    const element = target.closest<HTMLElement>("[data-rigel-text],[data-rigel-richtext],[data-rigel-image],[data-rigel-alt],[data-rigel-href],[data-rigel-section]");
    if (!element || element === highlighted) return;
    if (hovered && hovered !== element) clearHover();
    hovered = element;
    element.style.setProperty("outline", "1px dashed var(--accent, #005aa3)", "important");
  }

  function onOut(event: MouseEvent) {
    const target = eventElement(event.target);
    if (!target) return;
    const element = target.closest<HTMLElement>("[data-rigel-text],[data-rigel-richtext],[data-rigel-image],[data-rigel-alt],[data-rigel-href],[data-rigel-section]");
    if (element && element === hovered) clearHover();
  }

  function onLoad() {
    stopBodyEdit(); bodyAvailable = false;
    loaded = false;
    error = "";
    clearHighlight();
    hovered = null;
    structureSignature = "";
    const doc = docElement();
    if (!doc) {
      error = "The page could not be loaded in the preview.";
      return;
    }
    try {
      doc.addEventListener("click", onClick, true);
      doc.addEventListener("contextmenu", event => { if (!devMode) event.preventDefault(); }, true);
      doc.addEventListener("dblclick", onDoubleClick, true);
      doc.addEventListener("mouseover", onOver, true);
      doc.addEventListener("mouseout", onOut, true);
      doc.addEventListener("submit", (event) => event.preventDefault(), true);
      doc.defaultView?.addEventListener("scroll", () => closeInline(), { passive: true });
      if (!doc.querySelector(schema ? `[data-rigel-doc="${docId}"]` : "[data-rigel-text],[data-rigel-richtext],[data-rigel-image]")) throw new Error("This page isn’t set up for live editing. Changes won’t appear in this preview.");
      loaded = true;
      bodyAvailable = !schema && !!body && !!doc.querySelector('[data-rigel-richtext="$body"]');
      patch();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Preview unavailable";
    }
  }

  function setMode(next: "browse" | "edit") {
    mode = next;
    panelOpen = next === "edit";
    if (next === "browse") {
      clearHighlight();
      clearHover();
      selected = null;
      closeInline();
    }
  }

  function endResize() {
    const pointer = resizePointer;
    resizePointer = null;
    resizing = false;
    if (pointer?.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0 || resizePointer) return;
    event.preventDefault();
    closeInline();
    const element = event.currentTarget as HTMLElement;
    element.focus();
    element.setPointerCapture(event.pointerId);
    resizePointer = { element, id: event.pointerId };
    resizing = true;
  }

  function moveResize(event: PointerEvent) {
    if (resizePointer?.id !== event.pointerId) return;
    const editor = resizePointer.element.parentElement!;
    requestedWidth = Math.max(280, Math.min(panelMax, editor.getBoundingClientRect().right - event.clientX - 5));
  }

  function keyResize(event: KeyboardEvent) {
    const width = { ArrowLeft: panelWidth + 20, ArrowRight: panelWidth - 20, Home: 280, End: panelMax }[event.key];
    if (width === undefined) return;
    event.preventDefault();
    closeInline();
    requestedWidth = Math.max(280, Math.min(panelMax, width));
  }

  $effect(() => {
    if (!panelOpen) endResize();
  });

  $effect(() => {
    void JSON.stringify(values);
    void JSON.stringify(previewValues);
    void body;
    void loaded;
    patch();
  });

  let lastDocId = "";
  $effect(() => {
    if (docId === lastDocId) return;
    lastDocId = docId;
    requestedWidth = 340;
    endResize();
    inline = null;
    selected = null;
    structureSignature = "";
    pending = [];
  });

  function updateInline(value: string) {
    if (!inline) return;
    inline = { ...inline, value };
    onchange(replaceAt(values, inline.path, value));
  }
</script>

<svelte:window onkeydown={(event) => {
  if (event.key === "Escape" && inline) { event.stopPropagation(); closeInline(true); }
}} />

<div class="visual-editor" bind:clientWidth={editorWidth} class:with-panel={panelOpen} class:resizing-properties={resizing} style={`--properties-width: ${panelWidth}px`}>
  <div class="visual-canvas">
    <div class="visual-toolbar">
      <div class="mode-toggle" role="group" aria-label="Preview mode">
        <button type="button" aria-pressed={mode === "browse"} onclick={() => setMode("browse")}>Browse</button>
        <button type="button" aria-pressed={mode === "edit"} onclick={() => setMode("edit")}>Edit</button>
      </div>
      <span class="visual-hint">{mode === "edit" ? "Click a region to edit it. Scripts, forms and links stay disabled." : "Scripts, forms and links are disabled in this preview."}</span>
      <div class="visual-actions">
        {#if livePath}<a class="icon-btn visual-live" href={livePath} target="_blank" rel="noopener noreferrer" aria-label="View live page" title="View live page"><Icon name="external" size={18} /></a>{/if}
        <button type="button" class="icon-btn" aria-pressed={panelOpen} aria-label="Toggle properties panel" title="Toggle properties panel" onclick={() => (panelOpen = !panelOpen)}>
          <SidebarIcon name="square-half" />
        </button>
      </div>
    </div>
    <div class="canvas-stage" bind:this={stage} class:grabbing={mode === "edit"} data-ready={loaded}>
      {#if error}
        <p class="visual-error" role="status">{error}</p>
      {/if}
      {#if !previewPath}
        <p class="visual-error" role="status">{creating ? "New page — Save writes the file. The route renders once the site has it." : "No preview URL is mapped to this document. Use the properties panel to edit."}</p>
      {:else}
        <PreviewFrame bind:frame url={previewPath} {reloadToken} title="Website page editor" onload={onLoad} onloading={() => { stopBodyEdit(); inline = null; loaded = false; error = ""; }} onerror={(message) => { loaded = false; error = message; }} />
      {/if}
      {#if inline}
        <input
          class="inline-editor"
          bind:this={inlineInput}
          type="text"
          aria-label="Edit text"
          style={`left:${inline.left}px;top:${inline.top}px;width:${inline.width}px;height:${inline.height}px;font-size:${inline.fontSize}`}
          value={inline.value}
          oninput={(event) => updateInline(event.currentTarget.value)}
          onkeydown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); closeInline(); }
          }}
          onblur={() => closeInline()}
        />
      {/if}
    </div>
  </div>
  {#if panelOpen}
    <div class="properties-divider" role="separator" tabindex="0" aria-label="Properties panel width" aria-orientation="vertical" aria-valuemin="280" aria-valuemax={panelMax} aria-valuenow={panelWidth} aria-valuetext={`${Math.round(panelWidth)} pixels`} onpointerdown={startResize} onpointermove={moveResize} onpointerup={endResize} onpointercancel={endResize} onlostpointercapture={endResize} onkeydown={keyResize}></div>
  {/if}
  {#if panelOpen && properties}
    {@render properties(selected, focusToken, inlineBodyEnabled, focusBody)}
  {:else if panelOpen && schema && docType}
    <SchemaPanel
      {schema}
      {docType}
      {values}
      {docId}
      {selected}
      {creating}
      {pending}
      {focusToken}
      {devMode}
      documents={documentList}
      onchange={onchange}
      {oneditdocument}
      onselect={async (next) => { selected = next; focusToken++; await tick(); if (selected?.docId === next?.docId && selected?.sectionKey === next?.sectionKey) applySelection(true); }}
    />
  {/if}
</div>
