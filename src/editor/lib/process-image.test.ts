import { expect, test, vi } from 'vitest';
import { processImage, imageSourceLimit } from './process-image';
import { IMAGE_PROCESSING_DEFAULTS, MAX_IMAGE_SOURCE_BYTES } from '../../image-processing';

test('ordinary images remain byte-for-byte untouched when resizing is disabled', async () => {
  const file = new File(['unchanged'], 'photo.png', { type: 'image/png' });
  expect(await processImage(file, { ...IMAGE_PROCESSING_DEFAULTS, resize: false })).toBe(file);
});

test('HEIC sniffed despite a misleading extension is rejected when conversion is off', async () => {
  const file = new File([new Uint8Array([0,0,0,24]), 'ftypheic', new Uint8Array(12)], 'photo.jpg');
  await expect(processImage(file, { ...IMAGE_PROCESSING_DEFAULTS, convertHeic: false })).rejects.toThrow(/HEIC/);
});

test('source limit is bounded independently from the stored limit', async () => {
  const file = new File([new Uint8Array(MAX_IMAGE_SOURCE_BYTES + 1)], 'photo.heic');
  await expect(processImage(file, IMAGE_PROCESSING_DEFAULTS)).rejects.toThrow(/32/);
  expect(imageSourceLimit('phone.heif', IMAGE_PROCESSING_DEFAULTS, 1024)).toBe(MAX_IMAGE_SOURCE_BYTES);
  expect(imageSourceLimit('large.png', { ...IMAGE_PROCESSING_DEFAULTS, resize: true }, 1024)).toBe(MAX_IMAGE_SOURCE_BYTES);
  expect(imageSourceLimit('large.png', { ...IMAGE_PROCESSING_DEFAULTS, resize: false }, 1024)).toBe(1024);
  expect(imageSourceLimit('movie.mp4', { ...IMAGE_PROCESSING_DEFAULTS, resize: true }, 1024)).toBe(1024);
});

test('oversized dimensions are rejected before a native image can be allocated', async () => {
  const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer); view.setUint32(16, 10000); view.setUint32(20, 10000);
  await expect(processImage(new File([bytes], 'huge.png'), { ...IMAGE_PROCESSING_DEFAULTS, resize: true })).rejects.toThrow(/decoding limit/);
});

test('AVIF compatible mif1 brand is not mistaken for HEIC', async () => {
  const file = new File([new Uint8Array([0,0,0,24]), 'ftypavif', new Uint8Array(4), 'avifmif1'], 'photo.avif', { type: 'image/avif' });
  expect(await processImage(file, { ...IMAGE_PROCESSING_DEFAULTS, resize: true, convertHeic: false })).toBe(file);
});

test.each([
  { size: 1, extended: 16n, reachesDecoder: true },
  { size: 0, extended: 0n, reachesDecoder: true },
  { size: 1, extended: 7n, reachesDecoder: false },
  { size: 1, extended: 15n, reachesDecoder: false },
  { size: 1, extended: 17n, reachesDecoder: false },
  { size: 1, extended: 2n ** 60n, reachesDecoder: false },
])('HEIF mdat bounds: $size/$extended, decoder: $reachesDecoder', async ({ size, extended, reachesDecoder }) => {
  const bytes = new Uint8Array(24 + 32 + 16), view = new DataView(bytes.buffer);
  const box = (at: number, size: number, type: string) => { view.setUint32(at, size); bytes.set(new TextEncoder().encode(type), at + 4); };
  box(0, 24, 'ftyp'); bytes.set(new TextEncoder().encode('heic'), 8);
  box(24, 32, 'meta'); box(36, 20, 'ispe'); view.setUint32(48, 4032); view.setUint32(52, 3024);
  box(56, size, 'mdat'); if (size === 1) view.setBigUint64(64, extended);
  const image = vi.fn(function () { throw new Error('decoder reached'); });
  vi.stubGlobal('Image', image);
  try {
    await expect(processImage(new File([bytes], 'phone.heic'), IMAGE_PROCESSING_DEFAULTS)).rejects.toThrow(/Could not process/);
    expect(image).toHaveBeenCalledTimes(reachesDecoder ? 1 : 0);
  } finally { vi.unstubAllGlobals(); }
});

test('unsafe labels and invalid HEIC fail without decoding', async () => {
  await expect(processImage(new File(['invalid'], '../photo.heic'), IMAGE_PROCESSING_DEFAULTS)).rejects.toThrow(/Unsupported/);
  await expect(processImage(new File(['invalid'], 'photo.heic'), IMAGE_PROCESSING_DEFAULTS)).rejects.toThrow(/Could not process/);
});
