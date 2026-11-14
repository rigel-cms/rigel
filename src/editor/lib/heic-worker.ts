import decode, { init } from '@discourse/heic/decode.js';
import wasm from '@discourse/heic/codec/dec/heic_dec.wasm?url';

self.onmessage = async ({ data }: MessageEvent<ArrayBuffer>) => {
  try {
    await init({ locateFile: () => wasm });
    const image = await decode(data);
    self.postMessage({ width: image.width, height: image.height, pixels: image.data.buffer }, { transfer: [image.data.buffer] });
  } catch { self.postMessage({ error: 'HEIC decode failed' }); }
};
