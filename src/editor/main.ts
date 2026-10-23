import { mount } from "svelte";
import App from "./App.svelte";
import "./styles.css";

const target = document.getElementById("rigel");
if (target) {
  import.meta.hot?.send("rigel:editor-ready");
  mount(App, { target });
}