import { formatMessage, type Translator } from "./format";
import dictionaries from "virtual:rigel-i18n";

export function requestTranslator(request: Request): Translator {
  const preferences = (request.headers.get("Accept-Language") ?? "").split(",").map(entry => {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find(parameter => parameter.trim().startsWith("q="))?.trim().slice(2);
    const weight = quality === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality) ? Number(quality) : 0;
    return { language: /^[a-z]{2}(?:-[a-z0-9]{1,8})*$/.test(tag) ? tag.split("-")[0] : "", weight };
  }).filter(({ language, weight }) => weight > 0 && Object.hasOwn(dictionaries, language)).sort((a, b) => b.weight - a.weight);
  const language = preferences[0]?.language ?? "en";
  return (key, parameters) => formatMessage(dictionaries, language, key, parameters);
}
