import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CropSelector, changePixelCrop, clampPixelCrop, imagePoint, validCropBounds } from '../src/renderer/src/components/CropSelector';
import { annotationFontSize, layoutAnnotation } from '../src/renderer/src/components/annotation-layout';

describe('original image crop coordinates', () => {
  const bounds = { width: 1200, height: 800 };
  const crop = { x: 100, y: 200, width: 400, height: 300 };
  it('converts fractional display coordinates independently on each axis without assuming device pixel ratio', () => {
    expect(imagePoint({ x: 95.25, y: 87.5 }, { left: 20.25, top: 37.5, width: 300, height: 200 }, bounds)).toEqual({ x: 300, y: 200 });
    expect(imagePoint({ x: 95.25, y: 87.5 }, { left: 20.25, top: 37.5, width: 600, height: 200 }, bounds)).toEqual({ x: 150, y: 200 });
  });
  it('clamps pointers outside the image and rejects hidden/invalid rectangles', () => {
    const rect = { left: 20, top: 30, width: 300, height: 200 };
    expect(imagePoint({ x: -200, y: 900 }, rect, bounds)).toEqual({ x: 0, y: 800 });
    expect(imagePoint({ x: 30, y: 40 }, { ...rect, width: 0 }, bounds)).toBeNull();
    expect(imagePoint({ x: NaN, y: 40 }, rect, bounds)).toBeNull();
    expect(validCropBounds({ width: 0, height: 1 })).toBe(false);
    expect(validCropBounds({ width: 10.5, height: 1 })).toBe(false);
  });
  it('sanitizes incomplete numeric edits into finite integer in-image rectangles only on interaction', () => {
    expect(clampPixelCrop({ x: NaN, y: -5, width: Infinity, height: 900 }, bounds)).toEqual({ x: 0, y: 0, width: 1, height: 800 });
    expect(clampPixelCrop({ x: 1201, y: 800, width: 30, height: 40 }, bounds)).toEqual({ x: 1199, y: 799, width: 1, height: 1 });
    expect(clampPixelCrop({ x: 1.7, y: 3.2, width: 7.6, height: 8.4 }, bounds)).toEqual({ x: 2, y: 3, width: 8, height: 8 });
  });
  it('moves without changing size, including when the pointer reaches all boundaries', () => {
    expect(changePixelCrop(crop, 'move', { x: 10, y: 10 }, { x: 23.6, y: 28.2 }, bounds)).toEqual({ ...crop, x: 114, y: 218 });
    expect(changePixelCrop(crop, 'move', { x: 0, y: 0 }, { x: -1000, y: 9000 }, bounds)).toEqual({ ...crop, x: 0, y: 500 });
  });
  it('draws in either direction, rounds outward, and preserves a one-pixel minimum at the far edge', () => {
    expect(changePixelCrop(crop, 'draw', { x: 400.2, y: 300.7 }, { x: 100.8, y: 90.1 }, bounds)).toEqual({ x: 100, y: 90, width: 301, height: 211 });
    expect(changePixelCrop(crop, 'draw', { x: 1200, y: 800 }, { x: 1200, y: 800 }, bounds)).toEqual({ x: 1199, y: 799, width: 1, height: 1 });
  });
  it.each([
    ['nw', { x: 499, y: 499, width: 1, height: 1 }],
    ['ne', { x: 100, y: 499, width: 1100, height: 1 }],
    ['sw', { x: 499, y: 200, width: 1, height: 600 }],
    ['se', { x: 100, y: 200, width: 1100, height: 600 }],
  ] as const)('keeps the opposite corner fixed and prevents %s from crossing it', (corner, expected) => {
    expect(changePixelCrop(crop, corner, { x: 0, y: 0 }, { x: 5000, y: 5000 }, bounds)).toEqual(expected);
  });
  it('keeps every emitted corner adjustment in bounds', () => {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      for (const delta of [-10000, -0.5, 0, 0.6, 10000]) {
        const result = changePixelCrop(crop, corner, { x: 0, y: 0 }, { x: delta, y: -delta }, bounds);
        expect(Object.values(result).every(Number.isInteger)).toBe(true);
        expect(result.x).toBeGreaterThanOrEqual(0); expect(result.y).toBeGreaterThanOrEqual(0);
        expect(result.width).toBeGreaterThanOrEqual(1); expect(result.height).toBeGreaterThanOrEqual(1);
        expect(result.x + result.width).toBeLessThanOrEqual(bounds.width); expect(result.y + result.height).toBeLessThanOrEqual(bounds.height);
      }
    }
  });
  it('renders the original image and disables controls until that image is loaded', () => {
    const html = renderToStaticMarkup(createElement(CropSelector, { image: { src: 'data:image/png;base64,bG9jYWw=', ...bounds }, crop, onChange: () => {} }));
    expect(html).toContain('Original image for crop selection');
    expect(html).toContain('Draw new crop'); expect(html).toContain('Use whole image'); expect(html).toContain('Move crop');
    expect(html).toContain('Loading the original image'); expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('arrow keys');
  });
});

