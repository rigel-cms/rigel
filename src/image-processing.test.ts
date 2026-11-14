import { expect, test } from 'vitest';
import { parseConfig } from './config';

test('image processing has safe website defaults and validates overrides', () => {
  expect(parseConfig().imageProcessing).toEqual({ convertHeic: true, resize: true, quality: 90, maxEdge: 2048 });
  expect(parseConfig({ imageProcessing: { quality: 80, resize: true } }).imageProcessing).toEqual({ convertHeic: true, resize: true, quality: 80, maxEdge: 2048 });
  expect(parseConfig({ imageProcessing: { resize: false, convertHeic: false } }).imageProcessing).toEqual({ convertHeic: false, resize: false, quality: 90, maxEdge: 2048 });
  for (const imageProcessing of [null, [], { quality: 0 }, { quality: 101 }, { quality: NaN }, { resize: 'yes' }, { convertHeic: 1 }, { maxEdge: 0 }, { maxEdge: 16385 }, { maxEdge: 1.5 }]) expect(() => parseConfig({ imageProcessing } as never)).toThrow(/imageProcessing/);
});
