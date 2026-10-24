export type JsonOutput = "pretty" | "minified";

export function serializeContentJson(value: unknown, output: JsonOutput = "pretty"): string {
  return JSON.stringify(value, null, output === "minified" ? undefined : 2) + "\n";
}
