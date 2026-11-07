<script lang="ts">
  import { t, availableLocales, localeNames } from "../i18n";
  import { getKeys, setKeys, STOCK_PROVIDERS } from "./images";
  import type { RigelSettings } from "./settings";
  import type { Manifest } from "../../manifest/types";
  import type { GitHubAccess } from "./github-auth";
  import Icon from "./Icon.svelte";
  import Select from "./Select.svelte";
  import { effectiveSearchScope } from "../../manifest/search";
  import { installedVersion } from "./updates";
  import logo from "../assets/rigelcms-icon.png?url";
  import { author, license } from "../../../package.json";

  let { s = $bindable(), search, contentLocales, github, user, error, saving, onerase, onclose, onreindex, oncancelindex, onclearcache, canClearFileCache = false, fileCacheBusy = false, fileCacheMessage = "", reindexBusy = false, reindexMessage = "", collections = [], maintenanceDisabled = false }: {
    s: RigelSettings;
    search?: Manifest["search"];
    contentLocales?: Manifest["contentLocales"];
    github?: Manifest["github"];
    user?: GitHubAccess["user"];
    error: string;
    saving: boolean;
    onerase: () => void;
    onclose: () => void;
    onreindex?: () => void;
    oncancelindex?: () => void;
    onclearcache?: () => void;
    canClearFileCache?: boolean;
    fileCacheBusy?: boolean;
    fileCacheMessage?: string;
    reindexBusy?: boolean;
    reindexMessage?: string;
    collections?: NonNullable<Manifest["collections"]>;
    maintenanceDisabled?: boolean;
  } = $props();

  type PaneId = "interface" | "content" | "connection" | "media" | "advanced" | "about";
  let active: PaneId = $state("interface");

  const providerIds = Object.keys(STOCK_PROVIDERS) as (keyof typeof STOCK_PROVIDERS)[];
  let keys = $state(getKeys());
  let revealed = $state<Partial<Record<keyof typeof STOCK_PROVIDERS, boolean>>>({});
  let keysError = $state("");
  let eraseError = $state("");

  const panes: { id: PaneId; label: string }[] = $derived([
    { id: "interface", label: $t("shell.interface") },
    { id: "content", label: $t("shell.content") },
    { id: "connection", label: $t("shell.connection") },
    { id: "media", label: $t("shell.media") },

    { id: "advanced", label: $t("shell.advanced") },
    { id: "about", label: $t("shell.about") },
  ]);

  const PANE_ICONS = {
    interface: "palette",
    content: "fileText",
    connection: "user",
    media: "image",

    advanced: "wrench",
    about: "info",
  } as const;

  $effect(() => {
    try {
      setKeys(Object.fromEntries(providerIds.map((id) => [id, keys[id]?.trim() || undefined])));
      keysError = "";
    } catch {
      keysError = $t("shell.apiKeysStorageError");
    }
  });
</script>

<div
  class="rigel-modal-backdrop rigel"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => e.key === "Escape" && onclose()}
