<script lang="ts">
  import { isSidebarIconPath } from "../../manifest/navigation";
  let { name }: { name: string } = $props();
  const assets = import.meta.glob<string>("../assets/sidebar/*.svg", { eager: true, query: "?url&no-inline", import: "default" });
  const url = $derived(isSidebarIconPath(name) ? name : assets[`../assets/sidebar/${name}.svg`] ?? assets["../assets/sidebar/squares-four.svg"]);
</script>

<span class="sidebar-asset-icon" aria-hidden="true" style={`--sidebar-icon: url("${url}")`}></span>
