import type { HotPayload, Plugin, WebSocketClient } from "vite";
import { isRunnableDevEnvironment } from "vite";
import { fileURLToPath } from "node:url";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseConfig } from "../config";
import type { RigelConfig } from "../config";
import type { GitHubBackendConfig } from "../manifest/types";

const VIRTUAL_ID = "virtual:rigel-manifest";
const CONTENT_ID = "virtual:rigel-content";


export function rigelManifestPlugin(cfg: RigelConfig, publicDir?: URL, root?: URL): Plugin {
  cfg = parseConfig(cfg);
  const pattern = `/${cfg.copyDir}/**/*.ts`;
  const collections = cfg.collections ?? [];
  const documentTypes = cfg.schema?.documents ?? [];
  const github: GitHubBackendConfig | undefined = cfg.backend === "github" ? {
    repo: cfg.repo!, branch: cfg.branch!, publishBranch: cfg.publishBranch!, repoRoot: cfg.repoRoot!, authOrigin: cfg.authOrigin!, appSlug: cfg.appSlug!, copyDir: cfg.copyDir,
    collections: collections.map(({ name, folder }) => ({ name, folder })),
    jsonOutput: cfg.jsonOutput,
    ...(cfg.menus ? { menus: { folder: cfg.menus.folder, maxDepth: cfg.menus.maxDepth! } } : {}),
  } : undefined;

  const slugHelpers = `import { assertUniqueUrlSlugs as __rigelAssertUniqueUrlSlugs, validateDocumentSlugs as __rigelValidateDocumentSlugs } from ${JSON.stringify(fileURLToPath(new URL("../slugs.ts", import.meta.url)))};`;
  const documentsSrc = slugHelpers + (documentTypes.length
    ? `
${documentTypes.map((type, index) => `const __rigelDoc${index} = import.meta.glob(${JSON.stringify(`/${type.folder}/*.json`)}, { eager: true, import: "default" });`).join("\n")}
export const documentTypes = ${JSON.stringify(documentTypes.map((type) => ({ name: type.name, shared: Boolean(type.shared) })))};
const __rigelRawDocuments = { ${documentTypes.map((type, index) => `${JSON.stringify(type.name)}: __rigelDoc${index}`).join(", ")} };
export const documents = Object.entries(__rigelRawDocuments)
  .flatMap(([type, modules]) => Object.entries(modules).map(([file, data]) => {
    const slug = file.split("/").pop().replace(/\\.json$/, "");
    return { id: type + ":" + slug, type, slug, data: { ...data, _id: type + ":" + slug, _type: type } };
  }))
  .sort((a, b) => a.id.localeCompare(b.id));
__rigelValidateDocumentSlugs(${JSON.stringify(cfg.schema)}, documents, ${JSON.stringify(cfg.preview)});
const __rigelReservedSlugs = new Set(documents.filter((doc) => !documentTypes.find((type) => type.name === doc.type).shared).map((doc) => doc.slug));
`
    : `export const documentTypes = [];\nexport const documents = [];\nconst __rigelReservedSlugs = new Set();\n`);

  const collectionCode = collections
    .map(
      (c) => `  {
    name: ${JSON.stringify(c.name)},
    label: ${JSON.stringify(c.label ?? c.name)},
    listTitle: ${JSON.stringify(c.listTitle)},
    fields: ${JSON.stringify(c.fields)},
    columns: ${JSON.stringify(c.columns ?? null)},
    posts: Object.entries(
      import.meta.glob(${JSON.stringify(`/${c.folder}/**/*.json`)}, { eager: true, query: "?raw", import: "default" })
    ).map(([path, raw]) => {
      const post = JSON.parse(raw);
      __rigelValidateBody(post.body);
      __rigelValidateCollectionValues(${JSON.stringify(c.fields)}, post.frontmatter, documents);
      post.slug = path.split("/").pop().replace(/\\.json$/, "");
      return post;
    }),
  },`,
    )
    .join("\n");

  const menuCode = cfg.menus ? `
import { validateMenu } from ${JSON.stringify(fileURLToPath(new URL("../manifest/menu.ts", import.meta.url)))};
export const menus = {
  maxDepth: ${cfg.menus.maxDepth ?? 3},
  entries: Object.entries(import.meta.glob(${JSON.stringify(`/${cfg.menus.folder}/*.json`)}, { eager: true, query: "?raw", import: "default" }))
    .map(([path, raw]) => {
      try {
        const menu = validateMenu(JSON.parse(raw), ${cfg.menus.maxDepth ?? 3});
        if (path.split("/").pop() !== menu.slug + ".json") throw new Error("Menu slug must match filename");
        return menu;
      } catch (error) { throw new Error("Invalid menu " + path + ": " + error.message); }
    }).sort((a, b) => a.slug.localeCompare(b.slug)),
};` : "export const menus = undefined;";

  return {
    name: "rigel-manifest",
    enforce: "pre",
    configureServer(server) {
      const editors = new WeakSet<WebSocketClient>();
      server.ws.on("rigel:editor-ready", (_data, client) => editors.add(client));
      const hot = server.environments.client.hot;
      const broadcast = hot.send.bind(hot);
      hot.send = (payload: HotPayload | string, data?: unknown) => {
        if (typeof payload === "string") return broadcast(payload, data);
        if (payload.type === "full-reload" && payload.path === "*") {
          for (const client of server.ws.clients) if (!editors.has(client)) client.send(payload);
          return;
        }
        broadcast(payload);
      };
    },
    hotUpdate: {
      order: "post",
      handler({ file, modules, timestamp }) {
        if (!root || !/\.(json|md)$/.test(file)) return;
        const directory = path.dirname(file);
        const resolvedRoot = path.resolve(fileURLToPath(root));
        const menuFolder = cfg.menus ? path.resolve(resolvedRoot, cfg.menus.folder) : null;
        const documentFolders = new Set((cfg.schema?.documents ?? []).map((type) => path.resolve(resolvedRoot, type.folder)));
        const isMenu = menuFolder !== null && directory === menuFolder;
        const isDocument = documentFolders.has(directory);
        const isCollection = collections.some(collection => {
          const folder = path.resolve(resolvedRoot, collection.folder);
          return directory === folder || directory.startsWith(folder + path.sep);
        });
        if (!isMenu && !isDocument && !isCollection) return file.endsWith(".json") ? [] : undefined;
        const invalidated = new Set<typeof modules[number]>();
        for (const mod of modules) this.environment.moduleGraph.invalidateModule(mod, invalidated, timestamp, true);
        for (const id of [VIRTUAL_ID, CONTENT_ID]) {
          const virtual = this.environment.moduleGraph.getModuleById("\0" + id);
          if (virtual) this.environment.moduleGraph.invalidateModule(virtual, invalidated, timestamp, true);
        }
        if (isRunnableDevEnvironment(this.environment)) {
          for (const mod of invalidated) {
            const evaluated = mod.id && this.environment.runner.evaluatedModules.getModuleById(mod.id);
            if (evaluated) this.environment.runner.evaluatedModules.invalidateModule(evaluated);
          }
        }
        if (this.environment.name === "client") {
          this.environment.hot.send({ type: "custom", event: isMenu ? "rigel:menus-updated" : isCollection ? "rigel:collections-updated" : "rigel:content-updated", data: {} });
        }
        return [];
      },
    },
    resolveId(id) {
      if (id === "virtual:rigel-extensions" || id === VIRTUAL_ID || id === CONTENT_ID || id === "virtual:rigel-config" || id === "virtual:rigel-i18n") return "\0" + id;
    },
    load(id) {
      if (id === "\0virtual:rigel-extensions") {
        if (!cfg.extensions!.length) return "export default [];";
        if (!root) throw new Error("rigel: extensions require the Astro project root");
        const directory = fileURLToPath(root);
        const imports = cfg.extensions!.map((module, index) => {
          let filename = directory;
          for (const part of module.slice(2).split("/")) {
            filename = path.join(filename, part);
            try {
              if (lstatSync(filename).isSymbolicLink()) throw new Error("rigel: extension paths must not contain symlinks");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          }
          return `import __rigelExtension${index} from ${JSON.stringify(filename)};`;
        });
        return `${imports.join("\n")}\nexport default [${cfg.extensions!.map((_, index) => `__rigelExtension${index}`).join(", ")}];`;
      }
      if (id === "\0virtual:rigel-i18n") {
        const imports: string[] = [];
        const dictionaries = cfg.languages!.map((language, index) => {
          const directory = fileURLToPath(new URL(`../editor/i18n/${language}/`, import.meta.url));
          const catalogs = readdirSync(directory).filter(file => file.endsWith(".json")).sort().map((file, catalog) => {
            const name = `__rigelLocale${index}_${catalog}`;
            imports.push(`import ${name} from ${JSON.stringify(path.join(directory, file))};`);
            return `...${name}`;
          });
          return `${JSON.stringify(language)}: { ${catalogs.join(", ")} }`;
        });
        return `${imports.join("\n")}\nexport default { ${dictionaries.join(", ")} };`;
      }
      if (id === "\0virtual:rigel-config") {
        return `export default ${JSON.stringify({
          copyDir: cfg.copyDir,
          backend: cfg.backend,
          jsonOutput: cfg.jsonOutput,
          demo: cfg.demo,
          languages: cfg.languages,
          publicDir: publicDir?.href,
          mediaDir: cfg.mediaDir,
          maxFileSize: cfg.maxFileSize,
          root: root?.href,
          menus: cfg.menus,
          collections: cfg.collections ?? [],
          schema: cfg.schema,
          preview: cfg.preview,
        })};`;
      }
      if (id === "\0" + CONTENT_ID) {
        return `${documentsSrc}
import { buildDocumentIndex, deref } from ${JSON.stringify(fileURLToPath(new URL("../schema/docs.ts", import.meta.url)))};
const __rigelIndex = buildDocumentIndex(documents);
export function getDocument(id) { return __rigelIndex.byId.get(id); }
export function derefDocument(value) { return deref(value, __rigelIndex); }
`;
      }
      if (id !== "\0" + VIRTUAL_ID) return;
      if (cfg.menus && root) {
        let directory = realpathSync(fileURLToPath(root));
        try {
          for (const part of cfg.menus.folder.split("/")) {
            directory = path.join(directory, part);
            const info = lstatSync(directory);
            if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("rigel: unsafe menu folder");
          }
          for (const name of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
            const info = lstatSync(path.join(directory, name));
            if (info.isSymbolicLink() || !info.isFile()) throw new Error("rigel: unsafe menu file " + name);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return `
import { validateBody as __rigelValidateBody } from ${JSON.stringify(fileURLToPath(new URL("../article-body.ts", import.meta.url)))};
import { validateCollectionValues as __rigelValidateCollectionValues } from ${JSON.stringify(fileURLToPath(new URL("../manifest/collections.ts", import.meta.url)))};
const modules = import.meta.glob(${JSON.stringify(pattern)}, { eager: true });
const loaded = Object.values(modules).map((m) => m.default);
${documentsSrc}
export const pages = loaded.filter((page) => !__rigelReservedSlugs.has(page.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
export const collections = [
${collectionCode}
];
for (const collection of collections) __rigelAssertUniqueUrlSlugs(collection.posts.map(post => ({ slug: post.slug, values: post.frontmatter })));
${menuCode}
export default { pages, collections, documents${github ? ', backend: "github", github: ' + JSON.stringify(github) : ""}${cfg.menus ? ", menus" : ""}${cfg.schema ? ", schema: " + JSON.stringify(cfg.schema) : ""}${cfg.preview ? ", preview: " + JSON.stringify(cfg.preview) : ""}${cfg.sidebar ? ", sidebar: " + JSON.stringify(cfg.sidebar) : ""} };
`;
    },
  };
}
