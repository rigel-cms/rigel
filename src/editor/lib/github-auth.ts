export interface GitHubAccess {
  user: { login: string; name?: string; avatar_url: string; html_url: string };
  status: "ready" | "installation-required" | "read-only";
  installUrl: string;
  installation: { id: number; account: string; html_url: string } | null;
  repository: { id: number; full_name: string; default_branch: string; permissions: { push: boolean } } | null;
}

export function startGitHubLogin(authOrigin: string): Promise<{ accessToken: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    let origin: URL;
    try {
      origin = new URL(authOrigin);
      if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))) throw new Error();
    } catch { reject(new Error("Invalid authentication gateway origin.")); return; }
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    const url = new URL("/authorize", origin);
    url.searchParams.set("origin", window.location.origin);
    url.searchParams.set("nonce", nonce);
    let popup: Window | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: string, result?: { accessToken: string; expiresAt: number }) => {
      window.removeEventListener("message", receive);
      clearInterval(timer);
      clearTimeout(timeout);
      try { popup?.close(); } catch {}
      if (result) resolve(result);
      else reject(new Error(error));
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!popup || event.source !== popup || event.origin !== origin.origin || !data || data.type !== "rigel:auth" || data.provider !== "github" || data.nonce !== nonce) return;
      if (data.error) {
        finish(data.error === "Authorization denied"
          ? "GitHub authorization was denied. Sign in again and approve access to continue."
          : data.error === "Token exchange failed"
            ? "The auth gateway could not exchange GitHub's authorization code for a token. Repository access has not been checked."
            : "GitHub login failed. Please try signing in again.");
        return;
      }
      if (typeof data.access_token !== "string" || !/^ghu_[a-zA-Z0-9_]{1,4092}$/.test(data.access_token) || !Number.isInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) { finish("GitHub returned invalid or expired credentials. Please sign in again."); return; }
      finish(undefined, { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
    };
    window.addEventListener("message", receive);
    try { popup = window.open(url.href, "rigel-github-" + nonce, "popup,width=600,height=720"); }
    catch { finish("Unable to open GitHub login. Allow popups and try again."); return; }
    if (!popup) { finish("GitHub login popup was blocked. Allow popups and try again."); return; }
    timer = setInterval(() => { if (popup?.closed) finish("GitHub login was cancelled. Please try again."); }, 250);
    timeout = setTimeout(() => finish("GitHub login timed out. Please try again."), 120000);
  });
}

export async function checkGitHubAccess(token: string, repo: string, appSlug: string): Promise<GitHubAccess> {
  if (typeof token !== "string" || !/^ghu_[a-zA-Z0-9_]{1,4092}$/.test(token)) throw new Error("GitHub session is invalid. Please sign in again.");
  if (typeof repo !== "string" || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]+$/.test(repo) || [".", ".."].includes(repo.split("/")[1]) || typeof appSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appSlug)) throw new Error("Invalid GitHub repository or app configuration.");
  const get = async (endpoint: string) => {
    let response: Response;
    try {
      response = await fetch("https://api.github.com" + endpoint, {
        method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
    } catch { throw new Error("Unable to reach GitHub. Check your connection and try again."); }
    if (!response.ok) {
      if (response.status === 401) throw new Error("GitHub session expired or was revoked. Please sign in again.");
      if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) throw new Error("GitHub rate limit reached. Wait a few minutes and try again.");
      if (response.status === 403) throw new Error("GitHub access denied. Check app permissions and organization approval, then sign in again.");
      if (response.status === 404) throw new Error("GitHub repository or installation is unavailable. Check the repository name and app installation, then try again.");
      throw new Error("GitHub could not verify access. Please try again later.");
    }
    try { return await response.json(); }
    catch { throw new Error("GitHub returned an invalid access response. Please try again."); }
  };
  const list = async <T>(endpoint: string, key: string): Promise<T[]> => {
    const entries: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = await get(`${endpoint}?per_page=100&page=${page}`);
      if (!data || !Array.isArray(data[key])) throw new Error("GitHub returned an invalid access response. Please try again.");
      entries.push(...data[key]);
      if (data[key].length < 100 && !(typeof data.total_count === "number" && entries.length < data.total_count)) return entries;
      if (!data[key].length) break;
    }
    throw new Error("GitHub access listing is incomplete. Please try again or narrow the app's repository selection.");
  };
  const rawUser = await get("/user");
  if (!rawUser || ![rawUser.login, rawUser.avatar_url, rawUser.html_url].every(value => typeof value === "string" && value)) throw new Error("GitHub returned an invalid user. Please sign in again.");
  const name = typeof rawUser.name === "string" ? rawUser.name.trim() : "";
  const user = { login: rawUser.login, ...(name ? { name } : {}), avatar_url: rawUser.avatar_url, html_url: rawUser.html_url };
  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;
  const result: GitHubAccess = { user, status: "installation-required", installUrl, installation: null, repository: null };
  type Installation = { id: number; app_slug: string; account?: { login?: string }; html_url?: string; permissions?: { contents?: string }; suspended_at?: string | null };
  const installations = await list<Installation>("/user/installations", "installations");
  for (const installation of installations) {
    if (!installation || installation.app_slug !== appSlug || !Number.isSafeInteger(installation.id) || installation.id <= 0 || typeof installation.account?.login !== "string") continue;
    let configureUrl = installUrl;
    try {
      const url = new URL(installation.html_url ?? "");
      if (url.origin === "https://github.com" && !url.username && !url.password && !url.search && !url.hash && new RegExp(`^/(?:settings|organizations/[a-zA-Z0-9-]+/settings)/installations/${installation.id}$`).test(url.pathname)) configureUrl = url.href;
    } catch {}
    const verifiedInstallation = { id: installation.id, account: installation.account.login, html_url: configureUrl };
    if (installation.account.login.toLowerCase() === repo.split("/")[0].toLowerCase()) {
      result.installUrl = configureUrl;
      result.installation = verifiedInstallation;
    }
    const repositories = await list<NonNullable<GitHubAccess["repository"]>>(`/user/installations/${installation.id}/repositories`, "repositories");
    const repository = repositories.find(repository => repository && typeof repository.full_name === "string" && repository.full_name.toLowerCase() === repo.toLowerCase());
    if (!repository) continue;
    if (!Number.isSafeInteger(repository.id) || repository.id <= 0 || typeof repository.default_branch !== "string" || !repository.default_branch) throw new Error("GitHub returned an invalid repository. Please try again.");
    const push = repository.permissions?.push === true;
    return {
      user, status: push && installation.permissions?.contents === "write" && !installation.suspended_at ? "ready" : "read-only", installUrl: configureUrl,
      installation: verifiedInstallation,
      repository: { id: repository.id, full_name: repository.full_name, default_branch: repository.default_branch, permissions: { push } },
    };
  }
  return result;
}