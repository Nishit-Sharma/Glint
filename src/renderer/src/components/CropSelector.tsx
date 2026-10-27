import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './crop-selector.css';

export interface PixelCrop { x: number; y: number; width: number; height: number }
export interface CropImage { src: string; width: number; height: number }
export interface CropSelectorProps { image: CropImage; crop: PixelCrop; onChange: (crop: PixelCrop) => void; disabled?: boolean }
type Point = { x: number; y: number };
type Bounds = { width: number; height: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Operation = Corner | 'move' | 'draw';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const whole = (value: number, fallback: number) => Number.isFinite(value) ? Math.round(value) : fallback;

export function validCropBounds(bounds: Bounds): boolean {
  return Number.isSafeInteger(bounds.width) && Number.isSafeInteger(bounds.height) && bounds.width > 0 && bounds.height > 0;
}

/** All emitted coordinates are integer original-image pixels, with a one-pixel minimum. */
export function clampPixelCrop(crop: PixelCrop, bounds: Bounds): PixelCrop {
  const width = Math.max(1, whole(bounds.width, 1)), height = Math.max(1, whole(bounds.height, 1));
  const x = clamp(whole(crop.x, 0), 0, width - 1), y = clamp(whole(crop.y, 0), 0, height - 1);
  return { x, y, width: clamp(whole(crop.width, 1), 1, width - x), height: clamp(whole(crop.height, 1), 1, height - y) };
}

/** rect must be the image element's content rectangle, not a letterboxed container. */
export function imagePoint(client: Point, rect: { left: number; top: number; width: number; height: number }, bounds: Bounds): Point | null {
  if (!validCropBounds(bounds) || ![client.x, client.y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return { x: clamp((client.x - rect.left) * bounds.width / rect.width, 0, bounds.width), y: clamp((client.y - rect.top) * bounds.height / rect.height, 0, bounds.height) };
}

export function changePixelCrop(crop: PixelCrop, operation: Operation, start: Point, point: Point, bounds: Bounds): PixelCrop {
  const current = clampPixelCrop(crop, bounds);
  const dx = Math.round(point.x - start.x), dy = Math.round(point.y - start.y);
  if (operation === 'move') return { ...current, x: clamp(current.x + dx, 0, bounds.width - current.width), y: clamp(current.y + dy, 0, bounds.height - current.height) };
  if (operation === 'draw') {
    const left = Math.floor(Math.min(start.x, point.x)), top = Math.floor(Math.min(start.y, point.y));
    return clampPixelCrop({ x: left, y: top, width: Math.ceil(Math.max(start.x, point.x)) - left, height: Math.ceil(Math.max(start.y, point.y)) - top }, bounds);
  }
  const left = operation.includes('w') ? clamp(current.x + dx, 0, current.x + current.width - 1) : current.x;
  const top = operation.includes('n') ? clamp(current.y + dy, 0, current.y + current.height - 1) : current.y;
  const right = operation.includes('e') ? clamp(current.x + current.width + dx, current.x + 1, bounds.width) : current.x + current.width;
  const bottom = operation.includes('s') ? clamp(current.y + current.height + dy, current.y + 1, bounds.height) : current.y + current.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const corners: { key: Corner; label: string; left: string; top: string }[] = [
  { key: 'nw', label: 'top left', left: '0%', top: '0%' }, { key: 'ne', label: 'top right', left: '100%', top: '0%' },
  { key: 'sw', label: 'bottom left', left: '0%', top: '100%' }, { key: 'se', label: 'bottom right', left: '100%', top: '100%' },
];

/** Remounting the interaction owner invalidates captured pointers before a new image is usable. */
export function CropSelector(props: CropSelectorProps) {
  return <CropInteraction key={JSON.stringify([props.image.src, props.image.width, props.image.height])} {...props} />;
}

function CropInteraction({ image, crop, onChange, disabled = false }: CropSelectorProps) {
  const imageRef = useRef<HTMLImageElement>(null), stageRef = useRef<HTMLDivElement>(null);
  const live = useRef(false), drag = useRef<{ pointerId: number; operation: Operation; start: Point; crop: PixelCrop } | null>(null);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false), [drawing, setDrawing] = useState(false);
  const helpId = useId(), statusId = useId();
  const boundsValid = validCropBounds(image), selected = clampPixelCrop(crop, image);
  const inactive = disabled || !loaded || failed || !boundsValid;
  const stop = () => {
    const pointer = drag.current; drag.current = null;
    if (pointer && stageRef.current?.hasPointerCapture(pointer.pointerId)) stageRef.current.releasePointerCapture(pointer.pointerId);
  };
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; stop(); }; }, []);
  useLayoutEffect(() => { if (inactive) { stop(); setDrawing(false); } }, [inactive]);
  const pointAt = (event: PointerEvent) => imageRef.current ? imagePoint({ x: event.clientX, y: event.clientY }, imageRef.current.getBoundingClientRect(), image) : null;
  const begin = (event: PointerEvent, operation: Operation) => {
    if (inactive || !live.current || event.button !== 0 || !event.isPrimary || drag.current) return;
    const point = pointAt(event); if (!point) return;
    event.preventDefault(); event.stopPropagation();
    if (event.currentTarget instanceof HTMLButtonElement) event.currentTarget.focus();
    else stageRef.current?.focus();
    drag.current = { pointerId: event.pointerId, operation: drawing ? 'draw' : operation, start: point, crop: selected };
    stageRef.current?.setPointerCapture(event.pointerId);
    if (drawing || operation === 'draw') onChange(changePixelCrop(selected, 'draw', point, point, image));
  };
  const move = (event: PointerEvent) => {
    const session = drag.current;
    if (inactive || !live.current || !session || session.pointerId !== event.pointerId) return;
    const point = pointAt(event); if (point) onChange(changePixelCrop(session.crop, session.operation, session.start, point, image));
  };
  const keys = (event: KeyboardEvent, operation: Operation) => {
    if (event.key === 'Escape') {
      if (drag.current && !inactive) onChange(drag.current.crop);
      stop(); setDrawing(false); event.preventDefault(); return;
    }
    if (inactive || !live.current || event.altKey || event.ctrlKey || event.metaKey) return;
    const amount = event.shiftKey ? 10 : 1;
    const directions: Record<string, Point> = { ArrowLeft: { x: -amount, y: 0 }, ArrowRight: { x: amount, y: 0 }, ArrowUp: { x: 0, y: -amount }, ArrowDown: { x: 0, y: amount } };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault(); stop(); onChange(changePixelCrop(selected, operation, { x: 0, y: 0 }, delta, image));
  };
  if (!boundsValid) return <p className="crop-selector-status" role="status">The original image dimensions are unavailable.</p>;
  return <div className="crop-selector" role="group" aria-label="Crop original image">
    <div className="crop-selector-actions">
      <button type="button" disabled={inactive} aria-pressed={drawing} onClick={() => { stop(); setDrawing(!drawing); }}>{drawing ? 'Cancel new crop' : 'Draw new crop'}</button>
      <button type="button" disabled={inactive} onClick={() => { stop(); setDrawing(false); onChange({ x: 0, y: 0, width: image.width, height: image.height }); }}>Use whole image</button>
      <button type="button" disabled={inactive} aria-describedby={helpId} onKeyDown={event => keys(event, 'move')} onClick={() => imageRef.current?.parentElement?.querySelector<HTMLButtonElement>('.crop-selector-move')?.focus()}>Move crop</button>
    </div>
    <p id={helpId} className="crop-selector-help">{drawing ? 'Drag across the image to draw a new crop.' : 'Drag the selection to move it, or drag a corner to resize.'} Focus Move crop or a corner and use arrow keys; hold Shift for 10 pixels. Escape cancels a drag.</p>
    <div className="crop-selector-frame">
      <div ref={stageRef} tabIndex={-1} className={`crop-selector-stage${drawing ? ' is-drawing' : ''}`} style={{ width: `min(100%, ${360 * image.width / image.height}px)` }}
        onPointerDown={event => begin(event, 'draw')} onPointerMove={move}
        onPointerUp={event => { if (drag.current?.pointerId !== event.pointerId) return; move(event); stop(); setDrawing(false); }}
        onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) { stop(); setDrawing(false); } }}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; setDrawing(false); } }}
        onKeyDown={event => { if (event.key === 'Escape') keys(event, 'move'); }}>
        <img ref={imageRef} src={image.src} alt="Original image for crop selection" width={image.width} height={image.height} draggable={false}
          onLoad={event => { const matches = event.currentTarget.naturalWidth === image.width && event.currentTarget.naturalHeight === image.height; setLoaded(matches); setFailed(!matches); }}
          onError={() => { stop(); setFailed(true); setLoaded(false); }} />
        {loaded && !failed && <div className="crop-selector-selection" style={{ left: `${selected.x / image.width * 100}%`, top: `${selected.y / image.height * 100}%`, width: `${selected.width / image.width * 100}%`, height: `${selected.height / image.height * 100}%` }}>
          <button type="button" className="crop-selector-move" disabled={inactive} aria-label="Move crop selection" aria-describedby={`${helpId} ${statusId}`} onPointerDown={event => begin(event, 'move')} onKeyDown={event => keys(event, 'move')} />
          {corners.map(corner => <button key={corner.key} type="button" className={`crop-selector-handle crop-selector-${corner.key}`} style={{ left: corner.left, top: corner.top }} disabled={inactive} aria-label={`Resize crop ${corner.label} corner`} aria-describedby={helpId} onPointerDown={event => begin(event, corner.key)} onKeyDown={event => keys(event, corner.key)} />)}
        </div>}
      </div>
    </div>
    <p id={statusId} className="crop-selector-status" aria-live="polite">{failed ? 'The original image could not be loaded at its expected size.' : !loaded ? 'Loading the original image…' : `${selected.width} × ${selected.height} pixels · Left ${selected.x}, top ${selected.y}`}</p>
  </div>;
}
