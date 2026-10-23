<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { EditorState, TextSelection } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { exampleSetup } from "prosemirror-example-setup";
  import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
  import { liftListItem, wrapInList } from "prosemirror-schema-list";
  import type { Command } from "prosemirror-state";
  import Icon from "./Icon.svelte";
  import ImagePicker from "./ImagePicker.svelte";
  import Select from "./Select.svelte";
  import { safeImageUrl, type StockResult } from "./images";
  import type { SelectionBookmark } from "prosemirror-state";
  import { parseVisualMarkdown, serializeMarkdown, safeMarkdownUrl, schema } from "./rich-markdown";

  let { value, label, oninput }: { value: string; label: string; oninput: (value: string) => void } = $props();
  const id = $props.id();
  let host: HTMLDivElement;
  let mode = $state<"visual" | "source">("visual");
  let warning = $state("");
  let linkUrl = $state("");
  let linkError = $state("");
  let linkOpen = $state(false);
  let linkInput: HTMLInputElement;
  let linkButton: HTMLButtonElement;
  let state = $state.raw<EditorState>();
  let view: EditorView | undefined;
  let lastValue: string | undefined;
  let imageSelection: SelectionBookmark | undefined;
  function insertImage(url: string, alt: string, credit?: StockResult) {
    if (!view || !imageSelection || !safeImageUrl(url)) return;
    let tr = view.state.tr.setSelection(imageSelection.resolve(view.state.doc));
    tr = tr.replaceSelectionWith(schema.nodes.image.create({ src: url, alt }));
    if (credit?.creditURL && safeImageUrl(credit.creditURL)) {
      tr = tr.insert(tr.selection.to, schema.text(` (${credit.credit})`, [schema.marks.link.create({ href: credit.creditURL })]));
    }
    view.dispatch(tr.scrollIntoView());
    imageSelection = undefined;
    view.focus();
  }
  const marks = [
    { name: "Bold", icon: "textB", type: "strong" },
    { name: "Italic", icon: "textItalic", type: "em" },
    { name: "Code", icon: "code", type: "code" },
  ] as const;
  const blocks = [
    { name: "Bullet list", icon: "listBullets", type: "bullet_list" },
    { name: "Numbered list", icon: "listNumbers", type: "ordered_list" },
    { name: "Quote", icon: "quotes", type: "blockquote" },
  ] as const;
  const format = $derived(state?.selection.$from.parent.type.name === "heading" ? `h${state.selection.$from.parent.attrs.level}` : state?.selection.$from.parent.type.name ?? "paragraph");

  function emit(next: string) {
    lastValue = next;
    oninput(next);
  }

  function load(source: string) {
    const doc = parseVisualMarkdown(source);
    warning = doc ? "" : "This Markdown contains formatting the visual editor cannot safely preserve. Edit the original source below; nothing has been converted.";
    if (!doc) { mode = "source"; return false; }
    state = EditorState.create({ doc, plugins: exampleSetup({ schema, menuBar: false }) });
    view?.updateState(state);
    return true;
  }

  $effect(() => {
    if (!host) return;
    if (!view) {
      view = new EditorView(host, {
        state: EditorState.create({ schema }),
        attributes: { role: "textbox", "aria-label": label, "aria-multiline": "true" },
        dispatchTransaction(transaction) {
          state = view!.state.apply(transaction);
          view!.updateState(state);
          if (transaction.docChanged) emit(serializeMarkdown(state.doc));
        },
        handlePaste(editor, event) {
          event.preventDefault();
          const text = event.clipboardData?.getData("text/plain") ?? "";
          if (text) editor.dispatch(editor.state.tr.insertText(text));
          return true;
        },
        handleDrop(_editor, _event, _slice, moved) { return !moved; },
        handleClickOn(_editor, _pos, node) { return node.type.name === "image"; },
        handleDOMEvents: { click: (_editor, event) => { if ((event.target as Element).closest("a")) { event.preventDefault(); return true; } return false; } },
      });
    }
    if (value !== lastValue) {
      lastValue = value;
      load(value);
    }
  });
  onDestroy(() => view?.destroy());

  function activeMark(type: string) {
    if (!state) return false;
    const { from, to, empty, $from: anchor } = state.selection;
    return empty ? !!schema.marks[type].isInSet(state.storedMarks ?? anchor.marks()) : state.doc.rangeHasMark(from, to, schema.marks[type]);
  }

  function activeBlock(type: string) {
    if (!state) return false;
    const { $from: anchor } = state.selection;
    for (let depth = anchor.depth; depth > 0; depth--) if (anchor.node(depth).type.name === type) return true;
    return false;
  }

  function blockCommand(type: string): Command {
    if (type === "blockquote") return activeBlock(type) ? lift : wrapIn(schema.nodes[type]);
    return activeBlock(type) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes[type]);
  }

  function formatCommand(type: string) {
    return type.startsWith("h") ? setBlockType(schema.nodes.heading, { level: Number(type.slice(1)) }) : setBlockType(schema.nodes[type]);
  }

  function command(action: Command) {
    if (!view) return;
    action(view.state, view.dispatch, view);
    view.focus();
  }

  function visual() {
    if (mode === "visual") return;
    if (load(value)) { mode = "visual"; view?.focus(); }
  }

  async function openLink() {
    const mark = state && schema.marks.link.isInSet(state.selection.$from.marks());
    if (view && mark && view.state.selection.empty) {
      const anchor = view.state.selection.$from;
      let from = anchor.pos;
      let to = anchor.pos;
      view.state.doc.nodesBetween(anchor.start(), anchor.end(), (node, pos) => {
        if (node.isText && mark.isInSet(node.marks) && pos <= to && pos + node.nodeSize >= from) {
          from = Math.min(from, pos);
          to = Math.max(to, pos + node.nodeSize);
        }
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    }
    linkUrl = mark?.attrs.href ?? "";
    linkError = "";
    linkOpen = !linkOpen;
    if (linkOpen) { await tick(); linkInput?.focus(); }
  }

  function link(remove = false) {
    if (!view) return;
    if (!remove && (!safeMarkdownUrl(linkUrl) || !linkUrl)) { linkError = "Enter a safe http, https, mailto or relative URL."; return; }
    const { from, to, empty } = view.state.selection;
    let tr = view.state.tr;
    if (empty) tr = remove ? tr.removeStoredMark(schema.marks.link) : tr.addStoredMark(schema.marks.link.create({ href: linkUrl }));
    else tr = remove ? tr.removeMark(from, to, schema.marks.link) : tr.addMark(from, to, schema.marks.link.create({ href: linkUrl }));
    view.dispatch(tr);
    linkOpen = false;
    view.focus();
  }
</script>

<svelte:window onpointerdown={event => { if (linkOpen && !document.getElementById(`${id}-link`)?.contains(event.target as Node) && !linkButton?.contains(event.target as Node)) linkOpen = false; }} />

<div class="markdown-editor body-editor">
  <div class="markdown-heading">
    <div class="field-label" id={`${id}-label`}>{label}</div>
    <div class="markdown-modes" role="group" aria-label={`${label} editing mode`}>
      <button type="button" aria-pressed={mode === "visual"} onclick={visual}>Visual</button>
      <button type="button" aria-pressed={mode === "source"} onclick={() => { mode = "source"; linkOpen = false; }}>Markdown</button>
    </div>
  </div>
  {#if warning}<p class="markdown-warning" role="status">{warning}</p>{/if}
  <div class="markdown-visual" hidden={mode !== "visual"}>
    <div class="body-toolbar formatting-toolbar" role="group" aria-label={`${label} formatting`}>
      <Select ariaLabel="Text style" data-tooltip="Text style" value={format} options={[{ value: "paragraph", label: "Paragraph" }, ...[1, 2, 3, 4, 5, 6].map(level => ({ value: `h${level}`, label: `Heading ${level}` })), { value: "code_block", label: "Code block" }].map(option => ({ ...option, disabled: !!state && format !== option.value && !formatCommand(option.value)(state) }))} onchange={next => command(formatCommand(String(next)))} />
      <div class="format-group" role="group" aria-label="Text formatting">
        {#each marks as item}
          <button type="button" aria-label={item.name} data-tooltip={item.name} aria-pressed={activeMark(item.type)} disabled={!state || !toggleMark(schema.marks[item.type])(state)} onmousedown={event => event.preventDefault()} onclick={() => command(toggleMark(schema.marks[item.type]))}><Icon name={item.icon} size={18} /></button>
        {/each}
      </div>
      <div class="format-group" role="group" aria-label="Lists and quote">
        {#each blocks as item}
          <button type="button" aria-label={item.name} data-tooltip={item.name} aria-pressed={activeBlock(item.type)} disabled={!state || !blockCommand(item.type)(state)} onmousedown={event => event.preventDefault()} onclick={() => command(blockCommand(item.type))}><Icon name={item.icon} size={18} /></button>
        {/each}
      </div>
      <button bind:this={linkButton} type="button" aria-label="Link" data-tooltip="Link" aria-pressed={activeMark("link")} aria-expanded={linkOpen} aria-controls={`${id}-link`} disabled={!state || !toggleMark(schema.marks.link)(state)} onmousedown={event => event.preventDefault()} onclick={openLink}><Icon name="link" size={18} /></button>
      <ImagePicker toolbar onopen={() => { imageSelection = view?.state.selection.getBookmark(); linkOpen = false; }} onpick={insertImage} onclose={() => { imageSelection = undefined; }} />
    </div>
    {#if linkOpen}
      <div class="markdown-link" id={`${id}-link`} role="group" aria-label="Edit link" onkeydown={event => { if (event.key === "Escape") { event.stopPropagation(); linkOpen = false; linkButton.focus(); } if (event.key === "Enter") { event.preventDefault(); link(); } }}>
        <label for={`${id}-url`}>Link URL</label>
        <div class="markdown-link-controls">
          <input id={`${id}-url`} type="text" placeholder="https://…" bind:this={linkInput} bind:value={linkUrl} aria-invalid={!!linkError} aria-describedby={linkError ? `${id}-error` : undefined} />
          <button type="button" aria-label="Apply link" data-tooltip="Apply link" onclick={() => link()}><Icon name="check" size={16} /></button>
          <button type="button" aria-label="Remove link" data-tooltip="Remove link" disabled={!activeMark("link")} onclick={() => link(true)}><Icon name="linkBreak" size={16} /></button>
          <button type="button" aria-label="Close link" data-tooltip="Close link" onclick={() => { linkOpen = false; linkButton.focus(); }}><Icon name="x" size={16} /></button>
        </div>
        {#if linkError}<p id={`${id}-error`} role="alert">{linkError}</p>{/if}
      </div>
    {/if}
    <div class="md-preview rich-text" bind:this={host}></div>
  </div>
  {#if mode === "source"}
    <textarea class="mono" rows="14" aria-label={`${label} Markdown source`} value={value} oninput={(event) => { warning = ""; emit(event.currentTarget.value); }}></textarea>
  {/if}
</div>