describe('measured annotation layout', () => {
  // Deliberately non-monospaced measurement catches character-count based wrapping.
  const measure = (text: string) => Array.from(text).reduce((sum, c) => sum + (c === 'W' ? 12 : c === 'i' ? 2 : c === ' ' ? 3 : 6), 0);
  const options = { width: 60, height: 140, fontSize: 10, lineHeight: 14, padding: 5 };
  it('wraps measured words, retaining their text and fitting each line', () => {
    const result = layoutAnnotation({ ...options, text: 'Wide Wi iiiiii final' }, measure);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map(line => line.text)).toEqual(['Wide Wi', 'iiiiii final']);
    expect(result.lines.every(line => measure(line.text) <= 50)).toBe(true);
    expect(result.background.y + result.background.height).toBe(options.height);
    expect(result.lines.at(-1)!.y + result.lineHeight + options.padding).toBe(options.height);
  });
  it('breaks long unspaced tokens without dropping or compressing characters', () => {
    const result = layoutAnnotation({ ...options, text: 'WWWWWWWWWW' }, measure);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map(line => line.text)).toEqual(['WWWW', 'WWWW', 'WW']);
    expect(result.lines.map(line => line.text).join('')).toBe('WWWWWWWWWW');
  });
  it('keeps joined emoji intact when a long token wraps', () => {
    const family = '👩‍👩‍👧‍👦';
    const measuredGraphemes = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length * 20;
    const result = layoutAnnotation({ ...options, text: family.repeat(3) }, measuredGraphemes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines.map(line => line.text)).toEqual([family.repeat(2), family]);
  });
  it('preserves explicit blank and trailing lines and normalizes Windows newlines', () => {
    const result = layoutAnnotation({ ...options, text: 'one\r\n\r\ntwo\n' }, measure);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines.map(line => line.text)).toEqual(['one', '', 'two', '']);
  });
  it('returns too-long when the full wrapped text or explicit newlines exceed the height', () => {
    expect(layoutAnnotation({ ...options, height: 24, text: 'one two three' }, measure)).toMatchObject({ ok: false, code: 'too-long' });
    expect(layoutAnnotation({ ...options, height: 24, text: 'one\n' }, measure)).toMatchObject({ ok: false, code: 'too-long' });
  });
  it('accepts exact fit, rejects a single too-wide glyph, and rejects insufficient single-line height', () => {
    const exact = layoutAnnotation({ ...options, width: 22, height: 24, text: 'W' }, measure);
    expect(exact.ok).toBe(true);
    expect(layoutAnnotation({ ...options, width: 21, text: 'W' }, measure)).toMatchObject({ ok: false, code: 'too-small' });
    expect(layoutAnnotation({ ...options, height: 23, text: 'i' }, measure)).toMatchObject({ ok: false, code: 'too-small' });
  });
  it('rejects invalid measurements and dimensions instead of painting silently clipped text', () => {
    expect(layoutAnnotation({ ...options, text: 'hello' }, () => NaN)).toMatchObject({ ok: false, code: 'too-small' });
    expect(layoutAnnotation({ ...options, text: 'hello', width: Infinity }, measure)).toMatchObject({ ok: false, code: 'too-small' });
    expect(layoutAnnotation({ ...options, text: 'hello', lineHeight: 9 }, measure)).toMatchObject({ ok: false, code: 'too-small' });
  });
  it('enforces the editor length limit explicitly and permits an empty note on tiny crops', () => {
    expect(layoutAnnotation({ ...options, text: 'i'.repeat(301) }, measure)).toMatchObject({ ok: false, code: 'too-long' });
    expect(layoutAnnotation({ width: 1, height: 1, text: '' }, measure)).toMatchObject({ ok: true, lines: [], background: { height: 0 } });
    expect(annotationFontSize(100, 100)).toBe(12); expect(annotationFontSize(1200, 800)).toBe(32);
  });
});
