export const MEDIA_TYPES: Record<string, { type: string; category: string }> = {};
for (const [category, entries] of Object.entries({
  Images: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' },
  Audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' },
  Video: { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' },
  Documents: { txt: 'text/plain', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  Spreadsheets: { xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', ods: 'application/vnd.oasis.opendocument.spreadsheet' },
  Archives: { zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar' },
})) for (const [extension, type] of Object.entries(entries)) MEDIA_TYPES[extension] = { type, category };

export function mediaHeaders(filename: string, preview = false) {
  const metadata = mediaMetadata(filename)!;
  const inline = ['Images', 'Video'].includes(metadata.category) || (preview && ['pdf', 'txt'].includes(metadata.extension));
  return {
    'Content-Type': metadata.type === 'text/plain' ? 'text/plain; charset=utf-8' : metadata.type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  };
}

export const storedMediaFile = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.[a-z0-9]+$/;

export const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024;
export const MEDIA_CATEGORIES = ['Images', 'Audio', 'Video', 'Documents', 'Spreadsheets', 'Archives', 'Other'];
export function mediaMetadata(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return Object.hasOwn(MEDIA_TYPES, extension) ? { ...MEDIA_TYPES[extension], extension } : undefined;
}
export function safeMediaName(name: string) {
  return /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(name) && !!mediaMetadata(name);
}
export function mediaAccept(imagesOnly = false) {
  return Object.keys(MEDIA_TYPES).filter(ext => !imagesOnly || MEDIA_TYPES[ext].category === 'Images').map(ext => '.' + ext).join(',');
}

export function matchesMediaAccept(name: string, accept?: string): boolean {
  const metadata = mediaMetadata(name);
  if (!metadata) return false;
  return !accept || accept.toLowerCase().split(',').some(token => {
    const spec = token.trim();
    return spec === '.' + metadata.extension || spec === metadata.type || (spec.endsWith('/*') && metadata.type.startsWith(spec.slice(0, -1)));
  });
}

export function safeFileUrl(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || /[\s\u0000-\u001f\u007f\\?#]/.test(value)) return false;
  try {
    const parts = value.slice(1).split('/').map(part => decodeURIComponent(part));
    return parts.every(part => !!part && part !== '.' && part !== '..' && !/[\u0000-\u001f\u007f/\\?#]/.test(part)) && !!mediaMetadata(parts.at(-1)!);
  } catch { return false; }
}
