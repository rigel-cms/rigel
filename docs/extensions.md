# Extensions

Extensions are developer-owned TypeScript modules selected in your Astro configuration. Rigel imports them at build time. Restart the dev server after changing the extension list.

Install `@astrojs/svelte` in your site to let `astro check` typecheck your Svelte components. Rigel already registers the Svelte compiler for the editor and extension modules.

```ts
import { defineConfig } from 'astro/config';
import { rigel } from '@rigel-cms/rigel';

export default defineConfig({
  integrations: [rigel({ extensions: ['./src/rigel/cta.ts'] })],
});
```

## Add a call-to-action block

Create `src/rigel/cta.ts`:

```ts
import { defineExtension } from '@rigel-cms/rigel/extensions';
import CtaEditor from './CtaEditor.svelte';
import Cta from './Cta.svelte';
import CtaButton from './CtaButton.svelte';

export default defineExtension({
  name: 'site-cta',
  commands: [{
    name: 'insert-cta',
    label: 'Call to action',
    slash: 'cta',
    toolbar: true,
    button: CtaButton,
    run(context) {
      context.insertBlock('cta', { label: 'Contact us', href: '/contact/' });
    },
  }],
  blocks: [{
    name: 'cta',
    label: 'Call to action',
    editor: CtaEditor,
    render: Cta,
    validate(data) {
      if (typeof data.label !== 'string' || !data.label.trim()) {
        throw new Error('Enter a button label.');
      }
      if (typeof data.href !== 'string' || !/^\/[a-z0-9/-]*$/.test(data.href)) {
        throw new Error('Choose a local path such as /contact/.');
      }
    },
    toMarkdown(data) {
      const label = String(data.label).replace(/[\\[\]]/g, '\\$&');
      return `[${label}](<${data.href}>)`;
    },
  }],
});
```

Create `src/rigel/CtaEditor.svelte`:

```svelte
<script lang="ts">
  import type { ExtensionBlockProps } from '@rigel-cms/rigel/extensions';
  let { data, onchange }: ExtensionBlockProps = $props();
</script>

<label>
  Label
  <input
    value={String(data.label ?? '')}
    oninput={(event) => onchange({ ...data, label: event.currentTarget.value })}
  />
</label>
<label>
  Local path
  <input
    value={String(data.href ?? '')}
    oninput={(event) => onchange({ ...data, href: event.currentTarget.value })}
  />
</label>
```

Call `onchange` with the complete next data object rather than mutating `data`. Changes stay in the draft until the author clicks Save. Keep temporary input state inside your component if an incomplete value cannot pass your validator.

Create `src/rigel/Cta.svelte` for published HTML and read-only previews:

```svelte
<script lang="ts">
  import type { BlockData } from '@rigel-cms/rigel/extensions';
  let { data }: { data: BlockData } = $props();
</script>

<aside class="cta">
  <a href={String(data.href)}>{data.label}</a>
</aside>

<style>
  .cta { padding: 1rem; border: 1px solid currentColor; }
</style>
```

Create `src/rigel/CtaButton.svelte` to supply the command's toolbar button:

```svelte
<script lang="ts">
  import type { ExtensionButtonProps } from '@rigel-cms/rigel/extensions';
  let { label, disabled, onclick }: ExtensionButtonProps = $props();
</script>

<button type="button" {disabled} {onclick} data-tooltip={label} aria-label={label} onpointerdown={(event) => event.preventDefault()}>
  CTA
</button>
```

Omit `button` to use Rigel's default toolbar button. `slash: 'cta'` exposes the same command as `/cta`. Names must be unique across the selected extensions. Commands can read `context.selection`, call `insertText(text)`, insert a registered block with `insertBlock(name, data)`, or replace a selected custom block's data with `updateBlock(data)`.

## Group toolbar actions

Register a group and assign commands to it by name:

```ts
export default defineExtension({
  name: 'widgets',
  groups: [{ name: 'widgets', label: 'Widgets', button: WidgetsButton }],
  commands: [{
    name: 'insert-callout',
    label: 'Insert callout',
    slash: 'callout',
    group: 'widgets',
    run: context => context.insertBlock('callout', {
      title: 'Good to know', message: 'A note for readers.', tone: 'info',
    }),
  }],
  blocks: [{
    name: 'callout',
    label: 'Callout',
    editor: CalloutEditor,
    render: Callout,
    validate(data) {
      if (typeof data.title !== 'string' || typeof data.message !== 'string' || data.tone !== 'info') {
        throw new Error('Expected a title, message and info tone.');
      }
    },
  }],
});
```

The group occupies one toolbar button. Opening it shows only its assigned commands. A command's slash shortcut still works independently. Grouped commands appear in the toolbar automatically; set `toolbar: false` to keep a command out of the menu. Commands without a group keep their existing behavior.

A group's optional `button` uses the same `ExtensionButtonProps` as a command button. It can contain an SVG icon instead of text; keep its accessible label and call `onclick` to toggle the menu. Omit `button` for Rigel's default group trigger. Group names must be unique across registered modules. Commands can reference a group declared by another registered module, regardless of module order. An unknown group name is a configuration error. Empty groups do not create toolbar buttons.

The starter's `src/rigel/widgets.ts` is a complete second example: an icon-only Widgets group with callout and warning actions, an editable callout component, validation and a published renderer. The original CTA example remains a standalone button.

## Render articles on your site

Use the public article entry in Astro pages:

```astro
---
import { renderArticle, articleMarkdown } from '@rigel-cms/rigel/article';
const { body } = Astro.props;
let head = '';
const html = renderArticle(body, { onHead: value => { head = value; } });
const markdown = articleMarkdown(body);
---

<html lang="en">
  <head><Fragment set:html={head} /></head>
  <body><article data-rigel-richtext="$body" set:html={html} /></body>
</html>
```

`renderArticle(body)` still returns an HTML string. It validates each registered custom block and server-renders its `render` component with Svelte. By default the returned string includes component head output, including CSS emitted by Svelte. Use `onHead` to put that output in your page's head instead. CSS extracted by the build remains the build tool's responsibility. Keep render components synchronous for this string-returning API.

`renderArticle(body, { preview: true })` returns escaped custom-block markers. Rigel sanitizes the article HTML first, then mounts the registered read-only render components. It does not run the editor component in a read-only preview.

`articleMarkdown(body)` calls a block's optional `toMarkdown`. Without one, it writes a fenced `rigel-extension` placeholder containing the block's name and complete JSON data. Unknown blocks also retain their data in Markdown. Published HTML throws for an unknown block rather than silently losing content. Keep the extension registered while articles still use it, or migrate those articles before removing it.

## Data and trust

A custom block is a root-level article node with exactly this shape:

```json
{
  "type": "extension",
  "version": 1,
  "name": "cta",
  "data": { "label": "Contact us", "href": "/contact/" }
}
```

Custom blocks have no children. Data must be a bounded JSON object. Rigel checks that boundary and your block's `validate(data)` checks its schema and domain rules. Throw an error for invalid data. Validate URLs as URLs or restrict them to a known safe format; Svelte's attribute escaping does not make an unsafe URL safe.

Extension modules and Svelte components are trusted application code. Review them like any other dependency. Article content stores data and a registered name, never executable code or import locations. Rigel does not fetch modules, evaluate code from content, or install extensions at runtime. Use normal Svelte interpolation for content values; passing untrusted data to `{@html}` bypasses its escaping.
