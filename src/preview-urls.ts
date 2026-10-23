export function safePreviewUrl(value: string, image = false): boolean {
  return !!value && !/[ \t\r\n\f\v\u0000-\u001f\u007f\\]/.test(value) && !value.startsWith("//") && (!/^[a-z][a-z\d+.-]*:/i.test(value) || (image ? /^https?:/i : /^(https?:|mailto:)/i).test(value));
}
