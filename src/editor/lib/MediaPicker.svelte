<script lang="ts">
  import Icon from "./Icon.svelte";
  import { tick } from "svelte";
  import ImagePicker from "./ImagePicker.svelte";
  import type { EmbedRef } from "./embeds";
  import type { EmbedData } from "../blocks/embed";
  import type { VideoData } from "../blocks/video";

  let { triggerLabel = "Insert media", hiddenTrigger = false, onimage, onvideo, onembed, onopen, onclose = () => {} }: {
    triggerLabel?: string;
    hiddenTrigger?: boolean;
    onimage?: () => void;
    onvideo?: (video: VideoData) => void;
    onembed?: (embed: EmbedRef & { privacy: boolean; title?: string }) => void;
    onclose?: () => void;
    onopen?: () => void;
  } = $props();
  const id = $props.id();

  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let videoPicker: ImagePicker;
  let video = $state<VideoData | undefined>();
  let embed = $state<EmbedData | undefined>();

  export function toggleMenu() {
    if (!menu) return;
    if (menu.matches(":popover-open")) menu.hidePopover();
    else menu.showPopover();
  }
  export async function pick(choice: "image" | "video" | "youtube" | "vimeo") {
    if (menu?.matches(":popover-open")) menu.hidePopover();
    onopen?.();
    reset();
    if (choice === "image") { onimage?.(); return; }
    await tick();
    videoPicker.launchVideo(choice === "video" ? "library" : choice);
  }
  function reset() {
    video = undefined; embed = undefined;
  }
  export async function edit(value: EmbedData | VideoData) {
    onopen?.();
    reset();
    if ("provider" in value) embed = value;
    else video = value;
    await tick();
    videoPicker.launchVideo("provider" in value ? value.provider : "library");
  }
  function close() {
    reset();
    trigger?.focus();
    onclose();
  }

</script>

{#if !hiddenTrigger}<button bind:this={trigger} data-media-trigger type="button" aria-label={triggerLabel} data-tooltip={triggerLabel} aria-haspopup="menu" popovertarget={`${id}-media`} onmousedown={event => event.preventDefault()} onclick={event => { event.preventDefault(); toggleMenu(); }}><Icon name="image" size={18} /></button>{/if}
<div bind:this={menu} id={`${id}-media`} class="block-menu media-menu" popover role="menu" aria-label="Insert media">
  <button type="button" role="menuitem" onclick={() => pick("image")}><Icon name="image" size={16} />Image</button>
  <button type="button" role="menuitem" onclick={() => pick("video")}><Icon name="filmStrip" size={16} />Video</button>
  <button type="button" role="menuitem" onclick={() => pick("youtube")}><Icon name="youtubeLogo" size={16} />YouTube</button>
  <button type="button" role="menuitem" onclick={() => pick("vimeo")}><Icon name="playCircle" size={16} />Vimeo</button>
</div>

<ImagePicker bind:this={videoPicker} toolbar hiddenTrigger kind="video" value={video?.src ?? ""} altText={video?.caption ?? ""} {video} {onvideo} {embed} {onembed} onclose={close} />