>
  <div class="rigel-modal settings-modal" role="dialog" aria-label={$t("shell.settings")} onclick={(e) => e.stopPropagation()}>
    <div class="settings-head">
      <h2>{$t("shell.settings")}</h2>
      <button class="close" onclick={onclose} aria-label={$t("shell.close")}>
        <Icon name="x" size={14} weight="bold" />
      </button>
    </div>
    <div class="settings-body">
      <nav class="settings-nav">
        {#each panes as p (p.id)}
          <button
            class:active={active === p.id}
            aria-current={active === p.id ? "true" : undefined}
            onclick={() => (active = p.id)}
          >
            <span class="pico"><Icon name={PANE_ICONS[p.id]} size={24} /></span>
            {p.label}
          </button>
        {/each}
      </nav>

      <div class="settings-pane" class:about={active === "about"} role="region" aria-label={panes.find(p => p.id === active)?.label}>
        {#if active === "interface"}

          <fieldset>
            <legend>{$t("shell.theme")}</legend>
            <div class="theme-options">
              {#each ["system", "light", "dark"] as const as theme}
                <label class="theme-option">
                  <input type="radio" bind:group={s.theme} value={theme} />
                  <span>{$t({ system: "shell.themeSystem", light: "shell.themeLight", dark: "shell.themeDark" }[theme])}</span>
                </label>
              {/each}
            </div>
          </fieldset>
          <fieldset class="accessibility-options">
            <legend>{$t("shell.accessibility")}</legend>
            <label class="inline">
              <input type="checkbox" role="switch" class="switch" bind:checked={s.highContrast} aria-describedby="high-contrast-hint" />
              <span>{$t("shell.highContrastMode")}</span>
            </label>
            <p class="hint" id="high-contrast-hint">{$t("shell.highContrastHint")}</p>
          </fieldset>
          <fieldset>
            <legend>{$t("shell.editorInterfaceLanguage")}</legend>
            {#each availableLocales as lang}
              <label class="radio">
                <input type="radio" bind:group={s.language} value={lang} />
                <span>{localeNames[lang]}</span>
              </label>
            {/each}
          </fieldset>

        {:else if active === "content"}

          <Select label={$t("shell.articleBodyEditing")} value={s.userPref.editorExperience ?? "inline"} options={[
            { value: "sidebar", label: $t("shell.sidebar") },
            { value: "inline", label: $t("shell.inlinePreview") },
          ]} onchange={value => s.userPref.editorExperience = value === "sidebar" ? "sidebar" : "inline"} />
          <p class="hint">{$t("shell.editorExperienceHint")}</p>
          <Select label={$t("shell.searchScope")} value={s.userPref.searchScope ?? "inherit"} options={[
            { value: "inherit", label: $t("shell.searchScopeDefault", { scope: $t(effectiveSearchScope(search, undefined) === "all" ? "shell.searchScopeAll" : "shell.searchScopeCurrent") }) },
            { value: "all", label: $t("shell.searchScopeAll") },
            { value: "currentLocale", label: $t("shell.searchScopeCurrent"), disabled: !contentLocales || contentLocales.locales.length < 2 },
          ]} onchange={value => s.userPref.searchScope = value === "all" || value === "currentLocale" ? value : undefined} />
        {:else if active === "connection"}

          {#if github}
            <dl class="connection-details">
              <dt>{$t("shell.githubAccount")}</dt>
              <dd>{#if user}{user.name ?? user.login}<small>@{user.login}</small>{:else}{$t("shell.noGithubAccount")}{/if}</dd>
              <dt>{$t("shell.repository")}</dt>
              <dd>{github.repo}</dd>
              <dt>{$t("shell.editingBranch")}</dt>
              <dd>{github.branch}</dd>
              {#if github.publishBranch}
                <dt>{$t("shell.publishingBranch")}</dt>
                <dd>{github.publishBranch}</dd>
              {/if}
            </dl>
          {:else}
            <p>{$t("shell.localMode")}</p>
            <p class="hint">{$t("shell.localModeHint")}</p>
          {/if}
        {:else if active === "media"}

          <section class="media-settings-section">
            <h3>{$t("shell.stockPhotoApiKeys")}</h3>
            <p class="hint">{$t("shell.stockPhotoApiKeysHint")}</p>
            {#each providerIds as id (id)}
              {@const provider = STOCK_PROVIDERS[id]}
              {@const keyLabel = $t(id === "unsplash" ? "shell.providerAccessKey" : "shell.providerApiKey", { name: provider.label })}
              {@const invalid = !!keys[id]?.trim() && !new RegExp(`^${provider.pattern}$`).test(keys[id]!.trim())}
              <div class="stock-key">
                <div class="stock-key-head">
                  <h4><label for={`rigel-key-${id}`}>{keyLabel}</label></h4>
                  <a href={provider.keyURL} target="_blank" rel="noopener noreferrer">{$t(id === "unsplash" ? "shell.getAccessKey" : "shell.getApiKey")}</a>
                </div>
                <div class="secret-input">
                  <input
                    id={`rigel-key-${id}`}
                    type={revealed[id] ? "text" : "password"}
                    bind:value={keys[id]}
                    placeholder={provider.placeholder}
                    autocomplete="off"
                    spellcheck={false}
                    aria-label={keyLabel}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `rigel-key-${id}-error` : undefined}
                  />
                  <button type="button" aria-label={$t(revealed[id] ? "shell.hideKey" : "shell.showKey", { name: keyLabel })} aria-controls={`rigel-key-${id}`} aria-pressed={revealed[id] ?? false} onclick={() => revealed[id] = !revealed[id]}>
                    <Icon name={revealed[id] ? "eyeSlash" : "eye"} size={18} />
                  </button>
                </div>
                {#if invalid}<p class="error" id={`rigel-key-${id}-error`}>{$t("shell.keyFormatError", { name: keyLabel })}</p>{/if}
              </div>
            {/each}

          </section>


        {:else if active === "about"}
          <div class="about-brand">
            <img src={logo} alt="" width="32" height="32" />
            <h3>Rigel <span class="brand-suffix">CMS</span></h3>
            <span class="about-version" data-rigel-version>v{installedVersion}</span>
          </div>
          <p>{#each $t("shell.aboutSource", { github: "{github}", website: "{website}" }).split(/(\{github\}|\{website\})/) as part}{#if part === "{github}"}<a href="https://github.com/rigel-cms/rigel" target="_blank" rel="noopener noreferrer">GitHub</a>{:else if part === "{website}"}<a href="https://rigelcms.dev" target="_blank" rel="noopener noreferrer">{$t("shell.website")}</a>{:else}{part}{/if}{/each}</p>
          <p>{#each $t("shell.aboutAcknowledgements", { acknowledgements: "{acknowledgements}" }).split("{acknowledgements}") as part, index}{#if index}<a href="https://github.com/rigel-cms/rigel/blob/main/ACKNOWLEDGEMENTS.md" target="_blank" rel="noopener noreferrer">{$t("shell.acknowledgements")}</a>{/if}{part}{/each}</p>
          <p>{#each $t("shell.aboutLegal", { terms: "{terms}", privacy: "{privacy}" }).split(/(\{terms\}|\{privacy\})/) as part}{#if part === "{terms}"}<a href="https://rigelcms.dev/terms/" target="_blank" rel="noopener noreferrer">{$t("shell.termsOfUse")}</a>{:else if part === "{privacy}"}<a href="https://rigelcms.dev/privacy/" target="_blank" rel="noopener noreferrer">{$t("shell.privacyPolicy")}</a>{:else}{part}{/if}{/each}</p>
          <p class="about-credit">{#each $t("shell.aboutLicense", { license: "{license}" }).split("{license}") as part, index}{#if index}<a href="https://github.com/rigel-cms/rigel/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">{license}</a>{/if}{part}{/each} {#each $t("shell.createdBy", { name: "{name}" }).split("{name}") as part, index}{#if index}<a href="https://alex.zappa.dev/" target="_blank" rel="noopener noreferrer">{author.name}</a>{/if}{part}{/each}</p>
        {:else}
          <h3>{$t("shell.developerMode")}</h3>
          <label class="inline">
            <input type="checkbox" role="switch" class="switch" bind:checked={s.devMode} />
            <span>{$t("shell.enableDevMode")}</span>
          </label>
          <p class="hint">{$t("shell.devModeHint")}</p>
          {#if collections.length}
            <div class="clear-data">
              <h3>{$t("shell.maintenance")}</h3>
              <p class="hint">{$t("shell.reindexHint")}</p>
              <button type="button" class="outlined" disabled={maintenanceDisabled || reindexBusy} onclick={onreindex}>{$t("shell.reindexCollections")}</button>
              {#if reindexBusy}
                <p role="status">{$t("shell.reindexWorking")}</p>
                <div class="connection-loader" role="progressbar" aria-label={$t("shell.reindexWorking")}></div>
                <button type="button" class="outlined" onclick={oncancelindex}>{$t("connection.cancel")}</button>
              {/if}
              {#if s.devMode}
                {#each collections as collection (collection.name)}
                  {#if collection.index}<p role="status">{collection.label} ({collection.name}): {$t(collection.index.state === "complete" ? "shell.indexReady" : "shell.indexingCollections", { loaded: collection.index.loaded, total: collection.index.total })}{#if collection.index.error} {collection.index.error}{/if}</p>{/if}
                {/each}
              {/if}
              {#if reindexMessage}<p role="status">{reindexMessage}</p>{/if}
            </div>
          {/if}
          <div class="clear-data">
            <h3>{$t("shell.clearData")}</h3>
            <p class="hint">{$t("shell.fileCacheHint")}</p>
            <button type="button" class="outlined" disabled={!canClearFileCache || fileCacheBusy} onclick={onclearcache}>{$t("shell.clearFileCache")}</button>
            {#if fileCacheMessage}<p role="status">{fileCacheMessage}</p>{/if}
            <p class="hint">{$t("shell.eraseAllDataHint")}</p>
            <button type="button" class="danger-btn" disabled={saving} onclick={() => {
              eraseError = "";
              try { onerase(); }
              catch { eraseError = $t("shell.eraseDataError"); }
            }}>{$t("shell.eraseAllData")}</button>
            {#if saving}<p class="hint" role="status">{$t("shell.waitForSave")}</p>{/if}
            {#if eraseError}<p class="error" role="alert">{eraseError}</p>{/if}
          </div>
        {/if}

        {#if error || keysError}
          <p class="error" role="alert">{error || keysError}</p>
        {/if}
      </div>
    </div>
  </div>
</div>
