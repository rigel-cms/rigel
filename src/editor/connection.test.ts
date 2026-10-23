import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { compile } from "svelte/compiler";

test("connection screen links legal pages without displaying repository or branch details", () => {
  const source = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
  const connection = source.slice(source.indexOf('<main id="github-connection"'), source.indexOf("</main>"));
  expect(() => compile(source, { filename: "App.svelte", generate: "client" })).not.toThrow();
  expect(connection).toContain("Sign in to edit this website.");
  expect(connection).toContain('href="https://rigelcms.dev/terms"');
  expect(connection).toContain('href="https://rigelcms.dev/privacy"');
  expect(connection).not.toMatch(/manifest\.github\.(repo|branch|publishBranch)|Only select repositories|Save writes|drafts workspace/);
  expect(connection).toContain("onclick={connectGitHub}");
  expect(connection).toContain("onclick={recheckGitHub}");
  expect(connection).toContain("href={githubAccess.installUrl}");
});

test("user menu reuses the GitHub avatar with a private request and icon fallback", () => {
  const source = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
  const avatar = source.slice(source.indexOf("{#snippet avatar()}"), source.indexOf("{/snippet}"));
  expect(source).toContain('githubAccess?.user.avatar_url');
  expect(source).toContain('avatars\\.githubusercontent\\.com');
  expect(source.match(/\{@render avatar\(\)\}/g)).toHaveLength(2);
  expect(avatar).toContain('userAvatar && failedAvatar !== userAvatar');
  expect(avatar).toContain('src={userAvatar}');
  expect(avatar).toContain('referrerpolicy="no-referrer"');
  expect(avatar).toContain('onerror={() => { failedAvatar = userAvatar; }}');
  expect(avatar).toContain('<Icon name="user"');
  expect(source).not.toMatch(/gravatar\.com/);
});
