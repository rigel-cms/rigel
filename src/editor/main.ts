import { mount } from "svelte";
import { get } from "svelte/store";
import { locale, setLocale, t } from "./i18n";
import { getSettings } from "./lib/settings";
import App from "./App.svelte";
import "./styles.css";

const target = document.getElementById("rigel");
if (target) {
  setLocale(getSettings().language);
  const unsubscribe = t.subscribe(message => {
    document.documentElement.lang = get(locale);
    document.title = message("system.editorTitle");
  });
  import.meta.hot?.dispose(unsubscribe);
  import.meta.hot?.send("rigel:editor-ready");
  mount(App, { target });
}