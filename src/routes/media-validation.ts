import { MEDIA_TYPES } from '../media-types';

export function validMediaBytes(bytes: Buffer, extension: string): boolean {
  const starts = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const text = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (['jpg', 'jpeg'].includes(extension)) return starts('ffd8ff');
  if (extension === 'png') return starts('89504e470d0a1a0a');
  if (extension === 'webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  if (extension === 'gif') return ['GIF87a', 'GIF89a'].includes(text(0, 6));
  if (['avif', 'mp4', 'm4a', 'mov'].includes(extension)) {
    if (bytes.length < 16 || text(4, 8) !== 'ftyp') return false;
    const brands = text(8, Math.min(bytes.readUInt32BE(0), 128));
    return extension === 'avif' ? /avif|avis/.test(brands) : extension === 'm4a' ? /M4A |M4B /.test(brands) : extension === 'mov' ? brands.includes('qt  ') : /isom|iso2|mp41|mp42|avc1/.test(brands);
  }
  if (extension === 'wav') return text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE';
  if (extension === 'mp3') return text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0);
  if (extension === 'ogg') return text(0, 4) === 'OggS' && /vorbis|OpusHead|Speex/.test(text(0, 256));
  if (extension === 'webm') return starts('1a45dfa3') && text(0, 128).includes('webm');
  if (extension === 'pdf') return text(0, 5) === '%PDF-' && text(Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF');
  if (['doc', 'xls', 'ppt'].includes(extension)) return starts('d0cf11e0a1b11ae1') && bytes.includes(Buffer.from({doc: 'WordDocument', xls: 'Workbook', ppt: 'PowerPoint Document'}[extension]!, 'utf16le'));
  if (extension === 'rtf') return text(0, 5) === '{\\rtf';
  if (['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods'].includes(extension)) {
    if (!starts('504b0304') && !starts('504b0506')) return false;
    if (!bytes.includes(Buffer.from('504b0506', 'hex'))) return false;
    if (extension === 'zip') return true;
    if (['odt', 'ods'].includes(extension)) return bytes.includes(Buffer.from(MEDIA_TYPES[extension].type));
    return bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from({docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml'}[extension]!));
  }
  if (extension === 'gz') return starts('1f8b08');
  if (extension === '7z') return starts('377abcaf271c');
  if (extension === 'rar') return starts('526172211a07');
  if (extension === 'tar') return bytes.length >= 512 && text(257, 262) === 'ustar';
  if (extension === 'csv') {
    try { const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes); return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(value) && /[,;\t]/.test(value); } catch { return false; }
  }
  return false;
}
