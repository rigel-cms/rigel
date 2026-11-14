import { MAX_IMAGE_SOURCE_BYTES, MAX_IMAGE_PIXELS, type ImageProcessing } from '../../image-processing';
import { mediaMetadata, safeMediaLabel } from '../../media-types';
import { translate } from '../i18n';

export const heicName = (name: string) => /\.(heic|heif)$/i.test(name);
export function imageSourceLimit(name: string, options: ImageProcessing, limit: number) {
  return heicName(name) || (options.resize && ['jpg', 'jpeg', 'png', 'webp'].includes(mediaMetadata(name)?.extension ?? '')) ? MAX_IMAGE_SOURCE_BYTES : limit;
}

function dimensions(width: number, height: number) {
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS) throw new Error(translate('media.imageDimensionsExceeded'));
}

function inspect(bytes: Uint8Array, heic: boolean, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, size = 4) => String.fromCharCode(...bytes.subarray(at, at + size));
  let width = 0, height = 0, animated = false;
  if (heic) {
    const boxes = (start: number, end: number, depth: number) => {
      if (depth > 5) throw new Error(translate('media.imageProcessingFailed'));
      for (let at = start; at + 8 <= end;) {
        let size = view.getUint32(at), header = 8;
        const box = text(at + 4);
        if (size === 1) {
          if (end - at < 16) throw new Error(translate('media.imageProcessingFailed'));
          const extended = view.getBigUint64(at + 8);
          if (extended > BigInt(end - at)) throw new Error(translate('media.imageProcessingFailed'));
          size = Number(extended); header = 16;
        } else if (size === 0) size = end - at;
        if (size < header || size > end - at) throw new Error(translate('media.imageProcessingFailed'));
        if (box === 'moov') throw new Error(translate('media.heicSequenceUnsupported'));
        if (box === 'ispe' && size >= header + 12) {
          const w = view.getUint32(at + header + 4), h = view.getUint32(at + header + 8);
          dimensions(w, h); width = Math.max(width, w); height = Math.max(height, h);
        }
        if (['meta', 'iprp', 'ipco'].includes(box)) boxes(at + header + (box === 'meta' ? 4 : 0), at + size, depth + 1);
        at += size;
      }
    };
    boxes(0, bytes.length, 0);
  } else if (type === 'image/png' && bytes.length >= 24 && text(1, 3) === 'PNG') {
    width = view.getUint32(16); height = view.getUint32(20);
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = view.getUint32(at);
      if (size > bytes.length - at - 12) break;
      if (text(at + 4) === 'acTL') animated = true;
      at += size + 12;
    }
  } else if (type === 'image/webp' && text(0) === 'RIFF' && text(8) === 'WEBP') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const size = view.getUint32(at + 4, true), box = text(at);
      if (size > bytes.length - at - 8) break;
      if (box === 'ANIM' || box === 'ANMF') animated = true;
      if (box === 'VP8X' && size >= 10) {
        animated ||= !!(bytes[at + 8] & 2);
        width = 1 + bytes[at + 12] + (bytes[at + 13] << 8) + (bytes[at + 14] << 16);
        height = 1 + bytes[at + 15] + (bytes[at + 16] << 8) + (bytes[at + 17] << 16);
      } else if (box === 'VP8 ' && size >= 10) {
        width = view.getUint16(at + 14, true) & 16383; height = view.getUint16(at + 16, true) & 16383;
      } else if (box === 'VP8L' && size >= 5) {
        const bits = view.getUint32(at + 9, true);
        width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
      }
      at += 8 + size + (size % 2);
    }
  } else if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    for (let at = 2; at + 4 <= bytes.length;) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1];
      if (marker === 255) { at++; continue; }
      if (marker === 218 || marker === 217) break;
      const size = view.getUint16(at + 2);
      if (size < 2 || size > bytes.length - at - 2) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 7) {
        height = view.getUint16(at + 5); width = view.getUint16(at + 7); break;
      }
      at += size + 2;
    }
  }
  if (!animated) dimensions(width, height);
  return { width, height, animated };
}

async function nativeImage(file: Blob) {
  const url = URL.createObjectURL(file), image = new Image();
  try { image.src = url; await image.decode(); return image; }
  finally { URL.revokeObjectURL(url); }
}

async function decodeHeic(bytes: ArrayBuffer): Promise<ImageBitmap> {
  const worker = new Worker(new URL('./heic-worker.ts', import.meta.url), { type: 'module' });
  try {
    const pixels = await new Promise<ImageData>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 30000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout);
        try {
          if (data.error) throw new Error(data.error);
          dimensions(data.width, data.height);
          resolve(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height));
        } catch (error) { reject(error); }
      };
      worker.onerror = () => { clearTimeout(timeout); reject(new Error('decoder')); };
      worker.postMessage(bytes, [bytes]);
    });
    dimensions(pixels.width, pixels.height);
    return await createImageBitmap(pixels);
  } finally { worker.terminate(); }
}

export async function processImage(file: File, options: ImageProcessing): Promise<File> {
  const metadata = mediaMetadata(file.name);
  if (!heicName(file.name) && metadata?.category !== 'Images') return file;
  if (!safeMediaLabel(file.name)) throw new Error(translate('local.unsupportedMedia'));
  if (file.size > MAX_IMAGE_SOURCE_BYTES) throw new Error(translate('media.imageSourceExceeded'));
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const brand = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
  const brandEnd = head.length >= 16 ? Math.min(new DataView(head.buffer).getUint32(0), head.length) : 0;
  const brands = [brand(8)];
  for (let at = 16; at + 4 <= brandEnd; at += 4) brands.push(brand(at));
  const heic = brand(4) === 'ftyp' && !brands.some(b => ['avif', 'avis'].includes(b)) && brands.some(b => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(b));
  if (heicName(file.name) && !heic) throw new Error(translate('media.imageProcessingFailed'));
  if (heic && !options.convertHeic) throw new Error(translate('media.heicDisabled'));
  if (heic && brand(8) === 'msf1') throw new Error(translate('media.heicSequenceUnsupported'));
  const type = metadata?.type ?? '';
  if (!heic && (!options.resize || !['image/jpeg', 'image/png', 'image/webp'].includes(type))) return file;
  const bytes = await file.arrayBuffer();
  const info = inspect(new Uint8Array(bytes), heic, type);
  if (info.animated || (!heic && Math.max(info.width, info.height) <= options.maxEdge)) return file;
  let image: HTMLImageElement | ImageBitmap;
  try {
    try { image = await nativeImage(heic ? new Blob([file], { type: 'image/heic' }) : file); }
    catch (error) { if (!heic) throw error; image = await decodeHeic(bytes); }
    const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    dimensions(width, height);
    const scale = options.resize ? Math.min(1, options.maxEdge / Math.max(width, height)) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const outputType = heic ? 'image/webp' : type;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode')), outputType, options.quality / 100));
      if (blob.type !== outputType) throw new Error('format');
      return new File([blob], heic ? file.name.replace(/\.[^.]+$/, '') + '.webp' : file.name, { type: outputType, lastModified: file.lastModified });
    } finally { canvas.width = canvas.height = 0; if ('close' in image) image.close(); }
  } catch { throw new Error(translate('media.imageProcessingFailed')); }
}
