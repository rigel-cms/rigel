<script lang="ts">
  import { t, availableLocales, localeNames } from "../i18n";
  import { getKeys, setKeys, STOCK_PROVIDERS } from "./images";
  import type { RigelSettings } from "./settings";
  import type { Manifest } from "../../manifest/types";
  import type { GitHubAccess } from "./github-auth";
  import Icon from "./Icon.svelte";

  let { s = $bindable(), github, user, error, saving, onerase, onclose }: {
    s: RigelSettings;
    github?: Manifest["github"];
    user?: GitHubAccess["user"];
    error: string;
    saving: boolean;
    onerase: () => void;
    onclose: () => void;
  } = $props();

  type PaneId = "appearance" | "editor" | "connection" | "media" | "language" | "advanced";
  let active: PaneId = $state("appearance");

  const providerIds = Object.keys(STOCK_PROVIDERS) as (keyof typeof STOCK_PROVIDERS)[];
  let keys = $state(getKeys());
  let revealed = $state<Partial<Record<keyof typeof STOCK_PROVIDERS, boolean>>>({});
  let keysError = $state("");
  let eraseError = $state("");

  const panes: { id: PaneId; label: string }[] = $derived([
    { id: "appearance", label: $t("shell.appearance") },
    { id: "editor", label: $t("shell.editor") },
    { id: "connection", label: $t("shell.connection") },
    { id: "media", label: $t("shell.media") },
    { id: "language", label: $t("shell.language") },
    { id: "advanced", label: $t("shell.advanced") },
  ]);

  const PANE_ICONS = {
    appearance: "palette",
    editor: "textB",
    connection: "user",
    media: "image",
    language: "translate",
    advanced: "wrench",
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
            onclick={() => (active = p.id)}
          >
            <span class="pico"><Icon name={PANE_ICONS[p.id]} size={24} /></span>
            {p.label}
          </button>
        {/each}
      </nav>

      <div class="settings-pane">
        {#if active === "appearance"}
          <h3>{$t("shell.appearance")}</h3>
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

        {:else if active === "editor"}
          <h3>{$t("shell.editorExperience")}</h3>
          <fieldset>
            <legend>{$t("shell.articleBodyEditing")}</legend>
            <label class="radio"><input type="radio" bind:group={s.userPref.editorExperience} value="sidebar" /><span>{$t("shell.sidebar")}</span></label>
            <label class="radio"><input type="radio" bind:group={s.userPref.editorExperience} value="inline" /><span>{$t("shell.inlinePreview")}</span></label>
          </fieldset>
          <p class="hint">{$t("shell.editorExperienceHint")}</p>
        {:else if active === "connection"}
          <h3>{$t("shell.connection")}</h3>
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

        {:else if active === "language"}
          <h3>{$t("shell.language")}</h3>
          <fieldset>
            <legend>{$t("shell.editorInterfaceLanguage")}</legend>
            {#each availableLocales as lang}
              <label class="radio">
                <input type="radio" bind:group={s.language} value={lang} />
                <span>{localeNames[lang]}</span>
              </label>
            {/each}
          </fieldset>

        {:else}
          <h3>{$t("shell.developerMode")}</h3>
          <label class="inline">
            <input type="checkbox" role="switch" class="switch" bind:checked={s.devMode} />
            <span>{$t("shell.enableDevMode")}</span>
          </label>
          <p class="hint">{$t("shell.devModeHint")}</p>
          <div class="clear-data">
            <h3>{$t("shell.clearData")}</h3>
            <p class="hint">{$t("shell.fileCacheHint")}</p>
            <button type="button" class="danger-btn" disabled>{$t("shell.clearFileCache")}</button>
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
