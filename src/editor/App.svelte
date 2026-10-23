<script lang="ts">
  import type {
    Manifest,
    ManifestCollection,
    CollectionPost,
  } from "../manifest/types";
  import Field from "./lib/Field.svelte";
  import SitePreview from "./lib/SitePreview.svelte";
  import ImagePicker from "./lib/ImagePicker.svelte";
  import Settings from "./lib/Settings.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import Shortcuts from "./lib/Shortcuts.svelte";
  import CollectionPanel from "./lib/CollectionPanel.svelte";
  import { emptyBody, type ArticleBody } from "../article-body";
  import SchemaPanel from "./lib/SchemaPanel.svelte";
  import { collectionPreviewValues, referenceLabel, referenceOptions } from "../manifest/references";
  import { isSeoField } from "../manifest/seo";
  import { initialCollectionValues } from "../manifest/collections";
  import { slugify } from "./lib/slugify";
  import Icon from "./lib/Icon.svelte";
  import SidebarIcon from "./lib/SidebarIcon.svelte";
  import logo from "./assets/rigelcms-icon.png?url";
  import { getSettings, setSettings } from "./lib/settings";
  import { eraseData } from "./lib/storage";
  import MenuEditor from "./lib/MenuEditor.svelte";
  import type { MenuItem } from "../manifest/menu";
  import UnsavedChanges from "./lib/UnsavedChanges.svelte";
  import ActionDialog from "./lib/ActionDialog.svelte";
  import VisualEditor from "./lib/VisualEditor.svelte";
  import { newDocumentFromTemplate } from "../schema/paths";
  import { previewUrl } from "../preview";
  import type { ContentDocument, Schema } from "../schema/types";
  import { buildSidebar, navigationKey, type Selection } from "../manifest/navigation";
  import { startGitHubLogin, checkGitHubAccess, type GitHubAccess } from "./lib/github-auth";
  import { loadManifestRemote, saveRemoteSelection, deleteRemotePost, type GitContext } from "./lib/github-backend";

  type Sel = Selection;

  let manifest = $state<Manifest>({ pages: [] });
  let ready = $state(false);
  let blueprint: Manifest | null = null;
  let gitContext: GitContext | null = null;
  let connected = $state(false);
  let connectionBusy = $state(false);
  let connectionError = $state("");
  let loadError = $state("");
  let githubAccess = $state<GitHubAccess | null>(null);
  let sessionExpiresAt = $state(0);
  let tokenExpired = $state(false);
  const githubMode = $derived(manifest.backend === "github");
  let sel = $state<Sel | null>(null);
  const previewTarget = $derived(sel?.kind === "page" ? sel : null);
  let draft = $state<Record<string, unknown>>({});
  let bodyDraft = $state<"" | ArticleBody>("");
  let bodyBase = $state<"" | ArticleBody>("");
  let dirty = $state(false);
  let saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let saveTask: Promise<boolean> | null = null;
  let saveError = $state("");
  let pendingNavigation = $state<(() => void) | null>(null);
  let actionDialog = $state<{ title: string; description: string; confirmLabel: string; fieldLabel?: string; danger?: boolean; onconfirm: (value: string) => void | Promise<void> } | null>(null);
  let newEntry = $state<{ collection: string; post: CollectionPost } | null>(null);
  let newDocument = $state<{ type: string; id: string; slug: string } | null>(null);
  let docBase = $state<Record<string, unknown> | null>(null);
  let documentReload = $state(0);
  if (import.meta.hot) import.meta.hot.on("rigel:content-updated", () => { if (!githubMode) documentReload += 1; });

  async function loadBlueprint() {
    loadError = "";
    ready = false;
    try {
      const response = await fetch("/rigel/manifest.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the editor configuration. Rebuild the site and try again.");
      const data: Manifest = await response.json();
      if (!Array.isArray(data.pages) || (data.backend === "github" && !data.github)) throw new Error("The editor configuration is incomplete. Rebuild the site and try again.");
      blueprint = data;
      manifest = data;
      ready = true;
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Could not load the editor configuration.";
    }
  }

  function requireGitContext() {
    if (connectionBusy) throw new Error("Wait for GitHub access verification before saving.");
    if (!gitContext || !connected || githubAccess?.status !== "ready") throw new Error("Connect GitHub and verify repository access before saving.");
    if (Date.now() >= sessionExpiresAt - 30_000) {
      tokenExpired = true;
      throw new Error("Your GitHub session expired. Reconnect GitHub, then retry. Your unsaved edits are still here.");
    }
    return gitContext;
  }

  async function verifyGitHub() {
    const config = blueprint?.github;
    if (!config || !gitContext) return;
    if (Date.now() >= sessionExpiresAt - 30_000) throw new Error("Your GitHub session expired. Sign in again to check repository access.");
    githubAccess = await checkGitHubAccess(gitContext.token, config.repo, config.appSlug);
    if (githubAccess.status !== "ready") return;
    if (!connected && blueprint) {
      const remote = await loadManifestRemote(gitContext, blueprint);
      manifest = remote;
      connected = true;
    }
  }

  async function connectGitHub() {
    if (connectionBusy || saveState === "saving" || !manifest.github) return;
    connectionBusy = true;
    connectionError = "";
    try {
      const session = await startGitHubLogin(manifest.github.authOrigin);
      if (gitContext) gitContext.token = session.accessToken;
      else gitContext = { token: session.accessToken, repo: manifest.github.repo, branch: manifest.github.branch };
      githubAccess = null;
      sessionExpiresAt = session.expiresAt;
      await verifyGitHub();
    } catch (error) {
      connectionError = error instanceof Error ? error.message : "Could not connect GitHub. Try signing in again.";
    } finally {
      connectionBusy = false;
    }
  }

  async function recheckGitHub() {
    if (connectionBusy) return;
    connectionBusy = true;
    connectionError = "";
    try { await verifyGitHub(); }
    catch (error) { connectionError = error instanceof Error ? error.message : "Could not check GitHub access. Try again."; }
    finally { connectionBusy = false; }
  }

  function signOut() {
    if (saveState === "saving" || connectionBusy) return;
    userOpen = false;
    requestNavigation(() => {
      gitContext = null;
      sessionExpiresAt = 0;
      githubAccess = null;
      connected = false;
      connectionError = "";
      settingsOpen = false;
      shortcutsOpen = false;
      newEntry = null;
      newDocument = null;
      draft = {};
      bodyDraft = "";
      bodyBase = "";
      docBase = null;
      dirty = false;
      saveState = "idle";
      saveError = "";
      sel = null;
      if (blueprint) manifest = structuredClone(blueprint);
    });
  }

  $effect(() => {
    const expiry = sessionExpiresAt;
    tokenExpired = !!expiry && Date.now() >= expiry - 30_000;
    if (!expiry) return;
    const timer = setTimeout(() => { tokenExpired = true; }, Math.max(0, expiry - Date.now() - 30_000));
    return () => clearTimeout(timer);
  });

  function save(): Promise<boolean> {
    if (saveTask) return saveTask;
    saveTask = (async () => {
      if (dirty) {
        saveState = "saving";

        const values = JSON.parse(JSON.stringify(draft));
        const body = JSON.parse(JSON.stringify(bodyDraft));
        const p = page, po = post, c = coll, m = menu;
        const creating = newEntry;
        const selection = sel;
        const docSel = sel?.kind === "document" ? sel : null;
        const creatingDoc = docSel !== null && newDocument?.id === docSel.id;
        try {
          if (githubMode) {
            if (!selection) throw new Error("Select content before saving.");
            await saveRemoteSelection(requireGitContext(), manifest, selection, values, body, !!creating || creatingDoc);
          } else {
          const url = docSel
            ? `/rigel/api/local/documents/${encodeURIComponent(docSel.id)}`
            : m ? `/rigel/api/local/menus/${m.slug}` : po && c ? `/rigel/api/local/${c.name}/${encodeURIComponent(po.slug)}` : "/rigel/api/local/save";
          const payload = docSel ? { data: values } : m ? { slug: m.slug, title: values.title, items: values.items } : po ? { frontmatter: values, body } : { slug: p?.slug, values };
          const res = await fetch(url, { method: docSel ? (creatingDoc ? "POST" : "PUT") : m ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!res.ok) throw new Error((await res.text()) || `Save failed (${res.status})`);
          }
          if (docSel) {
            const list = manifest.documents ?? (manifest.documents = []);
            const existing = list.find((entry) => entry.id === docSel.id);
            if (existing) existing.data = values;
            else list.push({ id: docSel.id, type: docSel.type, slug: docSel.id.slice(docSel.type.length + 1), data: values });
            newDocument = null;
            docBase = JSON.parse(JSON.stringify(values));
          } else if (m) { m.title = values.title; m.items = values.items; }
          else if (po) { po.frontmatter = { slug: po.slug, ...values }; po.body = body; bodyBase = body; }
          else if (p) p.values = values;
          if (creating && po && c) c.posts.push(po);
          newEntry = null;
          dirty = JSON.stringify({ fm: draft, body: bodyDraft }) !== JSON.stringify({ fm: docSel ? docBase : values, body });
          saveState = dirty ? "idle" : "saved";
          saveError = "";
        } catch (error) {
          saveState = "error";
          saveError = error instanceof Error ? error.message : "Could not save changes";
          return false;
        }
      }
      return !dirty;
    })().finally(() => { saveTask = null; });
    return saveTask;
  }
  let settingsOpen = $state(false);
  let userOpen = $state(false);
  let shortcutsOpen = $state(false);

  let settings = $state(getSettings());
  let settingsError = $state("");
  const userName = $derived(githubMode ? githubAccess?.user.login ?? "GitHub user" : "Local user");
  const userAvatar = $derived(githubMode && /^https:\/\/avatars\.githubusercontent\.com\//.test(githubAccess?.user.avatar_url ?? "") ? githubAccess!.user.avatar_url : "");
  let failedAvatar = $state("");
  const userMode = $derived(githubMode ? `${manifest.github?.repo} · ${manifest.github?.branch}` : "Local mode");
  let content: HTMLDivElement;
  let contentWidth = $state(0);
  let resizing = $state(false);
  let resizePointer: { element: HTMLElement; id: number } | null = null;
  const splitMin = $derived(Math.min(0.5, Math.max(0.2, 320 / Math.max(1, contentWidth - 10))));
  const splitMax = $derived(1 - splitMin);
  const previewSplit = $derived(Math.max(splitMin, Math.min(splitMax, settings.userPref.previewSplit)));

  function setPreviewSplit(value: number) {
    settings.userPref.previewSplit = Math.max(splitMin, Math.min(splitMax, value));
  }

  function endPreviewResize() {
    const pointer = resizePointer;
    resizePointer = null;
    resizing = false;
    if (pointer?.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
  }

  function startPreviewResize(event: PointerEvent) {
    if (event.button !== 0 || resizePointer) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.focus();
    element.setPointerCapture(event.pointerId);
    resizePointer = { element, id: event.pointerId };
    resizing = true;
  }

  function movePreviewResize(event: PointerEvent) {
    if (resizePointer?.id !== event.pointerId) return;
    setPreviewSplit((event.clientX - content.getBoundingClientRect().left - 5) / (contentWidth - 10));
  }

  function keyPreviewResize(event: KeyboardEvent) {
    const value = { ArrowLeft: previewSplit - 0.02, ArrowRight: previewSplit + 0.02, Home: splitMin, End: splitMax }[event.key];
    if (value === undefined) return;
    event.preventDefault();
    setPreviewSplit(value);
  }

  $effect(() => {
    previewTarget;
    return endPreviewResize;
  });

  function eraseBrowserData() {
    actionDialog = {
      title: "Erase browser data?", confirmLabel: "Erase data", danger: true,
      description: "This removes Rigel settings, API keys and unsaved drafts from this browser. Saved repository files will not change. The editor will reload.",
      onconfirm: () => {
        if (saveState === "saving") throw new Error("Wait for the current save to finish.");
        eraseData();
        dirty = false;
        location.reload();
      },
    };
  }
  let sortBy = $state("");
  let sortDir = $state<1 | -1>(1);


  function pageSlug(s: Sel | null): string | null {
    return s && s.kind === "page" ? s.slug : null;
  }
  const page = $derived.by(() => {
    const slug = pageSlug(sel);
    return slug ? manifest.pages.find((p) => p.slug === slug) : undefined;
  });

  function findColl(name: string): ManifestCollection | undefined {
    return manifest.collections?.find((x) => x.name === name);
  }

  function collName(s: Sel | null): string | null {
    if (!s) return null;
    if (s.kind === "post") return s.collection;
    if (s.kind === "collection") return s.name;
    return null;
  }

  const coll = $derived.by((): ManifestCollection | undefined => {
    const n = collName(sel);
    return n ? findColl(n) : undefined;
  });

  function postSlug(s: Sel | null): string | null {
    return s && s.kind === "post" ? s.slug : null;
  }
  const post = $derived.by(() => {
    const slug = postSlug(sel);
    if (!slug || !coll) return undefined;
    if (newEntry && newEntry.collection === coll.name && newEntry.post.slug === slug) return newEntry.post;
    return coll.posts.find((p) => p.slug === slug);
  });

  const columns = $derived.by((): { key: string; label: string; image?: boolean }[] => {
    if (sel?.kind === "menus") return [{ key: "title", label: "Name" }, { key: "slug", label: "Slug" }];
    if (sel?.kind === "pages") return [{ key: "label", label: "Title" }, { key: "slug", label: "Slug" }, { key: "category", label: "Category" }];
    const source = sel?.kind === "documents" ? activeDocType : coll;
    if (!source) return [];
    const keys = ["title", "slug", ...(source.columns ?? (sel?.kind === "documents" ? [] : source.fields.filter(field => !isSeoField(field.key)).map(field => field.key)))];
    const titleLabel = sel?.kind === "documents" && !source.fields.some(field => field.key === "title") ? source.fields.find(field => field.key === "name")?.label ?? "Title" : "Title";
    const seen = new Set<string>();
    const out: { key: string; label: string; image?: boolean }[] = [];

    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const f = source.fields.find((x) => x.key === k);
      out.push({ key: k, label: k === "slug" ? "Slug" : k === "title" ? titleLabel : f?.label ?? k, image: f?.type === "image" });
    }
    return sel?.kind === "documents" ? [...out.filter(column => column.image), ...out.filter(column => !column.image && column.key !== "slug"), ...out.filter(column => column.key === "slug")] : out;
  });

  const sortedPosts = $derived.by(() => {
    if (!coll) return [];
    const posts = [...coll.posts];
    if (!sortBy) return posts;
    return posts.sort((a, b) => {
      const va = cellValue(a, sortBy);
      const vb = cellValue(b, sortBy);
      return va.localeCompare(vb) * sortDir;
    });
  });

  const sidebar = $derived(buildSidebar(manifest));
  const pageCategory = $derived(sel?.kind === "pages" ? sel.category : undefined);
  const schema = $derived<Schema | undefined>(manifest.schema);
  const docTypes = $derived(schema?.documents ?? []);

  const pageDocType = $derived(docTypes.find((type) => !type.shared && !type.singleton));
  const pageDocuments = $derived((manifest.documents ?? []).filter((doc) => docTypes.some(type => type.name === doc.type && !type.shared)));
  function docTypeName(s: Sel | null): string | null {
    return s && (s.kind === "document" || s.kind === "documents") ? s.type : null;
  }
  const activeDocType = $derived(docTypes.find((type) => type.name === docTypeName(sel)));
  const activeDocument = $derived.by(() => {
    const id = sel?.kind === "document" ? sel.id : null;
    return (manifest.documents ?? []).find(doc => doc.id === id);
  });
  const draftDocuments = $derived.by(() => {
    const map: Record<string, Record<string, unknown>> = {};
    for (const doc of manifest.documents ?? []) map[doc.id] = doc.data;
    const current = sel;
    if (current?.kind === "document") map[current.id] = draft;
    return map;
  });
  function documentPreview(mode: "live" | "draft") {
    if (sel?.kind !== "document" || newDocument?.id === sel.id) return null;
    return previewUrl(manifest.preview ?? {}, { kind: "document", type: sel.type, slug: sel.id.slice(sel.type.length + 1) }, mode);
  }
  const standaloneDocument = $derived(sel?.kind === "document" && activeDocType?.shared === true);
  const visualSelection = $derived(sel?.kind === "post" || (sel?.kind === "document" && !standaloneDocument));

  const sortedPages = $derived.by(() => {
    const rows = [
      ...manifest.pages.filter((p) => !p.shared && (pageCategory === undefined || p.category === pageCategory))
        .map((p) => ({ slug: p.slug, title: p.label, category: p.category, draft: false, target: { kind: "page", slug: p.slug } as Sel })),
      ...(pageCategory === undefined ? pageDocuments
        .map((doc) => ({ slug: doc.slug, title: String(doc.data.title ?? doc.slug), category: undefined, draft: doc.data.draft === true, target: { kind: "document", type: doc.type, id: doc.id } as Sel })) : []),
    ];
    const key = sortBy === "slug" || sortBy === "category" ? sortBy : "title";
    return rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * sortDir);
  });
  function documentCell(doc: ContentDocument, key: string): string {
    return String(key === "title" ? doc.data.title ?? doc.data.name ?? doc.slug : key === "slug" ? doc.slug : doc.data[key] ?? "");
  }
  const typeDocuments = $derived((manifest.documents ?? []).filter((doc) => doc.type === docTypeName(sel)).sort((a, b) => documentCell(a, sortBy).localeCompare(documentCell(b, sortBy)) * sortDir));


  const menu = $derived.by(() => { const slug = sel?.kind === "menu" ? sel.slug : null; return manifest.menus?.entries.find((m) => m.slug === slug); });
  const sortedMenus = $derived([...(manifest.menus?.entries ?? [])].sort((a, b) => (sortBy === "slug" ? a.slug.localeCompare(b.slug) : a.title.localeCompare(b.title)) * sortDir));
  const listTitle = $derived(sel?.kind === "menus" ? "All Menus" : sel?.kind === "documents" ? activeDocType?.title ?? "Documents" : sel?.kind === "pages" ? `All ${pageCategory ?? "pages"}` : coll?.listTitle?.trim() || `All ${coll?.label ?? "entries"}`);
  const listRows = $derived(sel?.kind === "menus"
    ? sortedMenus.map((m) => ({ slug: m.slug, cells: { slug: m.slug, title: m.title } as Record<string, string>, draft: false, target: { kind: "menu", slug: m.slug } as Sel }))
    : sel?.kind === "documents"
    ? typeDocuments.map((doc) => ({ slug: doc.slug, cells: Object.fromEntries(columns.map(column => [column.key, documentCell(doc, column.key)])), draft: doc.data.draft === true, target: { kind: "document", type: doc.type, id: doc.id } as Sel }))
    : sel?.kind === "pages"
    ? sortedPages.map((p) => ({ slug: p.slug, cells: { label: p.title, slug: p.slug, category: p.category ?? "—" } as Record<string, string>, draft: p.draft, target: p.target }))
    : sortedPosts.map((p) => ({ slug: p.slug, cells: Object.fromEntries(columns.map((c) => [c.key, cellValue(p, c.key)])), draft: Boolean(p.frontmatter.draft), target: { kind: "post", collection: coll!.name, slug: p.slug } as Sel })));
  const titleColumn = $derived(sel?.kind === "pages" ? "label" : "title");

  function goWelcome() {
    void select(null);
  }

  $effect(() => {
    void loadBlueprint();
  });

  $effect(() => {
    try {
      setSettings(settings);
      settingsError = "";
    } catch {
      settingsError = "Settings could not be saved in this browser. Allow browser storage and try again.";
    }
  });

  $effect(() => {
    const theme = settings.theme;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "dark" || (theme === "system" && media.matches) ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  });

  $effect(() => {
    document.documentElement.dataset.contrast = settings.highContrast ? "high" : "normal";
  });

  function sameSel(a: Sel, b: Sel): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "menus" || a.kind === "media") return true;
    if (a.kind === "menu" && b.kind === "menu") return a.slug === b.slug;
    if (a.kind === "pages" && b.kind === "pages") return a.category === b.category;
    if (a.kind === "page" && b.kind === "page") return a.slug === b.slug;
    if (a.kind === "documents" && b.kind === "documents") return a.type === b.type;
    if (a.kind === "document" && b.kind === "document") return a.type === b.type && a.id === b.id;
    if (a.kind === "collection" && b.kind === "collection") return a.name === b.name;
    if (a.kind === "post" && b.kind === "post")
      return a.collection === b.collection && a.slug === b.slug;
    return false;
  }

  function navActive(target: Sel): boolean {
    if (!sel) return false;
    if (sameSel(sel, target)) return true;
    if (target.kind === "collection") return sel.kind === "post" && sel.collection === target.name;
    if (target.kind === "menus") return sel.kind === "menu";
    if (target.kind === "documents") return sel.kind === "document" && sel.type === target.type;
    if (target.kind === "pages") {
      if (sel.kind === "page") return !page?.shared && (target.category ? page?.category === target.category : !page?.category);
      const typeName = sel.kind === "document" ? sel.type : null;
      return !target.category && docTypes.some(type => type.name === typeName && !type.shared);
    }
    return false;
  }

  function requestNavigation(action: () => void) {
    if (dirty || saveState === "saving") pendingNavigation = action;
    else action();
  }

  async function saveAndLeave() {
    if (!(await save())) return;
    const action = pendingNavigation;
    pendingNavigation = null;
    action?.();
  }

  function discardAndLeave() {
    const action = pendingNavigation;
    pendingNavigation = null;
    const fallback: Sel | null = newEntry ? { kind: "collection", name: newEntry.collection } : newDocument ? { kind: "pages" } : sel;
    newEntry = null;
    newDocument = null;
    openSelection(fallback);
    action?.();
  }

  function select(next: Sel | null) {
    if (sel && next && sameSel(sel, next)) return;
    requestNavigation(() => openSelection(next));
  }

  function openSelection(next: Sel | null) {
    sel = next;
    saveError = "";
    sortBy = "";
    sortDir = 1;
    if (next?.kind === "menu") {
      const m = menu;
      if (!m) return;
      draft = JSON.parse(JSON.stringify({ title: m.title, items: m.items }));
      bodyDraft = "";
      bodyBase = "";
    } else if (next?.kind === "page") {
      const p = manifest.pages.find((x) => x.slug === next.slug);
      if (!p) return;
      draft = JSON.parse(JSON.stringify(p.values));
      bodyDraft = "";
      bodyBase = "";
    } else if (next?.kind === "document") {
      if (newDocument?.id === next.id) docBase = null;
      else {
        const doc = (manifest.documents ?? []).find((entry) => entry.id === next.id);
        if (!doc) return;
        draft = JSON.parse(JSON.stringify(doc.data));
        docBase = JSON.parse(JSON.stringify(doc.data));
      }
      bodyDraft = "";
      bodyBase = "";
    } else if (next?.kind === "post") {
      const po = post;
      if (!po) return;
      const fm: Record<string, unknown> = { ...po.frontmatter };
      delete fm.slug;
      draft = JSON.parse(JSON.stringify(fm));
      bodyDraft = po.body;
      bodyBase = po.body;
    }
    dirty = newEntry !== null || (newDocument !== null && next?.kind === "document");
    saveState = "idle";

  }

  function sort(key: string) {
    if (sortBy === key) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortBy = key;
      sortDir = 1;
    }
  }

  function touch() {
    if (sel?.kind === "document") {
      dirty = JSON.stringify(draft) !== JSON.stringify(docBase);
      if (saveState !== "saving") saveState = "idle";
      return;
    }
    const ref =
      sel?.kind === "menu" && menu ? { title: menu.title, items: menu.items } : sel?.kind === "post" && post
        ? Object.fromEntries(
            Object.entries(post.frontmatter).filter(([k]) => k !== "slug"),
          )
        : page?.values;
    dirty =
      newEntry !== null ||
      JSON.stringify({ fm: draft, body: bodyDraft }) !==
      JSON.stringify({ fm: ref, body: bodyBase });
    if (saveState !== "saving") saveState = "idle";
  }

  function cellValue(p: { slug: string; frontmatter: Record<string, unknown> }, key: string): string {
    const v = key === "slug" ? p.slug : p.frontmatter[key];
    const field = coll?.fields.find(field => field.key === key);
    if (field?.type === "reference") return referenceLabel(v, referenceOptions(field, manifest.documents)) || "—";
    if (v === true) return "✓";
    if (v === false || v == null) return "—";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  }

  function newPage(type = pageDocType) {
    if (!type || !schema || type.creatable === false || type.singleton) return;
    actionDialog = {
      title: `Add ${type.title}`, description: "Enter a name to start a draft from the template. Nothing is written until you press Save.", fieldLabel: type.shared ? "Name" : "Page name", confirmLabel: "Create draft",
      onconfirm: (title) => {
        const slug = slugify(title);
        if (!slug) throw new Error("Enter a title containing letters or numbers.");
        const taken = [...(manifest.documents ?? []).filter(doc => !type.shared || doc.type === type.name).map((doc) => doc.slug), ...(!type.shared ? manifest.pages.map((page) => page.slug) : [])];
        if (taken.includes(slug)) throw new Error(`The slug "${slug}" is already used by another document or page.`);
        const id = `${type.name}:${slug}`;
        const data = newDocumentFromTemplate(schema, type.name, title, slug);
        newDocument = { type: type.name, id, slug };
        draft = JSON.parse(JSON.stringify(data));
        docBase = null;
        openSelection({ kind: "document", type: type.name, id });
      },
    };
  }

  function newPost(c: ManifestCollection) {
    actionDialog = {
      title: `Add to ${c.label}`, description: "Enter a title to start a draft. Nothing is written until you press Save.", fieldLabel: "Title", confirmLabel: "Create draft",
      onconfirm: (title) => {
        const slug = slugify(title);
        if (!slug) throw new Error("Enter a title containing letters or numbers.");
        if (c.posts.some((p) => p.slug === slug)) throw new Error(`A post with slug "${slug}" already exists.`);
        newEntry = { collection: c.name, post: { slug, frontmatter: initialCollectionValues(c.fields, title), body: emptyBody() } };
        openSelection({ kind: "post", collection: c.name, slug });
      },
    };
  }

  function deletePost() {
    const current = post, collection = coll, unsaved = newEntry !== null;
    if (!current || !collection) return;
    actionDialog = {
      title: `Delete “${String(current.frontmatter.title ?? current.slug)}”?`, confirmLabel: "Delete", danger: true,
      description: unsaved ? "This discards the new post and its unsaved changes." : `This deletes ${current.slug}.json${githubMode ? ` from ${manifest.github?.branch}` : ""} and discards any unsaved changes. This cannot be undone in the editor.`,
      onconfirm: async () => {
        if (!unsaved) {
          if (githubMode) await deleteRemotePost(requireGitContext(), manifest, collection.name, current.slug);
          else {
          const res = await fetch(`/rigel/api/local/${collection.name}/${encodeURIComponent(current.slug)}`, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.text()) || `Delete failed (${res.status})`);
          }
          collection.posts = collection.posts.filter((p) => p.slug !== current.slug);
        }
        newEntry = null;
        openSelection({ kind: "collection", name: collection.name });
      },
    };
  }


