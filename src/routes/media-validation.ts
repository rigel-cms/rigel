import { MEDIA_TYPES } from '../media-types';

export function validMediaBytes(bytes: Uint8Array, extension: string): boolean {
  const contains = (value: Uint8Array) => bytes.some((_, index) => value.every((byte, offset) => bytes[index + offset] === byte));
  const utf8 = (value: string) => new TextEncoder().encode(value);
  const starts = (hex: string) => Array.from(hex.matchAll(/../g), ([pair]) => parseInt(pair, 16)).every((byte, index) => bytes[index] === byte);
  const text = (start: number, end: number) => Array.from(bytes.subarray(start, end), byte => String.fromCharCode(byte)).join('');
  if (['jpg', 'jpeg'].includes(extension)) return starts('ffd8ff');
  if (extension === 'png') return starts('89504e470d0a1a0a');
  if (extension === 'webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  if (extension === 'gif') return ['GIF87a', 'GIF89a'].includes(text(0, 6));
  if (['avif', 'mp4', 'm4a', 'mov'].includes(extension)) {
    if (bytes.length < 16 || text(4, 8) !== 'ftyp') return false;
    const brands = text(8, Math.min(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0), 128));
    return extension === 'avif' ? /avif|avis/.test(brands) : extension === 'm4a' ? /M4A |M4B /.test(brands) : extension === 'mov' ? brands.includes('qt  ') : /isom|iso2|mp41|mp42|avc1/.test(brands);
  }
  if (extension === 'wav') return text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE';
  if (extension === 'mp3') return text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0);
  if (extension === 'ogg') return text(0, 4) === 'OggS' && /vorbis|OpusHead|Speex/.test(text(0, 256));
  if (extension === 'webm') return starts('1a45dfa3') && text(0, 128).includes('webm');
  if (extension === 'pdf') return text(0, 5) === '%PDF-' && text(Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF');
  if (['doc', 'xls', 'ppt'].includes(extension)) return starts('d0cf11e0a1b11ae1') && contains(Uint8Array.from([...{doc: 'WordDocument', xls: 'Workbook', ppt: 'PowerPoint Document'}[extension]!].flatMap(char => [char.charCodeAt(0), 0])));
  if (extension === 'rtf') return text(0, 5) === '{\\rtf';
  if (['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods'].includes(extension)) {
    if (!starts('504b0304') && !starts('504b0506')) return false;
    if (!contains(Uint8Array.of(0x50, 0x4b, 0x05, 0x06))) return false;
    if (extension === 'zip') return true;
    if (['odt', 'ods'].includes(extension)) return contains(utf8(MEDIA_TYPES[extension].type));
    return contains(utf8('[Content_Types].xml')) && contains(utf8({docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml'}[extension]!));
  }
  if (extension === 'gz') return starts('1f8b08');
  if (extension === '7z') return starts('377abcaf271c');
  if (extension === 'rar') return starts('526172211a07');
  if (extension === 'tar') return bytes.length >= 512 && text(257, 262) === 'ustar';
  if (extension === 'csv' || extension === 'txt') {
    try { const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes); return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && (extension === 'txt' || (!/[<>]/.test(value) && /[,;\t]/.test(value))); } catch { return false; }
  }
  return false;
}
