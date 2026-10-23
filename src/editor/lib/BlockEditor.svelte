<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import * as L from "lexical";
  import * as Rich from "@lexical/rich-text";
  import { createEmptyHistoryState, registerHistory } from "@lexical/history";
  import * as Lists from "@lexical/list";
  import * as Links from "@lexical/link";
  import * as Tables from "@lexical/table";
  import { ImageNode, type ImageData } from "../blocks/image";
  import ImagePicker from "./ImagePicker.svelte";
  import type { StockResult } from "./images";
  import { safePreviewUrl } from "../../preview-urls";
  import { blockTypes, blockNodes } from "../blocks";
  import { validateBody, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, type ArticleBody } from "../../article-body";
  import { articleMarkdown } from "../../article-render";
  import Icon from "./Icon.svelte";
  import Select from "./Select.svelte";
  let { value, oninput, editableRoot }: { value: ArticleBody; oninput: (value: ArticleBody) => void; editableRoot?: HTMLElement } = $props();
  const inline = $derived(!!editableRoot);
  let root: HTMLElement;
  let surface: HTMLDivElement;
  let menu: HTMLDivElement;
  let tableMenu: HTMLDivElement;
  let formatMenu: HTMLDivElement;
  let formatTrigger: HTMLButtonElement;
  let formatsOpen = $state(false);
  let slashMenu: HTMLDivElement;
  let slashPosition = $state("");
  let handle: HTMLButtonElement;
  let editor: L.LexicalEditor;
  let view: Window & typeof globalThis;
  let last = untrack(() => JSON.stringify(value));
  let received = last;
  let error = $state("");
  let markdownView = $state(false);
  let activeKey = $state("");
  let hoverKey = $state("");
  let insertion = $state<{ after: string; top: number; left: number } | null>(null);
  let blockType = $state("paragraph");
  let listType = $state("");
  let handleTop = $state(0);
  let handleLeft = $state(0);
  let menuPosition = $state("");
  let slash = $state<string | null>(null);
  let slashIndex = $state(0);
  let slashKey = "";
  let slashDismissed = "";
  let adding = false;
  let savedSelection: L.BaseSelection | null = null;
  let drag: { id: number; key: string; x: number; y: number; moved: boolean } | null = null;
  let drop = $state<{ key: string; after: boolean; top: number } | null>(null);
  let suppressClick = false;
  let floating = $state("");
  let linkOpen = $state(false);
  let linkUrl = $state("");
  let linkError = $state("");
  let linkInput: HTMLInputElement;
  let linkPosition = $state("");
  let editorHost: HTMLDivElement;
  let imageJob: { key: string; replace: boolean } | null = null;
  let imageData = $state<ImageData | null>(null);
  let altOpen = $state(false);
  let altText = $state("");
  let altKey = "";
  let altInput: HTMLInputElement;
  const id = $props.id();
  const marks = [
    { type: "bold", icon: "textB", label: "Bold" },
    { type: "italic", icon: "textItalic", label: "Italic" },
    { type: "code", icon: "code", label: "Inline code" },
    { type: "strikethrough", icon: "textStrikethrough", label: "Strikethrough" },
    { type: "underline", icon: "textUnderline", label: "Underline" },
    { type: "highlight", icon: "highlighter", label: "Highlight" },
    { type: "subscript", icon: "textSubscript", label: "Subscript" },
    { type: "superscript", icon: "textSuperscript", label: "Superscript" },
  ] as const;
  let activeMarks = $state<string[]>([]);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let tableCell = $state("");
  let tableRows = $state(0);
  let tableColumns = $state(0);
  let tableHeader = $state(false);
  const choices = $derived(blockTypes.filter(block => block.label.toLowerCase().includes((slash ?? "").toLowerCase())));
  const textBlocks = blockTypes.filter(block => !["image", "table", "bullet", "number"].includes(block.value));
  const activeBlock = $derived(blockTypes.find(block => block.value === blockType));

  function topBlock(node: L.LexicalNode | null) {
    if (!node || L.$isRootNode(node)) return null;
    let parent = node.getParent();
    while (parent && !L.$isRootNode(parent)) { node = parent; parent = node.getParent(); }
    return node;
  }
  function refresh() {
    editor.getEditorState().read(() => {
      const children = L.$getRoot().getChildren();
      const selection = L.$getSelection();
      if (selection) savedSelection = selection.clone();
      const anchor = L.$isRangeSelection(selection) || Tables.$isTableSelection(selection) ? selection.anchor.getNode() : null;
      listType = anchor ? [anchor, ...anchor.getParents()].find(Lists.$isListNode)?.getListType() ?? "" : "";
      const node = anchor ? topBlock(anchor) : L.$isNodeSelection(selection) ? topBlock(selection.getNodes()[0]) : null;
      tableCell = anchor ? Tables.$getTableCellNodeFromLexicalNode(anchor)?.getKey() ?? "" : "";
      if (Tables.$isTableNode(node)) {
        tableRows = node.getChildrenSize(); tableColumns = node.getColumnCount();
        tableHeader = node.getFirstChildOrThrow<Tables.TableRowNode>().getChildren<Tables.TableCellNode>().every(cell => cell.hasHeaderState(Tables.TableCellHeaderStates.ROW));
      }
      if (node) {
        imageData = node instanceof ImageNode ? { ...node.__image } : null;
        activeKey = node.getKey();
        blockType = Rich.$isHeadingNode(node) ? node.getTag() : Lists.$isListNode(node) ? node.getListType() : node.getType();
        activeMarks = L.$isRangeSelection(selection) ? marks.filter(mark => selection.hasFormat(mark.type)).map(mark => mark.type) : [];
        const text = node.getTextContent();
        const match = node.getType() === "paragraph" && L.$isRangeSelection(selection) && selection.isCollapsed() ? text.match(/^\/([\w ]*)$/) : null;
        const signature = node.getKey() + text;
        if (match && signature !== slashDismissed) { if (slash !== match[1]) slashIndex = 0; slash = match[1]; slashKey = node.getKey(); adding = false; }
        else if (!adding) slash = null;
      }
      for (const child of children) {
        const element = editor.getElementByKey(child.getKey());
        if (element) { element.dataset.blockKey = child.getKey(); if (inline) element.toggleAttribute('data-rigel-active-block', child.getKey() === activeKey); }
      }
    });
    positionFloating();
    positionHandle();
    positionInsertion();
  }
  function positionFloating() {
    if (imageJob) return;
    const selection = view.getSelection();
    if (!root.ownerDocument.hasFocus()) { floating = ""; return; }
    if (editorHost.contains(root.ownerDocument.activeElement) && !root.contains(root.ownerDocument.activeElement)) return;
    if (inline || imageData) {
      if (imageData ? root.ownerDocument.activeElement !== root : !selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) { floating = ""; return; }
      const block = editor.getElementByKey(activeKey);
      if (!block) { floating = ""; return; }
      const rect = imageData || selection!.isCollapsed ? block.getBoundingClientRect() : selection!.getRangeAt(0).getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > view.innerHeight) { floating = ""; return; }
      const toolbarRect = editorHost.querySelector(imageData ? '.image-toolbar' : '.body-toolbar')?.getBoundingClientRect();
      const toolbarHeight = toolbarRect?.height || 42, toolbarWidth = toolbarRect?.width || 330;
      const top = rect.top >= toolbarHeight + 12 ? rect.top - toolbarHeight - 8 : rect.bottom + 8;
      const minTop = !inline ? (editorHost.querySelector('.body-toolbar:not(.image-toolbar)')?.getBoundingClientRect().bottom ?? 0) + 8 : 8;
      floating = `left:${Math.max(8, Math.min(rect.left, view.document.documentElement.clientWidth - toolbarWidth - 8))}px;top:${Math.max(minTop, Math.min(top, view.innerHeight - toolbarHeight - 8))}px`;
      return;
    }
    if (!root.ownerDocument.hasFocus() || !selection?.rangeCount || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) { floating = ""; return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const toolbarBottom = editorHost.querySelector('.body-toolbar')?.getBoundingClientRect().bottom ?? 0;
    const top = rect.top - 44 >= toolbarBottom + 8 ? rect.top - 44 : Math.max(toolbarBottom + 8, rect.bottom + 8);
    floating = `left:${Math.max(8, Math.min(rect.left, view.innerWidth - 216))}px;top:${Math.max(8, Math.min(top, view.innerHeight - 44))}px`;
  }
  function positionHandle() {
    const element = editor?.getElementByKey(hoverKey || activeKey);
    if (element && surface) {
      const rect = element.getBoundingClientRect();
      handleTop = inline ? rect.top : rect.top - surface.getBoundingClientRect().top;
      if (inline) handleLeft = Math.max(0, rect.left - 28);
    }
    positionSlash();
  }
  function positionSlash() {
    if (slash === null || !editor) return;
    const rect = editor.getElementByKey(slashKey)?.getBoundingClientRect() ?? root.getBoundingClientRect();
    const top = view.innerHeight - rect.bottom >= 280 ? rect.bottom + 4 : Math.max(8, rect.top - 284);
    slashPosition = `left:${Math.max(8, Math.min(rect.left, view.innerWidth - 232))}px;top:${top}px`;
  }
  onMount(() => {
    if (editableRoot) {
      root = editableRoot; root.classList.add("block-content", "rigel-article-content"); root.contentEditable = "true";
      root.setAttribute("role", "textbox"); root.setAttribute("aria-label", "Body"); root.setAttribute("aria-multiline", "true");
      root.setAttribute("aria-keyshortcuts", "Alt+F10");
    }
    view = root.ownerDocument.defaultView!;
    const contentStyle = view.getComputedStyle(root);
    const whiteSpace = contentStyle.whiteSpace, wordBreak = contentStyle.wordBreak;
    editor = L.createEditor({ namespace: "RigelArticle", nodes: blockNodes, onError: cause => { error = cause.message; }, theme: { code: "block-code", tableScrollableWrapper: "block-table-scroll", tableCellSelected: "block-table-selected", text: { bold: "block-bold", italic: "block-italic", strikethrough: "block-strike", underline: "block-underline", underlineStrikethrough: "block-underline-strike", code: "block-inline-code" } } });
    editor.setRootElement(root);
    if (inline) { root.style.whiteSpace = whiteSpace; root.style.wordBreak = wordBreak; }
    Tables.setScrollableTablesActive(editor, true);
    try { validateBody(value); const state = editor.parseEditorState(JSON.stringify(value)); last = JSON.stringify(state.toJSON()); editor.setEditorState(state); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Unable to load article"; editor.setEditable(false); }
    const cleanups = [Rich.registerRichText(editor), Lists.registerList(editor), registerHistory(editor, createEmptyHistoryState(), 300)];
    root.contentEditable = String(editor.isEditable());
    cleanups.push(editor.registerEditableListener(editable => { root.contentEditable = String(editable); }));
    cleanups.push(Tables.registerTablePlugin(editor), Tables.registerTableSelectionObserver(editor, true));
    cleanups.push(editor.registerCommand(L.CAN_UNDO_COMMAND, available => { canUndo = available; return false; }, L.COMMAND_PRIORITY_EDITOR));
    cleanups.push(editor.registerCommand(L.CAN_REDO_COMMAND, available => { canRedo = available; return false; }, L.COMMAND_PRIORITY_EDITOR));
    cleanups.push(editor.registerCommand(L.PASTE_COMMAND, event => {
      event?.preventDefault();
      const selection = L.$getSelection();
      if (L.$isRangeSelection(selection) && event && "clipboardData" in event) selection.insertRawText(event.clipboardData?.getData("text/plain") ?? "");
      return true;
    }, L.COMMAND_PRIORITY_CRITICAL));
    cleanups.push(editor.registerCommand(L.DROP_COMMAND, event => { event.preventDefault(); return true; }, L.COMMAND_PRIORITY_CRITICAL));
    cleanups.push(editor.registerCommand(L.KEY_DOWN_COMMAND, event => {
      if ((inline || imageData) && event.altKey && event.key === "F10") { event.preventDefault(); editorHost.querySelector<HTMLButtonElement>(imageData ? '.image-toolbar button' : '.body-toolbar button')?.focus(); return true; }
      return slashKeydown(event);
    }, L.COMMAND_PRIORITY_HIGH));
    const updates = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      refresh();
      if (dirtyElements.size || dirtyLeaves.size) {
        const next = editorState.toJSON(), serialized = JSON.stringify(next);
        if (serialized !== last) { last = serialized; received = serialized; oninput(next); }
      }
    });
    refresh();
    const position = () => { positionHandle(); positionFloating(); positionInsertion(); };
    const toolbarObserver = new ResizeObserver(() => { positionFloating(); positionInsertion(); });
    editorHost.querySelectorAll('.body-toolbar').forEach(toolbar => toolbarObserver.observe(toolbar));
    toolbarObserver.observe(root);
    const outside = (event: PointerEvent) => {
      if (linkOpen && !editorHost.querySelector('.markdown-link')?.contains(event.target as Node)) linkOpen = false;
      if ((inline || imageData) && !root.contains(event.target as Node) && !editorHost.contains(event.target as Node)) { floating = ""; linkOpen = false; altOpen = false; closeMenu(); }
      if (slash !== null && !slashMenu?.contains(event.target as Node) && !root.contains(event.target as Node) && !(event.target as Element).closest('.block-add')) dismissSlash();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { endDrag(true); closeMenu(); dismissSlash(); if (inline) { floating = ""; editor.focus(); } } };
    view.addEventListener("resize", position); view.addEventListener("scroll", position, true);
    view.addEventListener("pointerdown", outside, true); view.addEventListener("keydown", escape);
    if (root.ownerDocument !== document) document.addEventListener("pointerdown", outside, true);
    view.addEventListener("blur", positionFloating);
    root.addEventListener("pointerdown", contentClick); root.addEventListener("click", contentClick);
    root.addEventListener("pointerleave", leaveInsertion);
    if (inline) view.addEventListener("pointermove", hover);
    return () => {
      toolbarObserver?.disconnect();
      view.CSS.highlights?.delete("rigel-link-selection");
      view.removeEventListener("resize", position); view.removeEventListener("scroll", position, true);
      view.removeEventListener("pointerdown", outside, true); view.removeEventListener("keydown", escape); view.removeEventListener("blur", positionFloating);
      if (root.ownerDocument !== document) document.removeEventListener("pointerdown", outside, true);
      root.removeEventListener("pointerdown", contentClick); root.removeEventListener("click", contentClick);
      root.removeEventListener("pointerleave", leaveInsertion);
      if (inline) view.removeEventListener("pointermove", hover);
      endDrag(true); updates(); cleanups.forEach(cleanup => cleanup()); editor.setRootElement(null);
    };
  });

  $effect(() => { if (!linkOpen) view?.CSS.highlights?.delete("rigel-link-selection"); });

  $effect(() => {
    const serialized = JSON.stringify(value);
    if (editor && serialized !== received) {
      try { validateBody(value); received = serialized; const state = editor.parseEditorState(serialized); last = JSON.stringify(state.toJSON()); editor.setEditorState(state); }
      catch (cause) { error = cause instanceof Error ? cause.message : "Unable to load article"; }
    }
  });

  $effect(() => { if (editor && inline) editor.setEditable(!markdownView && !error); });

  $effect(() => {
    if (!slashMenu) return;
    if (slash === null) { if (slashMenu.matches(":popover-open")) slashMenu.hidePopover(); }
    else { if (!slashMenu.matches(":popover-open")) slashMenu.showPopover(); untrack(positionSlash); }
  });

  function dismissSlash() {
    if (slashKey) editor.getEditorState().read(() => { slashDismissed = slashKey + (L.$getNodeByKey(slashKey)?.getTextContent() ?? ""); });
    slash = null; adding = false;
  }
  function slashKeydown(event: KeyboardEvent) {
    if (slash === null) return false;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismissSlash(); return true; }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); slashIndex = choices.length ? (slashIndex + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length : 0; return true; }
    if (event.key === "Enter" && choices.length) { event.preventDefault(); changeBlock(choices[slashIndex]?.value ?? choices[0].value, true); return true; }
    return false;
  }
  async function addBlock() {
    slashKey = activeKey; adding = true; slash = ""; slashIndex = 0;
    await tick(); editorHost.querySelector<HTMLInputElement>('[aria-label="Find a block"]')?.focus();
  }
  function inlineNodes(node: L.LexicalNode): L.LexicalNode[] {
    if (!L.$isElementNode(node)) return node.getTextContent() ? [L.$createTextNode(node.getTextContent())] : [];
    return node.getChildren().flatMap(child => L.$isElementNode(child) && !child.isInline() ? [...inlineNodes(child), L.$createLineBreakNode()] : [child]);
  }
  function changeBlock(type: string, fromSlash = false) {
    const definition = blockTypes.find(block => block.value === type);
    if (!definition) return;
    if (!fromSlash && type === blockType) { dismissSlash(); closeMenu(); return; }
    const key = fromSlash ? slashKey : hoverKey || activeKey;
    const insert = fromSlash && adding;
    if (type === "image") {
      imageJob = { key, replace: !insert && fromSlash };
      dismissSlash(); closeMenu();
      editorHost.querySelector<HTMLButtonElement>('[data-image-trigger]')?.click();
      return;
    }
    dismissSlash(); closeMenu();
    editor.update(() => {
      const previous = L.$getNodeByKey(key);
      const next = definition.create();
      if (insert) { if (previous) previous.insertAfter(next); else L.$getRoot().append(next); }
      else if (previous) {
        if (!fromSlash && L.$isElementNode(next)) {
          const target = Tables.$isTableNode(next) ? next.getFirstChildOrThrow<Tables.TableRowNode>().getFirstChildOrThrow<Tables.TableCellNode>().getFirstChildOrThrow<L.ParagraphNode>() : Lists.$isListNode(next) ? next.getFirstChildOrThrow<Lists.ListItemNode>() : next;
          target.append(...inlineNodes(previous));
        }
        previous.replace(next);
      } else L.$getRoot().append(next);
      if (Tables.$isTableNode(next)) next.getFirstChildOrThrow<Tables.TableRowNode>().getFirstChildOrThrow<Tables.TableCellNode>().selectStart();
      else if (L.$isElementNode(next)) next.selectEnd();
      else { const paragraph = L.$createParagraphNode(); next.insertAfter(paragraph); paragraph.select(); }
      hoverKey = "";
    });
    editor.focus();
  }
  function format(type: L.TextFormatType) {
    closeMenu();
    editor.update(() => { if (savedSelection) L.$setSelection(savedSelection.clone()); editor.dispatchCommand(L.FORMAT_TEXT_COMMAND, type); });
    editor.focus();
  }
  function toggleList(type: "bullet" | "number") {
    editor.update(() => {
      if (savedSelection) L.$setSelection(savedSelection.clone());
      editor.dispatchCommand(listType === type ? Lists.REMOVE_LIST_COMMAND : type === "bullet" ? Lists.INSERT_UNORDERED_LIST_COMMAND : Lists.INSERT_ORDERED_LIST_COMMAND, undefined);
    });
    hoverKey = ""; editor.focus();
  }
  function tableAction(action: "row" | "column" | "delete-row" | "delete-column" | "header", checked = false) {
    editor.update(() => {
      if (savedSelection) L.$setSelection(savedSelection.clone());
      const table = L.$getNodeByKey(activeKey);
      const selection = L.$getSelection();
      const cell = L.$isRangeSelection(selection) || Tables.$isTableSelection(selection) ? Tables.$getTableCellNodeFromLexicalNode(selection.anchor.getNode()) : null;
      if (!Tables.$isTableNode(table) || !cell || topBlock(cell)?.getKey() !== table.getKey()) return;
      if (action === "row" && table.getChildrenSize() < MAX_TABLE_ROWS) Tables.$insertTableRowAtSelection();
      if (action === "column" && table.getColumnCount() < MAX_TABLE_COLUMNS) Tables.$insertTableColumnAtSelection();
      if (action === "delete-row" && table.getChildrenSize() > 1) Tables.$deleteTableRowAtSelection();
      if (action === "delete-column" && table.getColumnCount() > 1) Tables.$deleteTableColumnAtSelection();
      if (action === "header") Tables.$setTableRowIsHeader(table, 0, checked);
      hoverKey = "";
    });
    editor.focus();
  }
  async function openLink() {
    editor.getEditorState().read(() => {
      const selection = savedSelection;
      const node = L.$isRangeSelection(selection) ? selection.anchor.getNode() : L.$isNodeSelection(selection) ? selection.getNodes()[0] : null;
      const link = Links.$isLinkNode(node) ? node : node?.getParent();
      linkUrl = node instanceof ImageNode ? node.__image.url ?? "" : Links.$isLinkNode(link) ? link.getURL() : "";
    });
    await positionLink();
    linkError = ""; linkOpen = true; altOpen = false;
    await tick(); linkInput.focus();
  }
  async function positionLink() {
    const selection = view.getSelection();
    const range = !imageData && selection?.rangeCount && root.contains(selection.anchorNode) ? selection.getRangeAt(0) : null;
    let rect = range?.getBoundingClientRect() ?? editorHost.querySelector(imageData ? '.image-toolbar' : '.body-toolbar')?.getBoundingClientRect();
    if (range && rect && rect.bottom + 148 > view.innerHeight) {
      range.endContainer.parentElement?.scrollIntoView({ block: "center" });
      rect = range.getBoundingClientRect(); positionFloating();
      await tick();
    }
    const toolbar = editorHost.querySelector(imageData ? '.image-toolbar' : inline ? '.body-toolbar' : '.block-float')?.getBoundingClientRect();
    if (range && !range.collapsed) view.CSS.highlights?.set("rigel-link-selection", new view.Highlight(range.cloneRange()));
    if (rect) linkPosition = `left:${Math.max(8, Math.min(rect.left, view.document.documentElement.clientWidth - 356))}px;top:${range ? Math.max(8, rect.bottom + 8, (toolbar?.bottom ?? 0) + 8) : Math.max(8, Math.min(rect.bottom + 4, view.innerHeight - 140))}px`;
  }
  async function openAlt() {
    altKey = activeKey; altText = imageData?.alt ?? ""; await positionLink(); altOpen = true; linkOpen = false;
    await tick(); altInput.focus();
  }
  function refocus() { void tick().then(() => { root.focus({ preventScroll: true }); editor.focus(); }); }
  function applyAlt() {
    editor.update(() => { const node = L.$getNodeByKey(altKey); if (node instanceof ImageNode) node.setImage({ alt: altText }); });
    altOpen = false; refocus();
  }
  function applyLink(remove = false) {
    if (!remove && !safePreviewUrl(linkUrl)) { linkError = "Enter a safe http, https, mailto or relative URL."; return; }
    editor.update(() => {
      if (savedSelection) L.$setSelection(savedSelection.clone());
      const selection = L.$getSelection(), node = L.$isNodeSelection(selection) ? selection.getNodes()[0] : null;
      if (node instanceof ImageNode) node.setImage({ url: remove ? undefined : linkUrl });
      else Links.$toggleLink(remove ? null : linkUrl);
    });
    linkOpen = false; refocus();
  }
  function pickImage(url: string, alt: string, credit?: StockResult) {
    if (!safePreviewUrl(url, true)) return;
    const job = imageJob ?? { key: activeKey, replace: false };
    const image: ImageData = { src: url, alt, ...(credit ? { credit: credit.credit, creditURL: credit.creditURL } : {}) };
    editor.update(() => {
      const previous = L.$getNodeByKey(job.key);
      if (previous instanceof ImageNode && job.replace) {
        previous.setImage({ ...image, credit: image.credit, creditURL: image.creditURL });
        const selection = L.$createNodeSelection(); selection.add(previous.getKey()); L.$setSelection(selection); hoverKey = ""; return;
      }
      const node = new ImageNode(image), paragraph = L.$createParagraphNode();
      if (previous && job.replace) previous.replace(node);
      else if (previous) previous.insertAfter(node);
      else L.$getRoot().append(node);
      node.insertAfter(paragraph); paragraph.select(); hoverKey = "";
    });
    imageJob = null; editor.focus();
  }
  function closeMenu() { for (const popup of [menu, tableMenu, formatMenu]) if (popup?.matches(":popover-open")) popup.hidePopover(); }
  function openMenu(event?: MouseEvent, popup = menu) {
    if (suppressClick) { suppressClick = false; return; }
    const fromToolbar = !!(event?.currentTarget as Element)?.closest('.body-toolbar, .block-float');
    if (fromToolbar) hoverKey = "";
    else editor.update(() => { const node = L.$getNodeByKey(hoverKey || activeKey); if (node) { const selection = L.$createNodeSelection(); selection.add(node.getKey()); L.$setSelection(selection); } });
    const rect = ((event?.currentTarget as HTMLElement) ?? handle).getBoundingClientRect();
    menuPosition = `left:${Math.max(8, Math.min(rect.left, view.innerWidth - 232))}px;top:${Math.max(8, Math.min(rect.bottom + 4, view.innerHeight - 280))}px`;
    popup.showPopover();
    void tick().then(() => popup.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  }
  function formatKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); formatTrigger?.focus(); return; }
    if (event.key === "Tab") { closeMenu(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...formatMenu.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(root.ownerDocument.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }
  function blockAction(action: "duplicate" | "delete" | "up" | "down") {
    const key = hoverKey || activeKey;
    const tree = editor.getEditorState().toJSON();
    closeMenu();
    editor.update(() => {
      const node = L.$getNodeByKey(key);
      if (!node) return;
      if (action === "duplicate") { const index = L.$getRoot().getChildren().findIndex(child => child.getKey() === key); const copy = L.$parseSerializedNode(tree.root.children[index]); node.insertAfter(copy); if (L.$isElementNode(copy)) copy.selectEnd(); }
      else if (action === "delete") { const next = node.getNextSibling() ?? node.getPreviousSibling(); node.remove(); if (L.$isElementNode(next)) next.selectEnd(); }
      else { const sibling = action === "up" ? node.getPreviousSibling() : node.getNextSibling(); if (sibling) { if (action === "up") sibling.insertBefore(node); else sibling.insertAfter(node); } }
      if (L.$getRoot().isEmpty()) L.$getRoot().append(L.$createParagraphNode());
      hoverKey = "";
    });
    editor.focus();
  }
  function startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    insertion = null;
    drag = { id: event.pointerId, key: hoverKey || activeKey, x: event.clientX, y: event.clientY, moved: false };
    handle.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
    drag.moved = true;
    const elements = [...root.children] as HTMLElement[];
    const target = elements.find(element => { const rect = element.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
    const element = target ?? elements.at(-1);
    if (!element) return;
    const rect = element.getBoundingClientRect(), after = !target;
    drop = { key: element.dataset.blockKey!, after, top: (after ? rect.bottom : rect.top) - surface.getBoundingClientRect().top };
  }
  function endDrag(cancel = false) {
    const moving = drag, target = drop;
    drag = null; drop = null;
    if (moving && handle?.hasPointerCapture(moving.id)) handle.releasePointerCapture(moving.id);
    if (!moving?.moved) return;
    suppressClick = true;
    if (cancel || !target || moving.key === target.key) return;
    editor.update(() => { const node = L.$getNodeByKey(moving.key), destination = L.$getNodeByKey(target.key); if (node && destination) { if (target.after) destination.insertAfter(node); else destination.insertBefore(node); } });
  }
  function hover(event: PointerEvent) {
    if (drag || (event.target as Element).closest('.block-insert')) return;
    if ((event.target as Element).closest('.body-toolbar, .block-float, .block-menu, .select-menu, .markdown-link')) { insertion = null; return; }
    const element = (event.target as Element).closest<HTMLElement>("[data-block-key]");
    if (element && root.contains(element)) { hoverKey = element.dataset.blockKey!; positionHandle(); }
    insertion = null;
    if (!root.contains(event.target as Node)) return;
    const elements = [...root.children] as HTMLElement[];
    for (let index = 1; index < elements.length; index++) {
      const before = elements[index - 1].getBoundingClientRect(), after = elements[index].getBoundingClientRect();
      const top = (before.bottom + after.top) / 2;
      if (Math.abs(event.clientY - top) <= 16) {
        insertion = { after: elements[index - 1].dataset.blockKey!, top: top - 14, left: (before.left + before.right) / 2 - 14 };
        break;
      }
    }
  }
  function leaveInsertion(event: PointerEvent) {
    if (!root.contains(event.relatedTarget as Node | null) && !(event.relatedTarget as Element | null)?.closest?.('.block-insert') && !root.ownerDocument.activeElement?.closest('.block-insert')) insertion = null;
  }
  function positionInsertion() {
    if (!insertion) return;
    const previous = [...root.children].find(element => (element as HTMLElement).dataset.blockKey === insertion!.after);
    const next = previous?.nextElementSibling;
    if (!previous || !next) { insertion = null; return; }
    const before = previous.getBoundingClientRect(), after = next.getBoundingClientRect(), top = (before.bottom + after.top) / 2;
    const minTop = inline ? 14 : (editorHost.querySelector('.body-toolbar')?.getBoundingClientRect().bottom ?? 0) + 14;
    insertion = top < minTop || top > view.innerHeight - 14 ? null : { after: insertion.after, top: top - 14, left: (before.left + before.right) / 2 - 14 };
  }
  function insertParagraph() {
    const key = insertion?.after;
    if (!key) return;
    insertion = null; closeMenu(); dismissSlash();
    root.focus({ preventScroll: true });
    editor.update(() => {
      const previous = L.$getNodeByKey(key);
      if (!previous || !L.$isRootNode(previous.getParent())) return;
      const paragraph = L.$createParagraphNode();
      previous.insertAfter(paragraph);
      const selection = paragraph.selectStart(); selection.format = 0; selection.style = "";
      hoverKey = "";
    }, { discrete: true });
  }
  function contentClick(event: MouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>('figure[data-block-key],hr[data-block-key]');
    if (event.type === "pointerdown" && !element) {
      editor.update(() => { if (L.$isNodeSelection(L.$getSelection())) L.$setSelection(null); }, { discrete: true });
      return;
    }
    if (element || (event.target as Element).closest('a')) event.preventDefault();
    if (element) { root.focus({ preventScroll: true }); editor.update(() => { const selection = L.$createNodeSelection(); selection.add(element.dataset.blockKey!); L.$setSelection(selection); }); }
  }
</script>


{#snippet formatButtons()}
  {#each marks.slice(0, 2) as mark}
    <button type="button" aria-label={mark.label} data-tooltip={mark.label} aria-pressed={activeMarks.includes(mark.type)} onpointerdown={event => event.preventDefault()} onclick={() => format(mark.type)}><Icon name={mark.icon} size={18} /></button>
  {/each}
  <button type="button" aria-label="Link" data-tooltip="Link" aria-expanded={linkOpen} aria-controls={`${id}-link`} onpointerdown={event => event.preventDefault()} onclick={openLink}><Icon name="link" size={18} /></button>
  <button type="button" aria-label="More formatting" data-tooltip="More formatting" aria-haspopup="menu" aria-expanded={formatsOpen} aria-controls={`${id}-formats`} popovertarget={`${id}-formats`} onpointerdown={event => event.preventDefault()} onclick={event => { event.preventDefault(); formatTrigger = event.currentTarget; formatMenu.matches(':popover-open') ? closeMenu() : openMenu(event, formatMenu); }}><Icon name="caretDown" size={18} /></button>
{/snippet}
{#snippet tableControls()}
  <div class="block-table-controls" role="group" aria-label="Table controls">
    <button type="button" disabled={!tableCell || tableRows >= MAX_TABLE_ROWS} onpointerdown={event => event.preventDefault()} onclick={() => tableAction("row")}><Icon name="plus" />Add row below</button>
    <button type="button" disabled={!tableCell || tableColumns >= MAX_TABLE_COLUMNS} onpointerdown={event => event.preventDefault()} onclick={() => tableAction("column")}><Icon name="plus" />Add column right</button>
    <button type="button" disabled={!tableCell || tableRows <= 1} onpointerdown={event => event.preventDefault()} onclick={() => tableAction("delete-row")}><Icon name="minus" />Remove row</button>
    <button type="button" disabled={!tableCell || tableColumns <= 1} onpointerdown={event => event.preventDefault()} onclick={() => tableAction("delete-column")}><Icon name="minus" />Remove column</button>
    <label class="inline"><Icon name="table" /><span>Header row</span><input type="checkbox" role="switch" class="switch" checked={tableHeader} disabled={!tableCell} onchange={event => tableAction("header", event.currentTarget.checked)} /></label>
  </div>
{/snippet}
{#snippet toolbar(image: boolean)}
  <div class="body-toolbar formatting-toolbar" class:image-toolbar={image} role="group" aria-label={image ? "Image editing" : "Body formatting"} style={inline || image ? floating : undefined} hidden={markdownView || ((inline || image) && !floating) || (image && !imageData)}>
    {#if image}
      <button type="button" aria-label="Edit alt text" data-tooltip="Edit alt text" onpointerdown={event => event.preventDefault()} onclick={openAlt}><Icon name="textAa" size={18} /></button>
      <button type="button" aria-label={imageData?.url ? "Edit image link" : "Add image link"} data-tooltip={imageData?.url ? "Edit image link" : "Add image link"} onpointerdown={event => event.preventDefault()} onclick={openLink}><Icon name="link" size={18} /></button>
    {:else}
    <Select ariaLabel="Block type" data-tooltip={activeBlock?.label ?? "Block type"} icon={activeBlock?.icon ?? "paragraph"} value={imageData ? "" : blockType} options={textBlocks} disabled={!!imageData} onchange={next => { hoverKey = ""; changeBlock(String(next)); }} />
    {#if !inline || !["image", "divider"].includes(blockType)}<span class="toolbar-separator" aria-hidden="true"></span>{@render formatButtons()}<span class="toolbar-separator" aria-hidden="true"></span>{/if}
    {/if}
    <ImagePicker toolbar value={image ? imageData?.src ?? "" : ""} altText={image ? imageData?.alt ?? "" : ""} triggerLabel={image ? "Replace image" : "Insert image"} onopen={() => { if (!imageJob) imageJob = { key: activeKey, replace: image }; linkOpen = false; altOpen = false; }} onpick={pickImage} onclose={() => { imageJob = null; refocus(); }} />
    {#if !image}
    <button type="button" aria-label="Table" data-tooltip="Table" aria-pressed={blockType === "table"} popovertarget={`${id}-table`} onpointerdown={event => event.preventDefault()} onclick={event => { event.preventDefault(); tableMenu.matches(':popover-open') ? closeMenu() : openMenu(event, tableMenu); }}><Icon name="table" size={18} /></button>
    <button type="button" aria-label="Bulleted list" data-tooltip="Bulleted list" aria-pressed={listType === "bullet"} disabled={["image", "divider"].includes(blockType)} onpointerdown={event => event.preventDefault()} onclick={() => toggleList("bullet")}><Icon name="listBullets" size={18} /></button>
    <button type="button" aria-label="Numbered list" data-tooltip="Numbered list" aria-pressed={listType === "number"} disabled={["image", "divider"].includes(blockType)} onpointerdown={event => event.preventDefault()} onclick={() => toggleList("number")}><Icon name="listNumbers" size={18} /></button>
    {#if !inline}
      <button type="button" class="block-history" disabled={!canUndo} onclick={() => editor.dispatchCommand(L.UNDO_COMMAND, undefined)}>Undo</button>
      <button type="button" class="block-history" disabled={!canRedo} onclick={() => editor.dispatchCommand(L.REDO_COMMAND, undefined)}>Redo</button>
      <button type="button" class="block-add" aria-label="Add block" data-tooltip="Add block" onclick={addBlock}>Add block</button>
    {/if}
    {/if}
    {#if inline || image}<span class="toolbar-separator" aria-hidden="true"></span><button type="button" aria-label="More actions" data-tooltip="More actions" aria-haspopup="true" popovertarget={`${id}-actions`} onpointerdown={event => event.preventDefault()} onclick={event => { event.preventDefault(); menu.matches(':popover-open') ? closeMenu() : openMenu(event); }}><Icon name="dotsThreeOutlineVertical" size={18} /></button>{/if}
  </div>
{/snippet}
<div class="block-editor" bind:this={editorHost}>
  {#if !inline}<div class="markdown-heading"><div class="field-label">Body</div><div class="markdown-modes"><button type="button" aria-pressed={markdownView} onclick={() => { markdownView = !markdownView; linkOpen = false; closeMenu(); dismissSlash(); }}>View as Markdown</button></div></div>{/if}
  {@render toolbar(inline && !!imageData)}
  {#if !inline}{@render toolbar(true)}{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if linkOpen}
    <div class="markdown-link" class:image-form={!!imageData} style={linkPosition} id={`${id}-link`} role="group" aria-label="Edit link" onkeydown={event => { if (event.key === "Escape") { event.stopPropagation(); linkOpen = false; refocus(); } if (event.key === "Enter") { event.preventDefault(); applyLink(); } }}>
      <label for={`${id}-url`}>Link URL</label>
      <div class="markdown-link-controls">
        <input id={`${id}-url`} type="text" placeholder="https://…" bind:this={linkInput} bind:value={linkUrl} aria-invalid={!!linkError} />
        <button type="button" aria-label="Apply link" data-tooltip="Apply link" onclick={() => applyLink()}><Icon name="check" size={16} /></button>
        <button type="button" aria-label="Remove link" data-tooltip="Remove link" onclick={() => applyLink(true)}><Icon name="linkBreak" size={16} /></button>
        <button type="button" aria-label="Close link" data-tooltip="Close link" onclick={() => { linkOpen = false; refocus(); }}><Icon name="x" size={16} /></button>
      </div>
      {#if linkError}<p role="alert">{linkError}</p>{/if}
    </div>
  {/if}
  {#if altOpen}
    <div class="markdown-link image-form" style={linkPosition} role="group" aria-label="Edit image alt text" onkeydown={event => { if (event.key === "Escape") { event.stopPropagation(); altOpen = false; refocus(); } if (event.key === "Enter") { event.preventDefault(); applyAlt(); } }}>
      <label for={`${id}-alt`}>Alt text (leave empty if decorative)</label>
      <div class="markdown-link-controls">
        <input id={`${id}-alt`} type="text" aria-label="Image alt text" bind:this={altInput} bind:value={altText} />
        <button type="button" aria-label="Apply alt text" data-tooltip="Apply alt text" onclick={applyAlt}><Icon name="check" size={16} /></button>
        <button type="button" aria-label="Close alt text" data-tooltip="Close alt text" onclick={() => { altOpen = false; refocus(); }}><Icon name="x" size={16} /></button>
      </div>
    </div>
  {/if}
  {#if !inline && !imageData && floating && !markdownView}<div class="block-float" style={floating} role="group" aria-label="Selected text formatting">{@render formatButtons()}</div>{/if}
  {#if markdownView}
    <div class="block-markdown-view">{#if inline}<button type="button" class="outlined" onclick={async () => { markdownView = false; await tick(); editor.focus(); }}>Close Markdown view</button>{/if}<pre class="block-markdown" aria-label="Body as Markdown" tabindex="0">{articleMarkdown(value)}</pre></div>
  {/if}
  <div class="block-surface" bind:this={surface} hidden={markdownView} onpointermove={hover} role="group" aria-label="Article blocks">
    {#if insertion && !markdownView}<button type="button" class="block-insert" style={`top:${insertion.top}px;left:${insertion.left}px`} aria-label="Insert paragraph here" data-tooltip="Insert paragraph" onpointerdown={event => event.preventDefault()} onpointerleave={leaveInsertion} onblur={() => { insertion = null; }} onclick={insertParagraph}><Icon name="plus" size={16} /></button>{/if}
    {#if !inline}<div class="block-content" contenteditable="true" role="textbox" aria-label="Body" aria-multiline="true" bind:this={root}></div>{/if}
    {#if hoverKey || activeKey}<button bind:this={handle} type="button" class="block-handle" style={`top:${handleTop}px;${inline ? `left:${handleLeft}px` : ''}`} aria-label="Block options and drag handle" data-tooltip="Drag to reorder; click for block options" onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={() => endDrag()} onpointercancel={() => endDrag(true)} onlostpointercapture={() => endDrag(true)} onclick={openMenu}><Icon name="dotsThreeOutlineVertical" size={16} /></button>{/if}
    {#if drop}<div class="block-drop-indicator" style={`top:${drop.top}px;${inline ? `position:fixed;left:${root.getBoundingClientRect().left}px;width:${root.getBoundingClientRect().width}px;right:auto` : ''}`}></div>{/if}
    <div bind:this={slashMenu} class="block-slash" id={`${id}-slash`} popover="manual" style={slashPosition} role="listbox" aria-label="Insert block" onkeydown={slashKeydown}>
      {#if slash !== null}
        <p class="hint">Choose a block</p>
        {#if adding}<input type="search" role="combobox" aria-expanded="true" aria-controls={`${id}-slash`} aria-activedescendant={choices.length ? `${id}-slash-${slashIndex}` : undefined} aria-label="Find a block" placeholder="Find a block…" bind:value={slash} oninput={() => { slashIndex = 0; }} />{/if}
        {#each choices as block, index}<button id={`${id}-slash-${index}`} type="button" role="option" aria-selected={index === slashIndex} onfocus={() => { slashIndex = index; }} onpointerdown={event => event.preventDefault()} onclick={() => changeBlock(block.value, true)}>{block.label}</button>{/each}
        {#if !choices.length}<p role="status">No matching blocks.</p>{/if}
      {/if}
    </div>
  </div>
  <div class="block-menu block-table-menu" id={`${id}-table`} bind:this={tableMenu} popover="auto" style={menuPosition} role="group" aria-label="Table">
    {#if blockType === "table"}{@render tableControls()}{:else}<button type="button" onclick={() => { slashKey = activeKey; adding = true; changeBlock("table", true); }}>Add table</button>{/if}
  </div>
  <div class="block-menu" id={`${id}-actions`} bind:this={menu} popover="auto" style={menuPosition} role="group" aria-label={inline ? "More actions" : "Block options"}>
    {#if inline}
      <button type="button" class="block-history" disabled={!canUndo} onclick={() => { editor.dispatchCommand(L.UNDO_COMMAND, undefined); closeMenu(); editor.focus(); }}>Undo</button>
      <button type="button" class="block-history" disabled={!canRedo} onclick={() => { editor.dispatchCommand(L.REDO_COMMAND, undefined); closeMenu(); editor.focus(); }}>Redo</button>
      <button type="button" onclick={() => { markdownView = true; closeMenu(); }}>View as Markdown</button>
    {/if}
    <button type="button" onclick={() => blockAction("duplicate")}>Duplicate block</button>
    <button type="button" onclick={() => blockAction("delete")}>Delete block</button>
    <button type="button" onclick={() => blockAction("up")}>Move up</button>
    <button type="button" onclick={() => blockAction("down")}>Move down</button>
    {#if !inline}<Select ariaLabel="Convert block type" value={blockType} options={textBlocks} onchange={next => changeBlock(String(next))} />{/if}
  </div>
  <div class="block-menu block-format-menu" id={`${id}-formats`} bind:this={formatMenu} popover="auto" style={menuPosition} role="menu" tabindex="-1" aria-label="More formatting" ontoggle={event => { formatsOpen = event.currentTarget.matches(':popover-open'); }} onkeydown={formatKeydown}>
    {#each marks.slice(2) as mark}
      <button type="button" role="menuitemcheckbox" aria-label={mark.label} aria-checked={activeMarks.includes(mark.type)} onpointerdown={event => event.preventDefault()} onclick={() => format(mark.type)}><Icon name={mark.icon} size={16} /><span>{mark.label}</span>{#if activeMarks.includes(mark.type)}<Icon name="check" size={16} />{/if}</button>
    {/each}
  </div>
</div>
