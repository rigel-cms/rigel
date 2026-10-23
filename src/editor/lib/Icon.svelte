<script lang="ts">
  import { ICONS } from "./icons";

  let {
    name,
    size = 16,
    weight = "regular",
  }: {
    name: keyof typeof ICONS;
    size?: number;
    weight?: "light" | "regular" | "bold";
  } = $props();

  const icon = $derived(ICONS[name]);
  const d = $derived(icon?.d ?? "");
  const viewBox = $derived(icon?.viewBox ?? "0 0 24 24");
  const strokeWidth = $derived(weight === "light" ? 1.2 : weight === "bold" ? 2.2 : 1.8);
</script>

<svg
  class="rigel-icon"
  viewBox={viewBox}
  width={size}
  height={size}
  fill="currentColor"
  stroke="none"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  style="display:inline-block;vertical-align:middle;flex-shrink:0"
>
  <path {d} />
</svg>
