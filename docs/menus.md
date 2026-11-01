# Menus

Menus are developer-declared JSON documents. Editors can change their titles, links and ordering, but menu creation and deletion belong in the site's source files.

## Configure menus

Declare a folder in the [Astro integration](getting-started.md):

```ts
rigel({
  menus: {
    folder: "src/content/menus",
    maxDepth: 3,
  },
})
```

The folder is relative to the site root. `maxDepth` defaults to 3 and accepts integers from 1 to 10. Top-level items count as depth 1. The limit applies to each whole branch, including branches moved with Indent or Outdent.

Create `src/content/menus/main.json`:

```json
{
  "slug": "main",
  "title": "Main navigation",
  "items": [
    {
      "id": "company",
      "label": "Company",
      "url": "/about/",
      "children": [
        {
          "id": "contact",
          "label": "Contact",
          "url": "/contact/",
          "newTab": false,
          "children": []
        }
      ]
    }
  ]
}
```

The slug must be lowercase kebab-case and match the filename. Each item needs a nonempty stable `id`, `label`, `url` and a `children` array, even when empty. IDs must be unique across the entire menu. `newTab` is an optional boolean; omission means ordinary same-tab navigation.

Group items use this same shape and require a URL. A group is not a separate content type. Menus are stored link trees: adding a page or changing its route does not automatically update menu links. Review links when changing [content routes](preview.md).

## Edit links

The editor uses adjacent panels. The first lists root items; selecting one opens its label, URL and children in the next panel. Selecting a sibling replaces the open branch. The path above the panels returns to parents without discarding edits. Narrow screens show the current panel.

Add item creates a root item; Add child works inside the selected item. New items open for editing immediately. Drag handles reorder within the current list without nesting items or moving them between panels. Up, Down, Indent and Outdent provide explicit movement actions. Remove asks for confirmation and removes the selected item's children too.

Open in new tab defaults off. This stores `newTab`; the website renderer must apply the matching link attributes.

Selection and panel navigation leave the content unchanged. Edits remain in memory until Save. Leaving with unsaved edits offers Save and leave, Discard changes or Keep editing.

## Render on the website

Read the menu through the build's virtual manifest. This Astro example renders its root links:

```astro
---
import { menus } from "virtual:rigel-manifest";
const main = menus?.entries.find(menu => menu.slug === "main");
---
<nav aria-label={main?.title ?? "Main navigation"}>
  <ul>
    {main?.items.map(item => (
      <li>
        <a
          href={item.url}
          target={item.newTab ? "_blank" : undefined}
          rel={item.newTab ? "noopener noreferrer" : undefined}
        >{item.label}</a>
      </li>
    ))}
  </ul>
</nav>
```

For nested menus, render each item's `children` recursively in your own component. Use real links and keyboard-accessible controls for submenus. The starter's `src/components/MenuLinks.astro` demonstrates recursive `Astro.self` rendering with disclosure controls. Rigel stores the links; your templates own their layout and interaction.

A static website consumes menu files from its build checkout, not the editor's unsaved state. With the GitHub backend, Save writes to the configured draft branch; publishing and rebuilding the live branch are separate steps. See [GitHub](github.md) and [preview hosts](preview-hosts.md).

## Storage and validation

The local menu endpoint supports reading and updating existing regular files. It is available only in development with `backend: "local"` and a configured menu folder. Writes require a matching request origin. It rejects creation, deletion, mismatched slugs and symlinked folders or files, and replaces validated JSON atomically.

GitHub-backed menus use the configured repository, content root and draft branch. The remote store validates the same menu shape and maximum depth, disallows menu creation, and checks the expected file state before writing. See [GitHub](github.md) for authentication, conflicts and publishing.

URL validation accepts HTTP, HTTPS, mailto and tel protocols, along with relative paths and fragments whose destinations your website renderer and browser determine. It rejects protocol-relative URLs, backslashes, leading/trailing whitespace, ASCII spaces and ASCII control characters, and unsafe protocols such as `javascript:`. It does not check whether the destination exists or is trustworthy. Keep the `noopener noreferrer` attributes when rendering new-tab links.

For navigation inside the CMS rather than website links, use [sidebar configuration](sidebar.md). See the [documentation index](README.md) for the other guides.
