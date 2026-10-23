export const MEDIA_TYPES: Record<string, { type: string; category: string }> = {};
for (const [category, entries] of Object.entries({
  Images: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' },
  Audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' },
  Video: { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' },
  Documents: { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  Spreadsheets: { xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', ods: 'application/vnd.oasis.opendocument.spreadsheet' },
  Archives: { zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar' },
})) for (const [extension, type] of Object.entries(entries)) MEDIA_TYPES[extension] = { type, category };

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
