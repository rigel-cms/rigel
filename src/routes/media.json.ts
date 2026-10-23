import type { APIRoute } from "astro";
import config from "virtual:rigel-config";
import { listMedia } from "./media-files";

export const GET: APIRoute = async () => {
  try {
    const assets = await listMedia(config.publicDir!, config.mediaDir);
    return Response.json({ assets, images: assets.filter(asset => asset.type.startsWith("image/")), folder: config.mediaDir ?? "rigel-media", writable: import.meta.env.DEV && config.backend === "local" });
  } catch {
    return Response.json({ error: "Could not read the configured media directory" }, { status: 500 });
  }
};
