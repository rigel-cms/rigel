export interface ImageProcessing {
  convertHeic: boolean;
  resize: boolean;
  quality: number;
  maxEdge: number;
}

export const IMAGE_PROCESSING_DEFAULTS: ImageProcessing = { convertHeic: true, resize: true, quality: 90, maxEdge: 2048 };
export const MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 64_000_000;

export function imageProcessingOptions(value: unknown, defaults = IMAGE_PROCESSING_DEFAULTS): ImageProcessing {
  const result = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of ['convertHeic', 'resize'] as const) if (typeof (value as ImageProcessing)[key] === 'boolean') result[key] = (value as ImageProcessing)[key];
  for (const key of ['quality', 'maxEdge'] as const) {
    const number = (value as ImageProcessing)[key];
    if (Number.isInteger(number) && number >= 1 && number <= (key === 'quality' ? 100 : 16384)) result[key] = number;
  }
  return result;
}
