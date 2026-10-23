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

test("identity keeps public name and login separate from read-only connection settings", () => {
  const app = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
  const settings = readFileSync(new URL("./lib/Settings.svelte", import.meta.url), "utf8");
  expect(() => compile(settings, { filename: "Settings.svelte", generate: "client" })).not.toThrow();
  expect(app).toContain('githubAccess?.user.name ?? githubAccess?.user.login');
  expect(app).toContain('`@${githubAccess.user.login}`');
  expect(app).not.toContain('const userMode');
  expect(app.match(/<small>\{userLogin\}<\/small>/g)).toHaveLength(2);
  expect(app).toContain('github={githubMode ? manifest.github : undefined} user={githubAccess?.user}');
  expect(settings).toContain('{ id: "connection", label: "Connection" }');
  for (const label of ["GitHub account", "Repository", "Editing branch", "Publishing branch", "Local mode", "No GitHub account connected."]) expect(settings).toContain(label);
  expect(settings).toContain('user.name ?? user.login');
  expect(settings).toContain('@{user.login}');
  expect(settings).toContain('{#if github.publishBranch}');
  expect(settings).not.toMatch(/accessToken|gitContext|github\.token|user\.email/);
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
