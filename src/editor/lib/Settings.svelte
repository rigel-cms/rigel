<script lang="ts">
  import { getKeys, setKeys, STOCK_PROVIDERS } from "./images";
  import type { RigelSettings } from "./settings";
  import Icon from "./Icon.svelte";

  let { s = $bindable(), error, saving, onerase, onclose }: {
    s: RigelSettings;
    error: string;
    saving: boolean;
    onerase: () => void;
    onclose: () => void;
  } = $props();

  type PaneId = "appearance" | "editor" | "media" | "language" | "advanced";
  let active: PaneId = $state("appearance");

  const providerIds = Object.keys(STOCK_PROVIDERS) as (keyof typeof STOCK_PROVIDERS)[];
  let keys = $state(getKeys());
  let revealed = $state<Partial<Record<keyof typeof STOCK_PROVIDERS, boolean>>>({});
  let keysError = $state("");
  let eraseError = $state("");

  const panes: { id: PaneId; label: string }[] = [
    { id: "appearance", label: "Appearance" },
    { id: "editor", label: "Editor" },
    { id: "media", label: "Media" },
    { id: "language", label: "Language" },
    { id: "advanced", label: "Advanced" },
  ];

  const PANE_ICONS = {
    appearance: "palette",
    editor: "textB",
    media: "image",
    language: "translate",
    advanced: "wrench",
  } as const;

  $effect(() => {
    try {
      setKeys(Object.fromEntries(providerIds.map((id) => [id, keys[id]?.trim() || undefined])));
      keysError = "";
    } catch {
      keysError = "API keys could not be saved in this browser. Allow browser storage and try again.";
    }
  });
</script>

<div
  class="rigel-modal-backdrop rigel"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => e.key === "Escape" && onclose()}
>
  <div class="rigel-modal settings-modal" role="dialog" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
    <div class="settings-head">
      <h2>Settings</h2>
      <button class="close" onclick={onclose} aria-label="Close">
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
          <h3>Appearance</h3>
          <fieldset>
            <legend>Theme</legend>
            <div class="theme-options">
              {#each ["system", "light", "dark"] as const as t}
                <label class="theme-option">
                  <input type="radio" bind:group={s.theme} value={t} />
                  <span>{t[0].toUpperCase() + t.slice(1)}</span>
                </label>
              {/each}
            </div>
          </fieldset>
          <fieldset class="accessibility-options">
            <legend>Accessibility</legend>
            <label class="inline">
              <input type="checkbox" role="switch" class="switch" bind:checked={s.highContrast} aria-describedby="high-contrast-hint" />
              <span>High contrast mode</span>
            </label>
            <p class="hint" id="high-contrast-hint">Stronger text and borders in both light and dark themes.</p>
          </fieldset>

        {:else if active === "editor"}
          <h3>Editor experience</h3>
          <fieldset>
            <legend>Article body editing</legend>
            <label class="radio"><input type="radio" bind:group={s.userPref.editorExperience} value="sidebar" /><span>Sidebar</span></label>
            <label class="radio"><input type="radio" bind:group={s.userPref.editorExperience} value="inline" /><span>Inline preview</span></label>
          </fieldset>
          <p class="hint">Inline preview lets you click an article body and write directly on the page. Other fields stay in the sidebar. This preference saves in this browser; content still requires Save.</p>
        {:else if active === "media"}

          <section class="media-settings-section">
            <h3>Stock Photo Service API Keys</h3>
            <p class="hint">Manage API keys for stock photo services. Keys save automatically in this browser only.</p>
            {#each providerIds as id (id)}
              {@const provider = STOCK_PROVIDERS[id]}
              {@const keyLabel = `${provider.label} ${id === "unsplash" ? "Access Key" : "API key"}`}
              {@const invalid = !!keys[id]?.trim() && !new RegExp(`^${provider.pattern}$`).test(keys[id]!.trim())}
              <div class="stock-key">
                <div class="stock-key-head">
                  <h4><label for={`rigel-key-${id}`}>{keyLabel}</label></h4>
                  <a href={provider.keyURL} target="_blank" rel="noopener noreferrer">Get {id === "unsplash" ? "Access Key" : "API key"}</a>
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
                  <button type="button" aria-label={`${revealed[id] ? "Hide" : "Show"} ${keyLabel}`} aria-controls={`rigel-key-${id}`} aria-pressed={revealed[id] ?? false} onclick={() => revealed[id] = !revealed[id]}>
                    <Icon name={revealed[id] ? "eyeSlash" : "eye"} size={18} />
                  </button>
                </div>
                {#if invalid}<p class="error" id={`rigel-key-${id}-error`}>Check the {keyLabel} format.</p>{/if}
              </div>
            {/each}

          </section>

        {:else if active === "language"}
          <h3>Language</h3>
          <fieldset>
            <legend>Editor interface language</legend>
            {#each ["en", "es", "ru"] as const as lang}
              <label class="radio">
                <input type="radio" bind:group={s.language} value={lang} />
                <span>{{ en: "English", es: "Español", ru: "Русский" }[lang]}{lang !== "en" ? " (soon)" : ""}</span>
              </label>
            {/each}
          </fieldset>
          <p class="hint">English is the only shipped locale today.</p>

        {:else}
          <h3>Developer Mode</h3>
          <label class="inline">
            <input type="checkbox" role="switch" class="switch" bind:checked={s.devMode} />
            <span>Enable dev mode</span>
          </label>
          <p class="hint">Shows raw JSON of the current draft + field keys next to labels.</p>
          <div class="clear-data">
            <h3>Clear Data</h3>
            <p class="hint">Rigel does not currently store file contents or thumbnails in a persistent browser cache.</p>
            <button type="button" class="danger-btn" disabled>Clear File Cache</button>
            <p class="hint">Erase Rigel settings, API keys and unsaved drafts from this browser. Files already saved to your repository are not affected.</p>
            <button type="button" class="danger-btn" disabled={saving} onclick={() => {
              eraseError = "";
              try { onerase(); }
              catch { eraseError = "Could not erase browser data. Check browser storage permissions and try again."; }
            }}>Erase All Data</button>
            {#if saving}<p class="hint" role="status">Wait for the current save to finish.</p>{/if}
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
