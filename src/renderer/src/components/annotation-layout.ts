export interface AnnotationLayoutOptions {
  text: string;
  width: number;
  height: number;
  fontSize?: number;
  padding?: number;
  lineHeight?: number;
  maxLength?: number;
}

export type AnnotationLayout = {
  ok: true;
  fontSize: number;
  lineHeight: number;
  /** Draw with textBaseline='top', textAlign='left', and no fillText maxWidth. */
  lines: { text: string; x: number; y: number }[];
  background: { x: number; y: number; width: number; height: number };
} | { ok: false; code: 'too-small' | 'too-long'; message: string };

/** Set this size on the canvas before passing ctx.measureText to layoutAnnotation. */
export function annotationFontSize(width: number, height: number): number {
  return Math.max(12, Math.round(Math.min(width, height) * .04));
}

/** Pure layout: no DOM, drawing, resizing, truncation, or horizontal text compression. */
export function layoutAnnotation(options: AnnotationLayoutOptions, measureText: (text: string) => number): AnnotationLayout {
  const { text, width, height } = options;
  const fontSize = options.fontSize ?? annotationFontSize(width, height);
  const padding = options.padding ?? Math.max(6, Math.round(fontSize * .65));
  const lineHeight = options.lineHeight ?? Math.ceil(fontSize * 1.4);
  const maxLength = options.maxLength ?? 300;
  const small = (): AnnotationLayout => ({ ok: false, code: 'too-small', message: 'This crop is too small for the annotation. Enlarge the crop or remove the note.' });
  const long = (): AnnotationLayout => ({ ok: false, code: 'too-long', message: 'The annotation does not fit. Shorten the note or enlarge the crop.' });
  if (![width, height, fontSize, padding, lineHeight].every(Number.isFinite) || width <= 0 || height <= 0 || fontSize <= 0 || padding < 0 || lineHeight < fontSize) return small();
  if (!Number.isSafeInteger(maxLength) || maxLength < 0 || text.length > maxLength) return long();
  if (text === '') return { ok: true, fontSize, lineHeight, lines: [], background: { x: 0, y: height, width, height: 0 } };
  const availableWidth = width - padding * 2;
  const maxLines = Math.floor((height - padding * 2) / lineHeight);
  if (availableWidth <= 0 || maxLines < 1) return small();
  const fits = (value: string) => {
    const measured = measureText(value);
    return Number.isFinite(measured) && measured >= 0 && measured <= availableWidth;
  };
  const lines: string[] = [];
  // Preserve paragraph breaks (including empty/trailing lines), collapse horizontal whitespace.
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    const words = paragraph.trim().split(/[^\S\n]+/u).filter(Boolean);
    for (const word of words) {
      if (fits(line ? `${line} ${word}` : word)) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      // A URL or other unbroken token wraps at grapheme boundaries, never within an emoji.
      const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
      for (const { segment } of segments) {
        if (!fits(segment)) return small();
        if (line && !fits(line + segment)) { lines.push(line); line = ''; }
        line += segment;
        if (lines.length >= maxLines) return long();
      }
    }
    lines.push(line);
    if (lines.length > maxLines) return long();
  }
  const backgroundHeight = lines.length * lineHeight + padding * 2;
  const top = height - backgroundHeight;
  return {
    ok: true, fontSize, lineHeight,
    lines: lines.map((line, index) => ({ text: line, x: padding, y: top + padding + index * lineHeight })),
    background: { x: 0, y: top, width, height: backgroundHeight },
  };
}