</script>

{#snippet avatar()}
  <span class="avatar">
    {#if userAvatar && failedAvatar !== userAvatar}
      <img src={userAvatar} alt="" width="36" height="36" referrerpolicy="no-referrer" onerror={() => { failedAvatar = userAvatar; }} />
    {:else}
      <Icon name="user" size={20} />
    {/if}
  </span>
{/snippet}

<svelte:window
  onresize={endPreviewResize}
  onblur={endPreviewResize}
  oncontextmenu={(event) => { if (!settings.devMode) event.preventDefault(); }}
  onbeforeunload={(event) => { if (dirty || saveState === "saving") { event.preventDefault(); event.returnValue = ""; } }}
  onclick={(e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.user-menu-wrap')) userOpen = false;
  }}
  onkeydown={(e) => {
    if (e.key === "Escape") endPreviewResize();
    if (e.key === "Escape" && userOpen) {
      userOpen = false;
      document.querySelector<HTMLButtonElement>('.user-btn')?.focus();
    }
  }}
/>
{#if !ready || (githubMode && !connected)}
<div class="rigel connection-shell">
  <main id="github-connection" class="connection-card" aria-busy={connectionBusy}>
    <img src={logo} alt="" width="64" height="64" />
    <h1>{!ready ? "RigelCMS" : "Connect GitHub"}</h1>
    {#if !ready}
      {#if loadError}<p class="connection-error" role="alert">{loadError}</p><button class="primary" onclick={loadBlueprint}>Retry loading</button>
      {:else}<p role="status">Loading the editor configuration…</p>{/if}
    {:else if manifest.github}
      {#if githubAccess}
        <p>Signed in as <strong>{githubAccess.user.login}</strong>.</p>
        {#if githubAccess.status === "read-only" || githubAccess.status === "installation-required"}
          <p>You don’t have editing access. Contact the website administrator.</p>
        {:else}
          <p role="status">{connectionBusy ? "Opening the editor…" : "Access confirmed. Try opening the editor again."}</p>
        {/if}
        {#if githubAccess.status !== "ready"}
          <a id="github-install" class="primary" href={githubAccess.installUrl} target="_blank" rel="noopener noreferrer">Manage GitHub access</a>
        {/if}
      {:else}
        <p>Sign in to edit this website.</p>
      {/if}
      <div class="connection-actions">
        {#if sessionExpiresAt && !tokenExpired}
          <button id="github-check-access" class="primary" disabled={connectionBusy} onclick={recheckGitHub}>{connectionBusy ? "Checking access…" : githubAccess?.status === "ready" ? "Open editor" : "Check access"}</button>
        {/if}
        <button id="github-sign-in" class:primary={!sessionExpiresAt || tokenExpired} class:outlined={sessionExpiresAt > 0 && !tokenExpired} disabled={connectionBusy} onclick={connectGitHub}>{connectionBusy && !sessionExpiresAt ? "Signing in…" : sessionExpiresAt ? "Sign in again" : "Sign in with GitHub"}</button>
      </div>
      <p class="connection-note">By continuing, you agree to the <a href="https://rigelcms.dev/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a> and acknowledge the <a href="https://rigelcms.dev/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>
    {/if}
    {#if connectionError}<p class="connection-error" role="alert">{connectionError}</p>{/if}
  </main>
</div>
{:else}
<div class="rigel" class:sidebar-collapsed={settings.userPref.sidebarCollapsed}>
  <aside id="rigel-sidebar">
    <a class="brand" href="/rigel/" role="button" aria-label="Welcome" aria-describedby="rigel-beta" onclick={(event) => { event.preventDefault(); goWelcome(); }}>
      <img src={logo} alt="" width="32" height="32" />
      <span>RigelCMS</span>
      <span id="rigel-beta" class="badge">Beta</span>
    </a>
    <TopBar {manifest} {sel} onselect={select} />

    <nav id="rigel-sidebar-navigation" class="rail-scroll" aria-label="Content">
      {#each sidebar as node}
        {#if node.kind === "heading"}
          <h3 class="sidebar-heading">{node.label}</h3>
        {:else if node.kind === "separator"}
          <hr class="sidebar-separator" />
        {:else}
          <button
            id={node.target.kind === "media" ? "nav-media" : node.target.kind === "menus" ? "nav-menus" : node.target.kind === "pages" && !node.target.category ? "nav-pages" : undefined}
            data-nav={navigationKey(node.target)}
            data-collection={node.target.kind === "collection" ? node.target.name : undefined}
            data-category={node.target.kind === "pages" ? node.target.category : undefined}
            data-doctype={node.target.kind === "documents" ? node.target.type : undefined}
            data-document={node.target.kind === "document" ? node.target.id : undefined}
            data-page={node.target.kind === "page" ? node.target.slug : undefined}
            aria-label={node.label}
            title={node.label}
            class:active={navActive(node.target)}
            aria-current={navActive(node.target) ? "page" : undefined}
            onclick={() => select(node.target)}
          >
            <SidebarIcon name={node.icon ?? ({ pages: "files", page: "file-text", collection: "newspaper", documents: "squares-four", document: "file-text", menus: "list", media: "images" }[node.target.kind])} /><span class="sidebar-label">{node.label}</span>
          </button>
        {/if}
      {/each}
    </nav>

    <button class="sidebar-toggle" aria-expanded={!settings.userPref.sidebarCollapsed} aria-controls="rigel-sidebar-navigation" aria-label={settings.userPref.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={settings.userPref.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onclick={() => { settings.userPref.sidebarCollapsed = !settings.userPref.sidebarCollapsed; }}>
      <SidebarIcon name="sidebar-simple" /><span class="sidebar-label">Collapse sidebar</span>
    </button>
    <div class="aside-foot">
      <div class="user-menu-wrap">
        <button class="user-btn" aria-label={githubMode ? "GitHub user menu" : "Local user menu"} title={githubMode ? "GitHub user menu" : "Local user menu"} aria-haspopup="menu" aria-expanded={userOpen} onclick={() => (userOpen = !userOpen)}>
          {@render avatar()}
          <span class="user-details"><span class="uname">{userName}</span><small>{userMode}</small></span>
          <span class="user-menu-icon"><Icon name="dotsThreeOutlineVertical" size={18} /></span>
        </button>
        {#if userOpen}
          <div class="user-menu" role="menu">
            <div class="user-menu-head">
              {@render avatar()}
              <div class="user-details"><strong>{userName}</strong><small>{userMode}</small></div>
            </div>
            <div class="divider"></div>
            <a role="menuitem" href="/" target="_blank" rel="noopener">
              <Icon name="external" size={13} />
              Live Site
            </a>
            <div class="divider"></div>
            <button role="menuitem" onclick={() => { userOpen = false; requestNavigation(() => { settingsOpen = true; }); }}>
              <Icon name="gear" size={13} />
              Settings
            </button>
            <button role="menuitem" onclick={() => { userOpen = false; requestNavigation(() => { shortcutsOpen = true; }); }}>
              <Icon name="keyboard" size={13} />
              Keyboard Shortcuts
            </button>
            <div class="divider"></div>
            {#if githubMode}
            <a role="menuitem" href={githubAccess?.installUrl} target="_blank" rel="noopener noreferrer">Configure GitHub access</a>
            <button role="menuitem" class="github-reconnect" disabled={connectionBusy || saveState === "saving"} onclick={() => { userOpen = false; void connectGitHub(); }}>Reconnect GitHub</button>
            {/if}
            <button id={githubMode ? "github-sign-out" : undefined} role="menuitem" class:muted={!githubMode} disabled={!githubMode || saveState === "saving" || connectionBusy} title={githubMode ? "Sign out of this editor" : "Local mode"} onclick={signOut}>
              <Icon name="signOut" size={13} />
              Sign Out
              {#if !githubMode}<span class="soon">backend: github</span>{/if}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </aside>

  <div class="content" bind:this={content} bind:clientWidth={contentWidth} class:resizing-preview={resizing} class:with-preview={manifest.preview && previewTarget !== null} class:visual={visualSelection} style={`--editor-split: ${previewSplit}fr; --preview-split: ${1 - previewSplit}fr`}>
    <main id="rigel-editor-pane" class:wide={sel?.kind === "collection" || sel?.kind === "pages" || sel?.kind === "documents" || sel?.kind === "document" || sel?.kind === "post" || sel?.kind === "menus" || sel?.kind === "menu" || sel?.kind === "media"} class:visual-pane={visualSelection}>
      {#if githubMode && (tokenExpired || githubAccess?.status !== "ready" || connectionError)}
        <div class="github-session" role="status">
          <p>{connectionError || (tokenExpired ? "Your GitHub session expired. Your unsaved edits are still here." : "Repository access changed. Reconnect GitHub before saving.")}</p>
          <button class="primary" disabled={connectionBusy || saveState === "saving"} onclick={connectGitHub}>{connectionBusy ? "Connecting…" : "Reconnect GitHub"}</button>
        </div>
      {/if}
      {#if settingsError}<p role="alert">{settingsError}</p>{/if}
      {#if ready && sel && sel.kind !== "media"}
        {#if sel.kind === "page" || sel.kind === "post" || sel.kind === "menu" || sel.kind === "document"}
        <div class="editor-actions">
        {#if sel.kind === "page" && page}
          <p class="back"><button onclick={() => select(page.shared ? null : { kind: "pages", category: page.category })}>← Back to {page.shared ? "Welcome" : page.category ?? "Pages"}</button></p>
        {:else if sel.kind === "document"}
          {@const backSel: Sel | null = activeDocType?.singleton ? null : sel.type === pageDocType?.name ? { kind: "pages" } : { kind: "documents", type: sel.type }}
          <p class="back"><button onclick={() => select(backSel)}>← Back to {activeDocType?.singleton ? "Welcome" : sel.type === pageDocType?.name ? "Pages" : activeDocType?.title ?? "Documents"}</button></p>
        {:else if sel.kind === "post" && coll}
          <p class="back"><button onclick={() => select({ kind: "collection", name: coll.name })}>← Back to {coll.label}</button></p>
        {:else if sel.kind === "menu"}
          <p class="back"><button onclick={() => select({ kind: "menus" })}>← Back to Menus</button></p>
        {/if}
          <div class="save-actions">
            <span class="save-status" role="status" class:dirty={dirty && saveState !== "saving"} class:saving={saveState === "saving"} class:saved={!dirty && saveState === "saved"} class:error={saveState === "error"}>
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : dirty ? "Unsaved" : saveState === "saved" ? "Saved" : ""}
            </span>
            <button class="primary save-button" disabled={!dirty || saveState === "saving"} onclick={() => save()}>{saveState === "saving" ? "Saving…" : "Save"}</button>
          </div>
        </div>
        {/if}
        <div class="titlebar">
          <h2>{sel.kind === "page" ? page?.label : sel.kind === "menu" ? String(draft.title || menu?.slug || "") : sel.kind === "post" ? String(draft.title || post?.slug || "") : sel.kind === "document" ? activeDocType?.singleton ? activeDocType.title : String(draft.title || draft.name || activeDocument?.slug || sel.id) : listTitle}</h2>
        {#if (sel?.kind === "collection" && coll) || (sel?.kind === "pages" && pageDocType?.creatable !== false && pageDocType) || (sel?.kind === "documents" && activeDocType && activeDocType.creatable !== false && !activeDocType.singleton)}
          <button class="primary" onclick={() => (sel?.kind === "collection" ? newPost(coll!) : newPage(sel?.kind === "documents" ? activeDocType : pageDocType))}>Add new</button>
        {/if}
        {#if sel?.kind === "post" && post}
          <button class="icon-btn" title="Delete post" disabled={saveState === "saving"} onclick={deletePost}>
            <Icon name="trash" size={15} />
          </button>
        {/if}
        </div>
      {/if}
      {#if saveError}
        <div class="save-toast" role="alert">
          <div class="save-toast-content">
            <strong>Could not save changes</strong>
            <p>{saveError}</p>
            <button class="outlined" disabled={saveState === "saving"} onclick={() => save()}>Retry save</button>
            {#if githubMode}<button class="outlined github-reconnect" disabled={connectionBusy || saveState === "saving"} onclick={connectGitHub}>Reconnect GitHub</button>{/if}
          </div>
          <button type="button" class="icon-btn" aria-label="Dismiss save error" onclick={() => { saveError = ""; }}><Icon name="x" size={18} /></button>
        </div>
      {/if}
      {#if !ready}
        <p>Loading…</p>

      {:else if sel?.kind === "media"}
        <ImagePicker inline />
      {:else if sel?.kind === "pages" || sel?.kind === "documents" || sel?.kind === "menus" || (sel?.kind === "collection" && coll)}
        <div class="table-card">
          <table>
            <thead>
              <tr>
                {#each columns as col (col.key)}
                  {#if col.image && sel?.kind === "documents"}
                    <th class="thumbnail-column" aria-label={col.label}></th>
                  {:else}
                  <th aria-sort={sortBy === col.key || (!sortBy && sel?.kind === "pages" && col.key === "label") ? (sortDir === 1 ? "ascending" : "descending") : "none"}>
                    <button class="table-sort" onclick={() => sort(col.key)}>{col.label} {sortBy === col.key ? (sortDir === 1 ? "↑" : "↓") : ""}</button>
                  </th>
                  {/if}
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each listRows as row (navigationKey(row.target))}
                <tr onclick={() => select(row.target)}>
                  {#each columns as col (col.key)}
                    <td>
                      {#if col.key === titleColumn}
                        <button class="table-link" onclick={() => select(row.target)}>{row.cells[col.key]}</button>
                        {#if row.draft}<span class="badge">draft</span>{/if}
                      {:else if col.image}
                        {#if row.cells[col.key]}
                          <img class="table-thumbnail" src={row.cells[col.key]} alt="" width="32" height="32" loading="lazy" decoding="async" />
                        {:else if col.key === "photo"}
                          <span class="table-thumbnail table-avatar-placeholder" aria-hidden="true"><Icon name="user" size={18} /></span>
                        {/if}
                      {:else}
                        {row.cells[col.key]}
                      {/if}
                    </td>
                  {/each}
                </tr>
              {:else}
                <tr><td colspan={columns.length}>No entries</td></tr>
              {/each}
            </tbody>
          </table>
        </div>

      {:else if sel?.kind === "document" && schema && activeDocType}
        {#if standaloneDocument}
          <div class="document-form">
            <SchemaPanel {schema} docType={activeDocType} values={draft} docId={sel.id} selected={null} creating={newDocument?.id === sel.id} pending={[]} documents={manifest.documents ?? []} focusToken={0} devMode={settings.devMode} onchange={(next) => { draft = next; touch(); }} onselect={() => {}} oneditdocument={(id) => { const doc = manifest.documents?.find(doc => doc.id === id); if (doc) select({ kind: "document", type: doc.type, id }); }} />
          </div>
        {:else}
        <VisualEditor
          docId={sel.id}
          {schema}
          docType={activeDocType}
          values={draft}
          documents={draftDocuments}
          previewPath={documentPreview("draft")}
          livePath={documentPreview("live")}
          creating={newDocument?.id === sel.id}
          devMode={settings.devMode}
          reloadToken={documentReload}
          oneditdocument={(id) => {
            const doc = manifest.documents?.find((entry) => entry.id === id);
            if (doc) select({ kind: "document", type: doc.type, id: doc.id });
          }}
          onchange={(next: Record<string, unknown>) => { draft = next; touch(); }}
        />
        {/if}

      {:else if sel?.kind === "menu" && menu && manifest.menus}
        <section class="menu-details">
          <label><span>Slug</span><input type="text" value={menu.slug} readonly /></label>
          <label><span>Name</span><input type="text" value={String(draft.title ?? "")} oninput={(e) => { draft.title = e.currentTarget.value; touch(); }} /></label>
        </section>
        <MenuEditor items={draft.items as MenuItem[]} maxDepth={manifest.menus.maxDepth} oninput={(items) => { draft.items = items; touch(); }} />

      {:else if sel?.kind === "page" && page}
        {#each page.groups as group (group.id)}
          <section>
            <h3>{group.label}</h3>
            {#each group.fields as field (field.key)}
              <Field
                {field}
                devMode={settings.devMode}
                value={(draft[group.id] as Record<string, unknown> | undefined)?.[field.key]}
                oninput={(v) => {
                  draft[group.id] = { ...((draft[group.id] as object) ?? {}), [field.key]: v };
                  touch();
                }}
              />
            {/each}
          </section>
        {/each}


      {:else if sel?.kind === "post" && coll && post}
        {#key `${coll.name}/${post.slug}`}
          <VisualEditor
            docId={`${coll.name}:${post.slug}`}
            values={draft}
            previewValues={collectionPreviewValues(coll.fields, draft, manifest.documents ?? [])}
            body={bodyDraft}
            bodyInline={settings.userPref.editorExperience === "inline"}
            onbody={(value) => { bodyDraft = value; touch(); }}
            previewPath={manifest.preview ? previewUrl(manifest.preview, sel, "draft", !!newEntry) : null}
            livePath={manifest.preview ? previewUrl(manifest.preview, sel, "live") : null}
            creating={!!newEntry}
            devMode={settings.devMode}
            onchange={(next) => { draft = next; touch(); }}
          >
            {#snippet properties(selected, focusToken, bodyInline, oneditbody)}
              <CollectionPanel fields={coll.fields} values={draft} documents={manifest.documents ?? []} body={bodyDraft as ArticleBody} {bodyInline} {oneditbody} {selected} {focusToken} devMode={settings.devMode} onchange={(key, value) => { draft[key] = value; touch(); }} onbody={(value) => { bodyDraft = value; touch(); }} />
            {/snippet}
          </VisualEditor>
        {/key}

      {:else}
        <div class="welcome">
          <img src={logo} alt="" width="64" height="64" />
          <h2>Welcome to RigelCMS</h2>
          <p>The best CMS in the whole space.</p>
          <p class="welcome-hint">Select a page or collection from the sidebar to start editing.</p>
        </div>
      {/if}
      {#if settings.devMode && (sel?.kind === "page" || sel?.kind === "post" || sel?.kind === "menu" || sel?.kind === "document")}
        <section class="md-preview" class:article-state={sel.kind === "post"}>
          <h3>Current draft</h3>
          <pre>{JSON.stringify(sel.kind === "post" ? { frontmatter: draft, body: bodyDraft } : draft, null, 2)}</pre>
        </section>
      {/if}
    </main>
    {#if manifest.preview && previewTarget}
      <div class="preview-divider" role="separator" tabindex="0" aria-label="Editor and preview width" aria-orientation="vertical" aria-controls="rigel-editor-pane" aria-valuemin={Math.round(splitMin * 100)} aria-valuemax={Math.round(splitMax * 100)} aria-valuenow={Math.round(previewSplit * 100)} aria-valuetext={`${Math.round(previewSplit * 100)}% editor width`} onpointerdown={startPreviewResize} onpointermove={movePreviewResize} onpointerup={endPreviewResize} onpointercancel={endPreviewResize} onlostpointercapture={endPreviewResize} onkeydown={keyPreviewResize}></div>
      <SitePreview target={previewTarget} config={manifest.preview} isNew={!!newEntry} values={draft} body={bodyDraft} devMode={settings.devMode} />
    {/if}
  </div>
</div>
{/if}

{#if settingsOpen}
  <Settings bind:s={settings} error={settingsError} saving={saveState === "saving"} onerase={eraseBrowserData} onclose={() => (settingsOpen = false)} />
{/if}
{#if shortcutsOpen}
  <Shortcuts onclose={() => (shortcutsOpen = false)} />
{/if}
{#if pendingNavigation}
  <UnsavedChanges busy={saveState === "saving"} error={saveError} onsave={saveAndLeave} ondiscard={discardAndLeave} oncancel={() => { pendingNavigation = null; }} />
{/if}
{#if actionDialog}
  <ActionDialog {...actionDialog} onclose={() => { actionDialog = null; }} />
{/if}
