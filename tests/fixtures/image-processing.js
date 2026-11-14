import { processImage } from '../../src/editor/lib/process-image';
import { uploadMedia, uploadImage, importImageUrl } from '../../src/editor/lib/images';
import { getSettings, setSettings } from '../../src/editor/lib/settings';
import { IMAGE_PROCESSING_DEFAULTS as defaults } from '../../src/image-processing';

export async function runPrivateImage(base64) {
  const source = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'IMG_3719.heic', { type: 'image/heic' });
  const output = await processImage(source, { ...defaults, resize: false });
  const bytes = new Uint8Array(await output.arrayBuffer());
  if (output.type !== 'image/webp' || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') throw new Error('Invalid WebP output');
  const bitmap = await createImageBitmap(output);
  const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
  if (dimensions.join() !== '3024,4032') throw new Error('Unexpected private image dimensions: ' + dimensions);
  setSettings({ imageProcessing: { ...defaults, resize: false } });
  const url = await uploadMedia(source);
  const stored = await (await fetch(url)).arrayBuffer();
  if (stored.byteLength !== bytes.length || new Uint8Array(stored).some((b, i) => b !== bytes[i])) throw new Error('Stored bytes differ');
  const resizeOptions = { ...defaults, resize: true, maxEdge: 2048 };
  const resized = await processImage(source, resizeOptions);
  const resizedBitmap = await createImageBitmap(resized);
  const resizedDimensions = [resizedBitmap.width, resizedBitmap.height]; resizedBitmap.close();
  if (resizedDimensions.join() !== '1536,2048') throw new Error('Unexpected downscaled dimensions: ' + resizedDimensions);
  setSettings({ imageProcessing: resizeOptions });
  const resizedUrl = await uploadMedia(source);
  const resizedStored = new Uint8Array(await (await fetch(resizedUrl)).arrayBuffer());
  const resizedBytes = new Uint8Array(await resized.arrayBuffer());
  if (resizedStored.length !== resizedBytes.length || resizedStored.some((b, i) => b !== resizedBytes[i])) throw new Error('Stored downscaled bytes differ');
  return { inputBytes: source.size, outputBytes: output.size, dimensions, type: output.type, resized: { bytes: resized.size, dimensions: resizedDimensions }, stored: [url, resizedUrl] };
}

export async function run() {
  const results = window.imageCheckResults = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const size = async file => { const bitmap = await createImageBitmap(file); const result = [bitmap.width, bitmap.height]; bitmap.close(); return result; };
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f30'; ctx.fillRect(0, 0, 400, 400); ctx.fillStyle = '#03f'; ctx.fillRect(400, 0, 400, 400);
  const files = [];
  for (const [extension, type] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .95));
    const source = new File([blob], `Océan (été).${extension}`, { type }); files.push(source);
    check(await processImage(source, { ...defaults, resize: false }) === source, `${extension}: disabled resize preserves exact file`);
    check(await processImage(source, { ...defaults, resize: true, maxEdge: 800 }) === source, `${extension}: within cap untouched`);
    const output = await processImage(source, { ...defaults, resize: true, maxEdge: 200 });
    check(output.type === type && output.name === source.name && (await size(output)).join() === '200,100', `${extension}: native resize keeps format and aspect ratio`);
    const tiny = await processImage(output, { ...defaults, resize: true, maxEdge: 2048 });
    check(tiny === output, `${extension}: no upscaling`);
  }
  canvas.width = 7000; canvas.height = 6000;
  ctx.fillStyle = '#03f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .9));
    const source = new File([blob], `large.${type.split('/')[1]}`, { type });
    const output = await processImage(source, { ...defaults, resize: true, maxEdge: 2048 });
    check(output.type === type && (await size(output)).join() === '2048,1755', `${type}: 7000×6000 downscales to 2048×1755`);
  }
  canvas.width = canvas.height = 0;
  const heic = new File([await (await fetch('/example.heic')).blob()], 'Phone (1).heic', { type: 'image/heic' });
  const output = await processImage(heic, defaults);
  check(output.type === 'image/webp' && output.name === 'Phone (1).webp' && (await size(output)).join() === '1280,854', 'real libheif HEIC fixture decodes to WebP');
  const low = await processImage(heic, { ...defaults, quality: 20 });
  check(low.size < output.size, 'HEIC encoder uses configured quality');
  const padding = new Uint8Array(2 * 1024 * 1024); new DataView(padding.buffer).setUint32(0, padding.length); padding.set([102,114,101,101], 4);
  const largeHeic = new File([heic, padding], 'Large.heic', { type: 'image/heic' });
  check(largeHeic.size > 2 * 1024 * 1024 && (await processImage(largeHeic, defaults)).size < 2 * 1024 * 1024, 'HEIC source above stored limit converts before final byte check');
  const resized = await processImage(heic, { ...defaults, resize: true, maxEdge: 320 });
  check((await size(resized)).join() === '320,214', 'HEIC conversion and resize share one canvas');
  const disguised = await processImage(new File([heic], 'misleading.jpg'), defaults);
  check(disguised.name === 'misleading.webp' && disguised.type === 'image/webp', 'HEIC bytes detected behind JPEG name');
  try { await processImage(heic, { ...defaults, convertHeic: false }); throw new Error('accepted'); } catch (error) { check(error.message.includes('HEIC/HEIF is unsupported'), 'disabled conversion has clear error'); }
  for (const [url, type] of [['/animation.webp', 'image/webp'], ['/animation.png', 'image/png'], ['/animation.gif', 'image/gif']]) {
    const file = new File([await (await fetch(url)).blob()], url.slice(1), { type });
    const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type });
    await decoder.tracks.ready;
    check(decoder.tracks.selectedTrack.frameCount > 1, `${type}: fixture has real animation frames`); decoder.close();
    const output = await processImage(file, { ...defaults, resize: true, maxEdge: 1 });
    check(output === file, `${type}: animation stays byte-for-byte unchanged`);
  }
  const stored = [];
  setSettings({ imageProcessing: { ...defaults, resize: true, maxEdge: 200 } });
  for (const source of [files[0], largeHeic]) {
    const url = await uploadMedia(source); stored.push(url);
    const blob = await (await fetch(url)).blob();
    check((await size(blob)).join() === (source === largeHeic ? '200,133' : '200,100'), `local upload stores processed ${source.name}`);
  }
  const imported = await importImageUrl('/example.heic'); stored.push(imported);
  check((await size(await (await fetch(imported)).blob())).join() === '200,133', 'URL import stores processed HEIC');
  const imageUrl = await uploadImage(files[2]); stored.push(imageUrl);
  check((await size(await (await fetch(imageUrl)).blob())).join() === '200,100', 'shared Blob import resizes WebP');
  return { results, stored };
}
