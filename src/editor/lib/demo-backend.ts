import type { Manifest } from "../../manifest/types";
import type { Selection } from "../../manifest/navigation";
import { validateBody, type ArticleBody } from "../../article-body";
import { validateMenu } from "../../manifest/menu";
import { validateCollectionValues } from "../../manifest/collections";
import { isPlainObject, validateDocument, validateDocumentId } from "../../schema/validate";
import { assertUniqueUrlSlugs, validateDocumentSlugs } from "../../slugs";
import { resolveExtensions, validateExtensionBlocks } from "../../extensions";
import extensions from "virtual:rigel-extensions";
import { translate } from "../i18n";

export function validateDemoSelection(manifest: Manifest, selection: Selection, values: Record<string, unknown>, body: ArticleBody | "", creating: boolean) {
  if (manifest.backend !== "demo" || !isPlainObject(values)) throw new Error(translate("connection.invalidValues"));
  if (selection.kind === "page") {
    if (creating || !manifest.pages.some(page => page.slug === selection.slug)) throw new Error(translate("connection.unknownCopyPage"));
    if (!Object.values(values).every(isPlainObject)) throw new Error(translate("connection.invalidCopyGroups"));
  } else if (selection.kind === "post") {
    const collection = manifest.collections?.find(collection => collection.name === selection.collection);
    if (!collection) throw new Error(translate("connection.unknownCollection"));
    const exists = collection.posts.some(post => post.slug === selection.slug);
    if (exists === creating) throw new Error(translate("connection.invalidValues"));
    validateBody(body, translate);
    validateExtensionBlocks(body, resolveExtensions(extensions).blocks);
    validateCollectionValues(collection.fields, values, manifest.documents ?? [], translate);
    assertUniqueUrlSlugs([...collection.posts.filter(post => post.slug !== selection.slug).map(post => ({ slug: post.slug, values: post.frontmatter })), { slug: selection.slug, values }], translate);
  } else if (selection.kind === "document") {
    if (!manifest.schema) throw new Error(translate("connection.missingSchema"));
    const document = validateDocumentId(manifest.schema, selection.id);
    if (!document || document.type.name !== selection.type) throw new Error(translate("connection.unknownDocument"));
    if (creating && (document.type.creatable === false || document.type.singleton)) throw new Error(translate("connection.creationDisabled"));
    const documents = manifest.documents ?? [];
    if (documents.some(doc => doc.id === selection.id) === creating) throw new Error(translate("connection.invalidValues"));
    values._id = selection.id;
    values._type = selection.type;
    validateDocument(manifest.schema, selection.type, document.slug, values, documents, translate);
    validateDocumentSlugs(manifest.schema, [...documents.filter(doc => doc.id !== selection.id), { id: selection.id, type: selection.type, slug: document.slug, data: values }], manifest.preview, translate);
  } else if (selection.kind === "menu") {
    if (creating || !manifest.menus?.entries.some(menu => menu.slug === selection.slug)) throw new Error(translate("connection.menusNotConfigured"));
    validateMenu({ ...values, slug: selection.slug }, manifest.menus.maxDepth, translate);
  } else throw new Error(translate("connection.selectContent"));
}
