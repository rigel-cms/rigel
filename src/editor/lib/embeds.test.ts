import { expect, test } from "vitest";
import { embedSrc, embedWatchUrl, parseEmbedUrl, safeEmbed } from "./embeds";

test("YouTube links parse across the common URL shapes", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) expect(parseEmbedUrl(url), url).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
});

test("Vimeo links parse and the watch URL is canonical", () => {
  expect(parseEmbedUrl("https://vimeo.com/76979871")).toEqual({ provider: "vimeo", id: "76979871" });
  expect(parseEmbedUrl("https://player.vimeo.com/video/76979871?h=abc")).toEqual({ provider: "vimeo", id: "76979871" });
  expect(embedWatchUrl({ provider: "vimeo", id: "76979871" })).toBe("https://vimeo.com/76979871");
  expect(embedWatchUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("embeds default to no tracking cookies", () => {
  const youtube = { provider: "youtube" as const, id: "dQw4w9WgXcQ" };
  const vimeo = { provider: "vimeo" as const, id: "76979871" };
  expect(embedSrc(youtube)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  expect(embedSrc(youtube, true)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  expect(embedSrc(youtube, false)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
  expect(embedSrc(vimeo)).toBe("https://player.vimeo.com/video/76979871?dnt=1");
  expect(embedSrc(vimeo, false)).toBe("https://player.vimeo.com/video/76979871");
});

test("non-video, malformed and hostile links are rejected", () => {
  for (const value of [
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://vimeo.com/notanumber",
    "javascript:alert(1)",
    "//www.youtube.com/watch?v=dQw4w9WgXcQ",
    "",
  ]) expect(parseEmbedUrl(value), value).toBeUndefined();
});

test("pasted links are trimmed but internal control characters are rejected", () => {
  expect(parseEmbedUrl("  https://youtu.be/dQw4w9WgXcQ\n")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
  expect(parseEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ\u0000")).toBeUndefined();
});

test("stored embed data is revalidated on read", () => {
  expect(safeEmbed({ provider: "youtube", id: "dQw4w9WgXcQ" })).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
  expect(safeEmbed({ provider: "youtube", id: "../../etc/passwd" })).toBeUndefined();
  expect(safeEmbed({ provider: "vimeo", id: "1" })).toBeUndefined();
  expect(safeEmbed({ provider: "example", id: "76979871" })).toBeUndefined();
  expect(safeEmbed(null)).toBeUndefined();
});
