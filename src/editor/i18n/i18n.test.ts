import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { formatMessage, locale, setLocale, t, translate } from "./index";

const dictionaries = {
  en: { greeting: "Hello, {name}", "items.one": "{count} item", "items.other": "{count} items", fallback: "English" },
  ru: { greeting: "Привет, {name}", "items.one": "{count} запись", "items.few": "{count} записи", "items.many": "{count} записей", "items.other": "{count} записи" },
};

afterEach(() => setLocale("en"));

describe("editor translations", () => {
  it("interpolates parameters literally without evaluating markup or replacement tokens", () => {
    expect(formatMessage(dictionaries, "ru", "greeting", { name: "<script>$&</script>" })).toBe("Привет, <script>$&</script>");
    expect(formatMessage(dictionaries, "en", "greeting")).toBe("Hello, {name}");
  });

  it("uses native plural rules and English fallbacks", () => {
    expect(formatMessage(dictionaries, "ru", "items", { count: 1 })).toBe("1 запись");
    expect(formatMessage(dictionaries, "ru", "items", { count: 2 })).toBe("2 записи");
    expect(formatMessage(dictionaries, "ru", "items", { count: 5 })).toBe("5 записей");
    expect(formatMessage(dictionaries, "ru", "fallback")).toBe("English");
    expect(formatMessage(dictionaries, "fr", "items", { count: 2 })).toBe("2 items");
    expect(formatMessage(dictionaries, "en", "missing")).toBe("missing");
    expect(formatMessage(dictionaries, "en", "toString")).toBe("toString");
  });

  it("loads real English JSON and keeps unshipped languages on English", () => {
    setLocale("pt-BR");
    expect(get(locale)).toBe("en");
    expect(translate("system.editorTitle")).toBe("Rigel — Content Editor");
    expect(get(t)("system.editorTitle")).toBe("Rigel — Content Editor");
    expect(translate("validation.slug.duplicate", { slug: "about" })).toBe('URL slug "about" is already used.');
    setLocale(null);
    expect(get(locale)).toBe("en");
  });

  it.each([
    ["de-DE", "de", "Speichern", "Veröffentlichen", "Datei", "Dateien"],
    ["nl-NL", "nl", "Opslaan", "Publiceren", "bestand", "bestanden"],
  ])("switches to %s with native singular and plural counts", (tag, language, save, publish, singular, plural) => {
    setLocale(tag);
    expect(get(locale)).toBe(language);
    expect(translate("shell.save")).toBe(save);
    expect(get(t)("shell.publish")).toBe(publish);
    for (const count of [0, 1, 2, 5]) expect(translate("connection.fileCount", { count })).toBe(`${count} ${count === 1 ? singular : plural}`);
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });

  it("switches to Italian with invariant file counts and plural section labels", () => {
    setLocale("it-IT");
    expect(get(locale)).toBe("it");
    expect(translate("shell.save")).toBe("Salva");
    expect(get(t)("shell.publish")).toBe("Pubblica");
    for (const count of [0, 1, 2, 5]) expect(translate("connection.fileCount", { count })).toBe(`${count} file`);
    expect(translate("fields.pendingSections", { count: 1 })).toContain("sezione");
    expect(translate("fields.pendingSections", { count: 2 })).toContain("sezioni");
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });

  it("switches to Japanese and uses the same counting form for every count", () => {
    setLocale("ja-JP");
    expect(get(locale)).toBe("ja");
    expect(translate("shell.save")).toBe("保存");
    expect(get(t)("shell.publish")).toBe("公開");
    for (const count of [0, 1, 2, 5]) expect(translate("connection.fileCount", { count })).toBe(`${count} ファイル`);
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });

  it("switches to Simplified Chinese and uses the same counting form for every count", () => {
    setLocale("zh-CN");
    expect(get(locale)).toBe("zh");
    expect(translate("shell.save")).toBe("保存");
    expect(get(t)("shell.publish")).toBe("发布");
    for (const count of [0, 1, 2, 5]) expect(translate("connection.fileCount", { count })).toBe(`${count} 个文件`);
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });

  it("switches the real catalogs to French with singular zero and plural forms", () => {
    setLocale("fr-FR");
    expect(get(locale)).toBe("fr");
    expect(translate("shell.save")).toBe("Enregistrer");
    expect(get(t)("shell.publish")).toBe("Publier");
    expect(translate("connection.fileCount", { count: 0 })).toBe("0 fichier");
    expect(translate("connection.fileCount", { count: 1 })).toBe("1 fichier");
    expect(translate("connection.fileCount", { count: 2 })).toBe("2 fichiers");
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });

  it("switches the real catalogs to Spanish and back with native plural forms", () => {
    setLocale("es-ES");
    expect(get(locale)).toBe("es");
    expect(translate("shell.save")).toBe("Guardar");
    expect(get(t)("shell.publish")).toBe("Publicar");
    expect(translate("connection.fileCount", { count: 1 })).toBe("1 archivo");
    expect(translate("connection.fileCount", { count: 2 })).toBe("2 archivos");
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });

  it("switches the real catalogs to Russian and back without changing message keys", () => {
    setLocale("ru-RU");
    expect(get(locale)).toBe("ru");
    expect(translate("shell.save")).toBe("Сохранить");
    expect(get(t)("shell.publish")).toBe("Опубликовать");
    for (const [count, text] of [[1, "1 файл"], [2, "2 файла"], [5, "5 файлов"], [11, "11 файлов"], [21, "21 файл"]] as const) {
      expect(translate("connection.fileCount", { count })).toBe(text);
    }
    setLocale("en");
    expect(translate("shell.save")).toBe("Save");
  });
});
