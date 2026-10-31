<script lang="ts">
  import { t, locale } from "./i18n";
  import { onMount, tick } from "svelte";
  import { tooltipRoot } from "./lib/tooltip";
  onMount(() => tooltipRoot(document.body).destroy);
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
  import Select from "./lib/Select.svelte";
  import { contentForLocale, selectionInContent } from "../manifest/content-locales";
  import { validateDocumentSlugs } from "../slugs";
  import Shortcuts from "./lib/Shortcuts.svelte";
  import CollectionPanel from "./lib/CollectionPanel.svelte";
  import { emptyBody, type ArticleBody } from "../article-body";
  import SchemaPanel from "./lib/SchemaPanel.svelte";
  import { collectionPreviewValues, referenceLabel, referenceOptions } from "../manifest/references";
  import { isSeoField } from "../manifest/seo";
  import { initialCollectionValues } from "../manifest/collections";
  import { slugify } from "./lib/slugify";
  import { effectiveSlug, normalizeUrlSlug } from "../slugs";
  import Icon from "./lib/Icon.svelte";
  import SidebarIcon from "./lib/SidebarIcon.svelte";
  import logo from "./assets/rigelcms-icon.png?url";
  import { getSettings, setSettings } from "./lib/settings";
  import { eraseData, readSession, writeSession, clearSession } from "./lib/storage";
  import MenuEditor from "./lib/MenuEditor.svelte";
  import type { MenuItem } from "../manifest/menu";
  import UnsavedChanges from "./lib/UnsavedChanges.svelte";
  import ActionDialog from "./lib/ActionDialog.svelte";
  import PublishDialog from "./lib/PublishDialog.svelte";
  import VisualEditor from "./lib/VisualEditor.svelte";
  import { newDocumentFromTemplate } from "../schema/paths";
  import { previewUrl, previewPath } from "../preview";
  import type { ContentDocument, Schema } from "../schema/types";
  import { buildSidebar, navigationKey, type Selection } from "../manifest/navigation";
  import { startGitHubLogin, checkGitHubAccess, type GitHubAccess } from "./lib/github-auth";
  import { loadManifestRemote, saveRemoteSelection, deleteRemotePost, reviewRemotePublish, confirmRemotePublish, PublishReviewChangedError, type GitContext, type PublishReview } from "./lib/github-backend";

  type Sel = Selection;

  let manifest = $state<Manifest>({ pages: [] });
  let selectedContentLocale = $state<string | undefined>(undefined);
  let localeControlRevision = $state(0);
  const contentLocale = $derived(selectedContentLocale ?? manifest.contentLocales?.defaultLocale);
  const visibleContent = $derived(contentForLocale(manifest, contentLocale));
  let ready = $state(false);
  let blueprint: Manifest | null = null;
  let gitContext: GitContext | null = null;
  let authRevision = 0;
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
  let publishOpen = $state(false);
  let publishLoading = $state(false);
  let publishBusy = $state(false);
  let publishReview = $state<PublishReview | null>(null);
  let publishError = $state("");
  let publishMessage = $state("");
  let publishRevision = 0;

  function closePublish() {
    publishRevision += 1;
    publishOpen = false;
    publishReview = null;
    void tick().then(() => document.querySelector<HTMLButtonElement>("#publish-button")?.focus());
  }

  function publishGuard(context: GitContext, revision: number, auth: number) {
    if (!publishOpen || revision !== publishRevision || auth !== authRevision || gitContext !== context) throw new Error($t("shell.publishReviewInactive"));
    requireGitContext();
    if (dirty || saveTask || saveState === "saving") throw new Error($t("shell.saveBeforeReview"));
  }

  async function reviewPublish() {
    if (publishBusy || publishLoading) return;
    publishOpen = true;
    publishReview = null;
    publishError = "";
    publishMessage = "";
    publishLoading = true;
    const revision = ++publishRevision, auth = authRevision;
    try {
      const context = requireGitContext();
      const guard = () => publishGuard(context, revision, auth);
      guard();
      const review = await reviewRemotePublish(context, manifest, guard);
      guard();
      publishReview = review;
    } catch (error) {
      handleAuthError(error);
      if (revision === publishRevision) publishError = error instanceof Error ? error.message : $t("shell.reviewError");
    } finally { publishLoading = false; }
  }

  async function publish() {
    if (publishBusy || publishLoading || !publishReview) return;
    publishBusy = true;
    publishError = "";
    const review = publishReview, revision = publishRevision, auth = authRevision;
    try {
      const context = requireGitContext();
      const guard = () => publishGuard(context, revision, auth);
      guard();
      const result = await confirmRemotePublish(context, manifest, review, guard);
      guard();
      publishReview = null;
      if (result === "synced") {
        const remote = await loadManifestRemote(context, blueprint!, false);
        guard();
        manifest = remote;
        openSelection(sel);
        publishMessage = $t("shell.draftsSynced");
      } else publishMessage = $t("shell.publishedToBranch", { name: review.publishBranch });
    } catch (error) {
      handleAuthError(error);
      if (revision === publishRevision) {
        publishError = error instanceof Error ? error.message : $t("shell.publishVerificationError");
        if (error instanceof PublishReviewChangedError) publishReview = null;
      }
    } finally { publishBusy = false; }
  }
  let pendingNavigation = $state<(() => void) | null>(null);
  let pendingNavigationCancel: (() => void) | null = null;
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
      if (!response.ok) throw new Error($t("shell.configurationLoadError"));
      const data: Manifest = await response.json();
      if (!Array.isArray(data.pages) || (data.backend === "github" && !data.github)) throw new Error($t("shell.configurationIncomplete"));
      blueprint = data;
      manifest = data;
      ready = true;
      if (data.backend === "github" && data.github) {
        const session = readSession(data.github);
        if (session) {
          gitContext = { token: session.accessToken, repo: data.github.repo, branch: data.github.branch };
          sessionExpiresAt = session.expiresAt;
          await recheckGitHub();
        }
      }
    } catch (error) {
      loadError = error instanceof Error ? error.message : $t("shell.configurationLoadFailed");
    }
  }

  function requireGitContext() {
    if (connectionBusy) throw new Error($t("shell.waitForGithubVerification"));
    if (!gitContext || !connected || githubAccess?.status !== "ready") throw new Error($t("shell.connectBeforeSaving"));
    if (Date.now() >= sessionExpiresAt - 30_000) {
      invalidateSession();
      throw new Error($t("shell.sessionExpiredRetry"));
    }
    return gitContext;
  }

  async function verifyGitHub() {
    const config = blueprint?.github;
    const context = gitContext;
    if (!config || !context) return;
    try {
      if (Date.now() >= sessionExpiresAt - 30_000) {
        invalidateSession();
        throw new Error($t("shell.sessionExpiredCheckAccess"));
      }
      const access = await checkGitHubAccess(context.token, config.repo, config.appSlug);
      if (gitContext !== context) return;
      githubAccess = access;
      if (access.status !== "ready") return;
      if (!connected && blueprint) {
        const remote = await loadManifestRemote(context, blueprint);
        if (gitContext !== context) return;
        manifest = remote;
        connected = true;
      }
    } catch (error) {
      if (gitContext === context) handleAuthError(error);
      throw error;
    }
  }

  function invalidateSession() {
    closePublish();
    authRevision += 1;
    clearSession();
    gitContext = null;
    sessionExpiresAt = 0;
    githubAccess = null;
    tokenExpired = true;
  }

  function handleAuthError(error: unknown) {
    if (error instanceof Error && "status" in error && error.status === 401) invalidateSession();
  }

  async function connectGitHub() {
    if (connectionBusy || saveState === "saving" || publishBusy || !manifest.github) return;
    closePublish();
    connectionBusy = true;
    connectionError = "";
    const revision = ++authRevision;
    try {
      const session = await startGitHubLogin(manifest.github.authOrigin);
      if (revision !== authRevision) return;
      gitContext = { token: session.accessToken, repo: manifest.github.repo, branch: manifest.github.branch };
      githubAccess = null;
      sessionExpiresAt = session.expiresAt;
      writeSession(manifest.github, session);
      await verifyGitHub();
    } catch (error) {
      connectionError = error instanceof Error ? error.message : $t("shell.githubConnectionError");
    } finally {
      connectionBusy = false;
    }
  }

  async function recheckGitHub() {
    if (connectionBusy) return;
    connectionBusy = true;
    connectionError = "";
    try { await verifyGitHub(); }
    catch (error) { connectionError = error instanceof Error ? error.message : $t("shell.githubAccessError"); }
    finally { connectionBusy = false; }
  }

  function signOut() {
    if (saveState === "saving" || connectionBusy) return;
    userOpen = false;
    if (publishBusy) { invalidateSession(); connected = false; return; }
    closePublish();
    requestNavigation(() => {
      invalidateSession();
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
    tokenExpired = !expiry || Date.now() >= expiry - 30_000;
    if (!expiry) return;
    const timer = setTimeout(invalidateSession, Math.max(0, expiry - Date.now() - 30_000));
    return () => clearTimeout(timer);
  });

  function save(): Promise<boolean> {
    if (publishOpen || publishBusy) return Promise.resolve(false);
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
          if ((selection?.kind === "post" || (docSel && !activeDocType?.shared)) && Object.hasOwn(values, "slug")) {
            values.slug = normalizeUrlSlug(values.slug, $t);
            draft.slug = values.slug;
          }
          if (githubMode) {
            if (!selection) throw new Error($t("shell.selectBeforeSaving"));
            await saveRemoteSelection(requireGitContext(), manifest, selection, values, body, !!creating || creatingDoc);
          } else {
          const url = docSel
            ? `/rigel/api/local/documents/${encodeURIComponent(docSel.id)}`
            : m ? `/rigel/api/local/menus/${m.slug}` : po && c ? `/rigel/api/local/${c.name}/${encodeURIComponent(po.slug)}` : "/rigel/api/local/save";
          const payload = docSel ? { data: values } : m ? { slug: m.slug, title: values.title, items: values.items } : po ? { frontmatter: values, body } : { slug: p?.slug, values };
          const res = await fetch(url, { method: docSel ? (creatingDoc ? "POST" : "PUT") : m ? "PUT" : "POST", headers: { "Content-Type": "application/json", "Accept-Language": $locale, ...(po && creating ? { "If-None-Match": "*" } : {}) }, body: JSON.stringify(payload) });
          if (!res.ok) throw new Error((await res.text()) || $t("shell.saveFailedStatus", { status: res.status }));
          }
          if (docSel) {
            const list = manifest.documents ?? (manifest.documents = []);
            const existing = list.find((entry) => entry.id === docSel.id);
            if (existing) existing.data = values;
            else list.push({ id: docSel.id, type: docSel.type, slug: docSel.id.slice(docSel.type.length + 1), data: values });
            newDocument = null;
            docBase = JSON.parse(JSON.stringify(values));
          } else if (m) { m.title = values.title; m.items = values.items; }
          else if (po) { po.frontmatter = values; po.body = body; bodyBase = body; }
          else if (p) p.values = values;
          if (creating && po && c) c.posts.push(po);
          newEntry = null;
          dirty = JSON.stringify({ fm: draft, body: bodyDraft }) !== JSON.stringify({ fm: docSel ? docBase : values, body });
          saveState = dirty ? "idle" : "saved";
          saveError = "";
        } catch (error) {
          handleAuthError(error);
          saveState = "error";
          saveError = error instanceof Error ? error.message : $t("shell.saveChangesError");
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
  const userName = $derived(githubMode ? githubAccess?.user.name ?? githubAccess?.user.login ?? $t("shell.githubUser") : $t("shell.localUser"));
  const userAvatar = $derived(githubMode && /^https:\/\/avatars\.githubusercontent\.com\//.test(githubAccess?.user.avatar_url ?? "") ? githubAccess!.user.avatar_url : "");
  let failedAvatar = $state("");
  const userLogin = $derived(githubMode && githubAccess ? `@${githubAccess.user.login}` : $t("shell.localMode"));
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
      title: $t("shell.eraseBrowserDataTitle"), confirmLabel: $t("shell.eraseData"), danger: true,
      description: $t("shell.eraseBrowserDataDescription"),
      onconfirm: () => {
        if (saveState === "saving") throw new Error($t("shell.waitForSave"));
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
    return visibleContent.collections?.find((x) => x.name === name);
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
    if (sel?.kind === "menus") return [{ key: "title", label: $t("shell.name") }, { key: "slug", label: $t("shell.slug") }];
    if (sel?.kind === "pages") return [{ key: "label", label: $t("shell.title") }, { key: "slug", label: $t("shell.slug") }, { key: "path", label: $t("shell.path") }, { key: "category", label: $t("shell.category") }];
    const source = sel?.kind === "documents" ? activeDocType : coll;
    if (!source) return [];
    const keys = ["title", "slug", ...(source.columns ?? (sel?.kind === "documents" ? [] : source.fields.filter(field => !isSeoField(field.key)).map(field => field.key)))];
    const titleLabel = sel?.kind === "documents" && !source.fields.some(field => field.key === "title") ? source.fields.find(field => field.key === "name")?.label ?? $t("shell.title") : $t("shell.title");
    const seen = new Set<string>();
    const out: { key: string; label: string; image?: boolean }[] = [];

    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const f = source.fields.find((x) => x.key === k);
      out.push({ key: k, label: k === "slug" ? $t("shell.slug") : k === "title" ? titleLabel : f?.labelKey ? $t(f.labelKey) : f?.label ?? k, image: f?.type === "image" });
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

  const sidebar = $derived(buildSidebar(visibleContent, $t));
  const pageCategory = $derived(sel?.kind === "pages" ? sel.category : undefined);
  const schema = $derived<Schema | undefined>(manifest.schema);
  const docTypes = $derived(visibleContent.schema?.documents ?? []);

  const pageDocType = $derived(docTypes.find((type) => !type.shared && !type.singleton));
  const pageDocuments = $derived((visibleContent.documents ?? []).filter((doc) => docTypes.some(type => type.name === doc.type && !type.shared)));
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
  function documentPreview(mode: "draft" | "website") {
    if (sel?.kind !== "document" || (mode === "draft" && newDocument?.id === sel.id)) return null;
    const storedSlug = activeDocument ? effectiveSlug(activeDocument.data, activeDocument.slug) : sel.id.slice(sel.type.length + 1);
    return previewUrl(manifest.preview ?? {}, { kind: "document", type: sel.type, slug: storedSlug, urlSlug: Object.hasOwn(draft, "slug") ? String(draft.slug) : undefined }, mode);
  }
  const standaloneDocument = $derived(sel?.kind === "document" && activeDocType?.shared === true);
  const visualSelection = $derived(sel?.kind === "post" || (sel?.kind === "document" && !standaloneDocument));

  const sortedPages = $derived.by(() => {
    const rows = [
      ...visibleContent.pages.filter((p) => !p.shared && (pageCategory === undefined || p.category === pageCategory))
        .map((p) => ({ slug: p.slug, path: previewPath(manifest.preview ?? {}, { kind: "page", slug: p.slug }), title: p.label, category: p.category, draft: false, target: { kind: "page", slug: p.slug } as Sel })),
      ...pageDocuments
        .map((doc) => ({ slug: effectiveSlug(doc.data, doc.slug), path: previewPath(manifest.preview ?? {}, { kind: "document", type: doc.type, slug: effectiveSlug(doc.data, doc.slug) }), title: String(doc.data.title ?? doc.slug), category: docTypes.find(type => type.name === doc.type)?.category, draft: doc.data.draft === true, target: { kind: "document", type: doc.type, id: doc.id } as Sel }))
        .filter(doc => pageCategory === undefined || doc.category === pageCategory),
    ];
    const key = sortBy === "slug" || sortBy === "category" || sortBy === "path" ? sortBy : "title";
    return rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * sortDir);
  });
  function documentCell(doc: ContentDocument, key: string): string {
    return String(key === "title" ? doc.data.title ?? doc.data.name ?? doc.slug : key === "slug" ? activeDocType?.shared ? doc.slug : effectiveSlug(doc.data, doc.slug) : doc.data[key] ?? "");
  }
  const typeDocuments = $derived((visibleContent.documents ?? []).filter((doc) => doc.type === docTypeName(sel)).sort((a, b) => documentCell(a, sortBy).localeCompare(documentCell(b, sortBy)) * sortDir));


  const menu = $derived.by(() => { const slug = sel?.kind === "menu" ? sel.slug : null; return manifest.menus?.entries.find((m) => m.slug === slug); });
  const sortedMenus = $derived([...(manifest.menus?.entries ?? [])].sort((a, b) => (sortBy === "slug" ? a.slug.localeCompare(b.slug) : a.title.localeCompare(b.title)) * sortDir));
  const listTitle = $derived(sel?.kind === "menus" ? $t("shell.allMenus") : sel?.kind === "documents" ? activeDocType?.title ?? $t("shell.documents") : sel?.kind === "pages" ? pageCategory !== undefined ? $t("shell.allNamedEntries", { name: pageCategory }) : $t("shell.allPages") : coll?.listTitle?.trim() || (coll?.label !== undefined ? $t("shell.allNamedEntries", { name: coll.label }) : $t("shell.allEntries")));
  const listRows = $derived(sel?.kind === "menus"
    ? sortedMenus.map((m) => ({ slug: m.slug, cells: { slug: m.slug, title: m.title } as Record<string, string>, draft: false, target: { kind: "menu", slug: m.slug } as Sel }))
    : sel?.kind === "documents"
    ? typeDocuments.map((doc) => ({ slug: doc.slug, cells: Object.fromEntries(columns.map(column => [column.key, documentCell(doc, column.key)])), draft: doc.data.draft === true, target: { kind: "document", type: doc.type, id: doc.id } as Sel }))
    : sel?.kind === "pages"
    ? sortedPages.map((p) => ({ slug: p.slug, cells: { label: p.title, slug: p.slug, path: p.path ?? "—", category: p.category ?? "—" } as Record<string, string>, draft: p.draft, target: p.target }))
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
      settingsError = $t("shell.settingsStorageError");
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
      const entry = sel.kind === "page" ? page : sel.kind === "document" ? docTypes.find(type => type.name === sel.type) : undefined;
      if (!entry || entry.shared) return false;
      const category = sidebar.some(node => node.kind === "link" && node.target.kind === "pages" && node.target.category === entry.category) ? entry.category : undefined;
      return target.category === category;
    }
    return false;
  }

  function requestNavigation(action: () => void, oncancel: (() => void) | null = null) {
    if (publishOpen || publishBusy) return;
    pendingNavigationCancel = oncancel;
    if (dirty || saveState === "saving") pendingNavigation = action;
    else action();
  }

  function cancelNavigation() {
    pendingNavigation = null;
    pendingNavigationCancel?.();
    pendingNavigationCancel = null;
  }

  async function saveAndLeave() {
    if (!(await save())) return;
    const action = pendingNavigation;
    pendingNavigation = null;
    pendingNavigationCancel = null;
    action?.();
  }

  function discardAndLeave() {
    const action = pendingNavigation;
    pendingNavigation = null;
    pendingNavigationCancel = null;
    const fallback: Sel | null = newEntry ? { kind: "collection", name: newEntry.collection } : newDocument ? { kind: "pages" } : sel;
    newEntry = null;
    newDocument = null;
    openSelection(fallback);
    action?.();
  }

  function select(next: Sel | null) {
    if (manifest.contentLocales && !selectionInContent(visibleContent, next)) return;
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
      draft = JSON.parse(JSON.stringify(fm));
      bodyDraft = po.body;
      bodyBase = po.body;
    }
    dirty = newEntry !== null || (newDocument !== null && next?.kind === "document");
    saveState = "idle";

  }

  function focusContentLocale() {
    void tick().then(() => document.querySelector<HTMLButtonElement>(".content-language button[role=combobox]")?.focus({ preventScroll: true }));
  }

  function switchContentLocale(value: string | string[]) {
    localeControlRevision += 1;
    if (typeof value !== "string" || value === contentLocale || !manifest.contentLocales?.locales.some(locale => locale.code === value)) return;
    requestNavigation(() => {
      const destination = contentForLocale(manifest, value);
      selectedContentLocale = value;
      if (!selectionInContent(destination, sel)) openSelection(null);
      focusContentLocale();
    }, focusContentLocale);
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
        ? post.frontmatter
        : page?.values;
    dirty =
      newEntry !== null ||
      JSON.stringify({ fm: draft, body: bodyDraft }) !==
      JSON.stringify({ fm: ref, body: bodyBase });
    if (saveState !== "saving") saveState = "idle";
  }

  function cellValue(p: { slug: string; frontmatter: Record<string, unknown> }, key: string): string {
    const v = key === "slug" ? effectiveSlug(p.frontmatter, p.slug) : p.frontmatter[key];
    const field = coll?.fields.find(field => field.key === key);
    if (field?.type === "reference") return referenceLabel(v, referenceOptions(field, manifest.documents), $t) || "—";
    if (v === true) return "✓";
    if (v === false || v == null) return "—";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  }

  function newPage(type = pageDocType) {
    if (!type || !schema || type.creatable === false || type.singleton) return;
    actionDialog = {
      title: $t("shell.addDocument", { name: type.title }), description: $t("shell.newDocumentDescription"), fieldLabel: type.shared ? $t("shell.name") : $t("shell.pageName"), confirmLabel: $t("shell.createDraft"),
      onconfirm: (title) => {
        const slug = slugify(title);
        if (!slug) throw new Error($t("shell.titleRequired"));
        if (manifest.documents?.some(doc => doc.type === type.name && doc.slug === slug)) throw new Error($t("shell.slugAlreadyUsed", { slug }));
        const id = `${type.name}:${slug}`;
        const data = newDocumentFromTemplate(schema, type.name, title, slug);
        validateDocumentSlugs(schema, [...(manifest.documents ?? []), { id, type: type.name, slug, data }], manifest.preview, $t);
        newDocument = { type: type.name, id, slug };
        draft = JSON.parse(JSON.stringify(data));
        docBase = null;
        openSelection({ kind: "document", type: type.name, id });
      },
    };
  }

  function newPost(c: ManifestCollection) {
    actionDialog = {
      title: $t("shell.addToCollection", { name: c.label }), description: $t("shell.newPostDescription"), fieldLabel: $t("shell.title"), confirmLabel: $t("shell.createDraft"),
      onconfirm: (title) => {
        const slug = slugify(title, c.posts.flatMap((post) => [post.slug, effectiveSlug(post.frontmatter, post.slug)]));
        if (!slug) throw new Error($t("shell.titleRequired"));
        newEntry = { collection: c.name, post: { slug, frontmatter: { ...initialCollectionValues(c.fields, title), slug }, body: emptyBody() } };
        openSelection({ kind: "post", collection: c.name, slug });
      },
    };
  }

  function deletePost() {
    if (publishOpen || publishBusy) return;
    const current = post, collection = coll, unsaved = newEntry !== null;
    if (!current || !collection) return;
    actionDialog = {
      title: $t("shell.deletePostTitle", { name: String(current.frontmatter.title ?? current.slug) }), confirmLabel: $t("shell.delete"), danger: true,
      description: unsaved ? $t("shell.discardNewPostDescription") : githubMode ? $t("shell.deleteRemotePostDescription", { slug: current.slug, branch: String(manifest.github?.branch) }) : $t("shell.deleteLocalPostDescription", { slug: current.slug }),
      onconfirm: async () => {
        if (!unsaved) {
          if (githubMode) {
            try { await deleteRemotePost(requireGitContext(), manifest, collection.name, current.slug); }
            catch (error) { handleAuthError(error); throw error; }
          }
          else {
          const res = await fetch(`/rigel/api/local/${collection.name}/${encodeURIComponent(current.slug)}`, { method: "DELETE", headers: { "Accept-Language": $locale } });
          if (!res.ok) throw new Error((await res.text()) || $t("shell.deleteFailedStatus", { status: res.status }));
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
  onstorage={(event) => {
    if ((event.key === "rigelcms.session" || event.key === null) && blueprint?.github && !readSession(blueprint.github)) {
      invalidateSession();
      connectionError = $t("shell.signedOutAnotherTab");
    }
  }}
  onresize={endPreviewResize}
  onblur={endPreviewResize}
  oncontextmenu={(event) => { if (!settings.devMode) event.preventDefault(); }}
  onbeforeunload={(event) => { if (dirty || saveState === "saving" || publishBusy) { event.preventDefault(); event.returnValue = ""; } }}
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
    <div class="connection-brand"><img src={logo} alt="" width="64" height="64" /><span>Rigel <span class="brand-suffix">CMS</span></span></div>
    <h1>{!ready ? $t("shell.loadingEditor") : $t("shell.connectGithub")}</h1>
    {#if !ready}
      {#if loadError}<p class="connection-error" role="alert">{loadError}</p><button class="primary" onclick={loadBlueprint}>{$t("shell.retryLoading")}</button>
      {:else}<p role="status">{$t("shell.loadingConfiguration")}</p>{/if}
    {:else if manifest.github}
      {#if githubAccess}
        <p>{#each $t("shell.signedInAs", { name: "{name}" }).split(/(\{name\})/) as part}{#if part === "{name}"}<strong>{githubAccess.user.login}</strong>{:else}{part}{/if}{/each}</p>
        {#if githubAccess.status === "read-only" || githubAccess.status === "installation-required"}
          <p>{$t("shell.noEditingAccess")}</p>
        {:else}
          <p role="status">{connectionBusy ? $t("shell.openingEditor") : $t("shell.accessConfirmed")}</p>
        {/if}
        {#if githubAccess.status !== "ready"}
          <a id="github-install" class="primary" href={githubAccess.installUrl} target="_blank" rel="noopener noreferrer">{$t("shell.manageGithubAccess")}</a>
        {/if}
      {:else}
        <p>{$t("shell.signInHint")}</p>
      {/if}
      <div class="connection-actions">
        {#if sessionExpiresAt && !tokenExpired}
          <button id="github-check-access" class="primary" disabled={connectionBusy} onclick={recheckGitHub}>{connectionBusy ? $t("shell.checkingAccess") : githubAccess?.status === "ready" ? $t("shell.openEditor") : $t("shell.checkAccess")}</button>
        {/if}
        <button id="github-sign-in" class:primary={!sessionExpiresAt || tokenExpired} class:outlined={sessionExpiresAt > 0 && !tokenExpired} disabled={connectionBusy} onclick={connectGitHub}>{connectionBusy && !sessionExpiresAt ? $t("shell.signingIn") : sessionExpiresAt ? $t("shell.signInAgain") : $t("shell.signInWithGithub")}</button>
      </div>
      <p class="connection-note">{#each $t("shell.legalNotice", { terms: "{terms}", privacy: "{privacy}" }).split(/(\{terms\}|\{privacy\})/) as part}{#if part === "{terms}"}<a href="https://rigelcms.dev/terms" target="_blank" rel="noopener noreferrer">{$t("shell.termsOfUse")}</a>{:else if part === "{privacy}"}<a href="https://rigelcms.dev/privacy" target="_blank" rel="noopener noreferrer">{$t("shell.privacyPolicy")}</a>{:else}{part}{/if}{/each}</p>
    {/if}
    {#if connectionError}<p class="connection-error" role="alert">{connectionError}</p>{/if}
  </main>
</div>
{:else}
<div class="rigel" class:sidebar-collapsed={settings.userPref.sidebarCollapsed}>
  <aside id="rigel-sidebar" data-tooltip-position="right">
    <a class="brand" href="/rigel/" role="button" aria-label={$t("shell.welcome")} onclick={(event) => { event.preventDefault(); goWelcome(); }}>
      <img src={logo} alt="" width="32" height="32" />
      <span>Rigel <span class="brand-suffix">CMS</span></span>
    </a>
    <TopBar manifest={visibleContent} {sel} onselect={select} />
    {#if manifest.contentLocales && manifest.contentLocales.locales.length > 1}
      <div class="content-language" data-locale={contentLocale}>
        {#key localeControlRevision}
          <Select label={$t("shell.contentLanguage")} value={contentLocale} options={manifest.contentLocales.locales.map(locale => ({ value: locale.code, label: locale.label }))} disabled={publishOpen || publishBusy} onchange={switchContentLocale} />
        {/key}
      </div>
    {/if}

    <nav id="rigel-sidebar-navigation" class="rail-scroll" aria-label={$t("shell.content")}>
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
            data-tooltip={node.label}
            class:active={navActive(node.target)}
            aria-current={navActive(node.target) ? "page" : undefined}
            onclick={() => select(node.target)}
          >
            <SidebarIcon name={node.icon ?? ({ pages: "files", page: "file-text", collection: "newspaper", documents: "squares-four", document: "file-text", menus: "list", media: "images" }[node.target.kind])} /><span class="sidebar-label">{node.label}</span>
          </button>
        {/if}
      {/each}
    </nav>

    {#if githubMode && manifest.github?.publishBranch}
      <button id="publish-button" class="sidebar-publish" aria-label={$t("shell.publish")} data-tooltip={dirty ? $t("shell.saveBeforePublishing") : $t("shell.publishSavedChanges")} disabled={publishBusy || publishLoading || saveState === "saving" || connectionBusy || tokenExpired || githubAccess?.status !== "ready"} onclick={reviewPublish}>
        <Icon name="rocketLaunch" size={18} /><span class="sidebar-label">{$t("shell.publish")}</span>
      </button>
    {/if}
    <button class="sidebar-toggle" aria-expanded={!settings.userPref.sidebarCollapsed} aria-controls="rigel-sidebar-navigation" aria-label={settings.userPref.sidebarCollapsed ? $t("shell.expandSidebar") : $t("shell.collapseSidebar")} data-tooltip={settings.userPref.sidebarCollapsed ? $t("shell.expandSidebar") : $t("shell.collapseSidebar")} onclick={() => { settings.userPref.sidebarCollapsed = !settings.userPref.sidebarCollapsed; }}>
      <SidebarIcon name="sidebar-simple" /><span class="sidebar-label">{$t("shell.collapseSidebar")}</span>
    </button>
    <div class="aside-foot">
      <div class="user-menu-wrap">
        <button class="user-btn" aria-label={githubMode ? $t("shell.githubUserMenu") : $t("shell.localUserMenu")} data-tooltip={githubMode ? $t("shell.githubUserMenu") : $t("shell.localUserMenu")} aria-haspopup="menu" aria-expanded={userOpen} onclick={() => (userOpen = !userOpen)}>
          {@render avatar()}
          <span class="user-details"><span class="uname">{userName}</span><small>{userLogin}</small></span>
          <span class="user-menu-icon"><Icon name="dotsThreeOutlineVertical" size={18} /></span>
        </button>
        {#if userOpen}
          <div class="user-menu" role="menu">
            <div class="user-menu-head">
              {@render avatar()}
              <div class="user-details"><strong>{userName}</strong><small>{userLogin}</small></div>
            </div>
            <div class="divider"></div>
            <a role="menuitem" href="/" target="_blank" rel="noopener">
              <Icon name="external" size={13} />
              {$t("shell.liveSite")}
            </a>
            <div class="divider"></div>
            <button role="menuitem" onclick={() => { userOpen = false; settingsOpen = true; }}>
              <Icon name="gear" size={13} />
              {$t("shell.settings")}
            </button>
            <button role="menuitem" onclick={() => { userOpen = false; shortcutsOpen = true; }}>
              <Icon name="keyboard" size={13} />
              {$t("shell.keyboardShortcutsMenu")}
            </button>
            <div class="divider"></div>
            {#if githubMode}
            <a role="menuitem" href={githubAccess?.installUrl} target="_blank" rel="noopener noreferrer">{$t("shell.configureGithubAccess")}</a>
            <button role="menuitem" class="github-reconnect" disabled={connectionBusy || saveState === "saving"} onclick={() => { userOpen = false; void connectGitHub(); }}>{$t("shell.reconnectGithub")}</button>
            {/if}
            <button id={githubMode ? "github-sign-out" : undefined} role="menuitem" class:muted={!githubMode} disabled={!githubMode || saveState === "saving" || connectionBusy} data-tooltip={githubMode ? $t("shell.signOutTooltip") : $t("shell.localMode")} onclick={signOut}>
              <Icon name="signOut" size={13} />
              {$t("shell.signOut")}
              {#if !githubMode}<span class="soon">{$t("shell.githubBackendHint")}</span>{/if}
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
          <p>{connectionError || (tokenExpired ? $t("shell.sessionExpired") : $t("shell.repositoryAccessChanged"))}</p>
          <button class="primary" disabled={connectionBusy || saveState === "saving"} onclick={connectGitHub}>{connectionBusy ? $t("shell.connecting") : $t("shell.reconnectGithub")}</button>
        </div>
      {/if}
      {#if settingsError}<p role="alert">{settingsError}</p>{/if}
      {#if ready && sel && sel.kind !== "media"}
        {#if sel.kind === "page" || sel.kind === "post" || sel.kind === "menu" || sel.kind === "document"}
        <div class="editor-actions">
        {#if sel.kind === "page" && page}
          <p class="back"><button onclick={() => select(page.shared ? null : { kind: "pages", category: page.category })}>{$t("shell.backTo", { name: page.shared ? $t("shell.welcome") : page.category ?? $t("shell.pages") })}</button></p>
        {:else if sel.kind === "document"}
          {@const backSel: Sel | null = activeDocType?.singleton ? null : sel.type === pageDocType?.name ? { kind: "pages" } : { kind: "documents", type: sel.type }}
          <p class="back"><button onclick={() => select(backSel)}>{$t("shell.backTo", { name: activeDocType?.singleton ? $t("shell.welcome") : sel.type === pageDocType?.name ? $t("shell.pages") : activeDocType?.title ?? $t("shell.documents") })}</button></p>
        {:else if sel.kind === "post" && coll}
          <p class="back"><button onclick={() => select({ kind: "collection", name: coll.name })}>{$t("shell.backTo", { name: coll.label })}</button></p>
        {:else if sel.kind === "menu"}
          <p class="back"><button onclick={() => select({ kind: "menus" })}>{$t("shell.backTo", { name: $t("shell.menus") })}</button></p>
        {/if}
          <div class="save-actions">
            <span class="save-status" role="status" class:dirty={dirty && saveState !== "saving"} class:saving={saveState === "saving"} class:saved={!dirty && saveState === "saved"} class:error={saveState === "error"}>
              {saveState === "saving" ? $t("shell.saving") : saveState === "error" ? $t("shell.saveFailed") : dirty ? $t("shell.unsaved") : saveState === "saved" ? $t("shell.saved") : ""}
            </span>
            <button class="primary save-button" disabled={!dirty || saveState === "saving"} onclick={() => save()}>{saveState === "saving" ? $t("shell.saving") : $t("shell.save")}</button>
          </div>
        </div>
        {/if}
        <div class="titlebar">
          <h2>{sel.kind === "page" ? page?.label : sel.kind === "menu" ? String(draft.title || menu?.slug || "") : sel.kind === "post" ? String(draft.title || post?.slug || "") : sel.kind === "document" ? activeDocType?.singleton ? activeDocType.title : String(draft.title || draft.name || activeDocument?.slug || sel.id) : listTitle}</h2>
        {#if (sel?.kind === "collection" && coll) || (sel?.kind === "pages" && pageDocType?.creatable !== false && pageDocType) || (sel?.kind === "documents" && activeDocType && activeDocType.creatable !== false && !activeDocType.singleton)}
          <button class="primary" onclick={() => (sel?.kind === "collection" ? newPost(coll!) : newPage(sel?.kind === "documents" ? activeDocType : pageDocType))}>{$t("shell.addNew")}</button>
        {/if}
        {#if sel?.kind === "post" && post}
          <button class="icon-btn" aria-label={$t("shell.deletePost")} data-tooltip={$t("shell.deletePost")} disabled={saveState === "saving"} onclick={deletePost}>
            <Icon name="trash" size={15} />
          </button>
        {/if}
        </div>
      {/if}
      {#if saveError}
        <div class="save-toast" role="alert">
          <div class="save-toast-content">
            <strong>{$t("shell.saveChangesError")}</strong>
            <p>{saveError}</p>
            <button class="outlined" disabled={saveState === "saving"} onclick={() => save()}>{$t("shell.retrySave")}</button>
            {#if githubMode}<button class="outlined github-reconnect" disabled={connectionBusy || saveState === "saving"} onclick={connectGitHub}>{$t("shell.reconnectGithub")}</button>{/if}
          </div>
          <button type="button" class="icon-btn" aria-label={$t("shell.dismissSaveError")} onclick={() => { saveError = ""; }}><Icon name="x" size={18} /></button>
        </div>
      {/if}
      {#if !ready}
        <p>{$t("shell.loading")}</p>

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
                        {#if row.draft}<span class="badge">{$t("shell.draftBadge")}</span>{/if}
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
                <tr><td colspan={columns.length}>{$t("shell.noEntries")}</td></tr>
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
          websitePath={documentPreview("website")}
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
          <label><span>{$t("shell.slug")}</span><input type="text" value={menu.slug} readonly /></label>
          <label><span>{$t("shell.name")}</span><input type="text" value={String(draft.title ?? "")} oninput={(e) => { draft.title = e.currentTarget.value; touch(); }} /></label>
        </section>
        <MenuEditor items={draft.items as MenuItem[]} maxDepth={manifest.menus.maxDepth} oninput={(items) => { draft.items = items; touch(); }} />

      {:else if sel?.kind === "page" && page}
        {#if !page.shared}
          <section><label><span>{$t("shell.websiteRoute")}</span><input type="text" value={previewPath(manifest.preview ?? {}, { kind: "page", slug: page.slug }) ?? $t("shell.notConfigured")} readonly /></label><p class="hint">{$t("shell.fixedRouteHint")}</p></section>
        {/if}
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
            previewValues={collectionPreviewValues(coll.fields, draft, manifest.documents ?? [], $t)}
            body={bodyDraft}
            bodyInline={settings.userPref.editorExperience === "inline"}
            onbody={(value) => { bodyDraft = value; touch(); }}
            previewPath={manifest.preview ? previewUrl(manifest.preview, sel, "draft", !!newEntry) : null}
            websitePath={manifest.preview ? previewUrl(manifest.preview, { ...sel, urlSlug: Object.hasOwn(draft, "slug") ? String(draft.slug) : undefined }, "website") : null}
            creating={!!newEntry}
            devMode={settings.devMode}
            onchange={(next) => { draft = next; touch(); }}
          >
            {#snippet properties(selected, focusToken, bodyInline, oneditbody, bodyLoading)}
              <CollectionPanel fields={coll.fields} values={draft} storageSlug={post.slug} documents={manifest.documents ?? []} body={bodyDraft as ArticleBody} {bodyInline} {bodyLoading} {oneditbody} {selected} {focusToken} devMode={settings.devMode} onchange={(key, value) => { draft[key] = value; touch(); }} onbody={(value) => { bodyDraft = value; touch(); }} />
            {/snippet}
          </VisualEditor>
        {/key}

      {:else}
        <div class="welcome">
          <img src={logo} alt="" width="64" height="64" />
          <h2>{$t("shell.welcomeTitle")}</h2>
          <p>{$t("shell.welcomeTagline")}</p>
          <p class="welcome-hint">{$t("shell.welcomeHint")}</p>
        </div>
      {/if}
      {#if settings.devMode && (sel?.kind === "page" || sel?.kind === "post" || sel?.kind === "menu" || sel?.kind === "document")}
        <section class="md-preview" class:article-state={sel.kind === "post"}>
          <h3>{$t("shell.currentDraft")}</h3>
          <pre>{JSON.stringify(sel.kind === "post" ? { frontmatter: draft, body: bodyDraft } : draft, null, 2)}</pre>
        </section>
      {/if}
    </main>
    {#if manifest.preview && previewTarget}
      <div class="preview-divider" role="separator" tabindex="0" aria-label={$t("shell.editorPreviewWidth")} aria-orientation="vertical" aria-controls="rigel-editor-pane" aria-valuemin={Math.round(splitMin * 100)} aria-valuemax={Math.round(splitMax * 100)} aria-valuenow={Math.round(previewSplit * 100)} aria-valuetext={$t("shell.editorWidthPercent", { percent: Math.round(previewSplit * 100) })} onpointerdown={startPreviewResize} onpointermove={movePreviewResize} onpointerup={endPreviewResize} onpointercancel={endPreviewResize} onlostpointercapture={endPreviewResize} onkeydown={keyPreviewResize}></div>
      <SitePreview target={previewTarget} config={manifest.preview} isNew={!!newEntry} values={draft} body={bodyDraft} devMode={settings.devMode} />
    {/if}
  </div>
</div>
{/if}

{#if settingsOpen}
  <Settings bind:s={settings} github={githubMode ? manifest.github : undefined} user={githubAccess?.user} error={settingsError} saving={saveState === "saving"} onerase={eraseBrowserData} onclose={() => (settingsOpen = false)} />
{/if}
{#if shortcutsOpen}
  <Shortcuts onclose={() => (shortcutsOpen = false)} />
{/if}
{#if pendingNavigation}
  <UnsavedChanges busy={saveState === "saving"} error={saveError} onsave={saveAndLeave} ondiscard={discardAndLeave} oncancel={cancelNavigation} />
{/if}
{#if actionDialog}
  <ActionDialog {...actionDialog} onclose={() => { actionDialog = null; }} />
{/if}
{#if publishOpen}
  <PublishDialog review={publishReview} loading={publishLoading} busy={publishBusy} error={publishError} message={publishMessage} onrefresh={reviewPublish} onconfirm={publish} onclose={closePublish} />
{/if}
