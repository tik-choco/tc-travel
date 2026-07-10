export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PinchMetrics {
  distance: number;
  center: Point;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2;
export const PAN_ACTIVE_SCALE = 1.02;
export const WHEEL_ZOOM_OUT = 0.88;
export const WHEEL_ZOOM_IN = 1.14;

export const ZOOM_IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamps scale to [MIN_SCALE, MAX_SCALE] and pan offsets so the image can't be
 *  dragged past its own edges, relative to the given container size. Snaps
 *  back to identity once the scale is effectively 1x. */
export function clampZoom(zoom: ZoomState, containerWidth: number, containerHeight: number): ZoomState {
  const scale = clamp(zoom.scale, MIN_SCALE, MAX_SCALE);
  if (scale <= PAN_ACTIVE_SCALE) return ZOOM_IDENTITY;
  const maxX = ((scale - 1) * containerWidth) / 2;
  const maxY = ((scale - 1) * containerHeight) / 2;
  return {
    scale,
    x: clamp(zoom.x, -maxX, maxX),
    y: clamp(zoom.y, -maxY, maxY),
  };
}

export function pinchMetrics(touches: TouchList): PinchMetrics | null {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  const dx = second.clientX - first.clientX;
  const dy = second.clientY - first.clientY;
  return {
    distance: Math.max(1, Math.hypot(dx, dy)),
    center: { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 },
  };
}

/** Computes the next zoom state for a "zoom toward a screen point" gesture
 *  (wheel zoom, double-tap/double-click toggle): keeps the point under the
 *  cursor/finger stationary on screen as scale changes. `rect` is the
 *  bounding box of the element the transform is applied within. */
export function zoomTowardPoint(
  current: ZoomState,
  nextScale: number,
  point: Point,
  rect: { left: number; top: number; width: number; height: number },
): ZoomState {
  const offsetX = point.x - (rect.left + rect.width / 2);
  const offsetY = point.y - (rect.top + rect.height / 2);
  const ratio = nextScale / current.scale;
  return clampZoom(
    {
      scale: nextScale,
      x: offsetX - (offsetX - current.x) * ratio,
      y: offsetY - (offsetY - current.y) * ratio,
    },
    rect.width,
    rect.height,
  );
}
