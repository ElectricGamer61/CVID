// Per-shot automatic framing, as stored on a clip (crop_track_json) and produced by the
// backend's reframe.detect_track: the crop moves only at camera cuts. The editor previews
// the same positions the export burns (reframe.track_center_at mirrors centerAt).
export interface CropTrack {
  start: number;
  end: number;
  shots: { start: number; center: number }[];
}

export function parseTrack(json: string | null | undefined): CropTrack | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json);
    return t && Array.isArray(t.shots) && t.shots.length ? (t as CropTrack) : null;
  } catch {
    return null;
  }
}

/** The crop center (0..1) at source time `t`: the last shot that started at or before it. */
export function centerAt(track: CropTrack | null, t: number, fallback = 0.5): number {
  const shots = track?.shots ?? [];
  if (!shots.length) return fallback;
  let center = shots[0].center;
  for (const sh of shots) {
    if (t >= sh.start - 1e-6) center = sh.center;
    else break;
  }
  return center;
}

/** The track applies only while the crop is still automatic: once the user drags the crop
 *  away from the position the track was stored with, their position wins (and the backend
 *  drops the track on the next save). */
export function previewCenter(track: CropTrack | null, trackBase: number, docCenter: number, t: number): number {
  return track && Math.abs(docCenter - trackBase) < 1e-4 ? centerAt(track, t, docCenter) : docCenter;
}

/** The CSS `object-position` x (percent) that shows the SAME window the export crops.
 *
 *  The export centres a crop of width r (as a fraction of the source width) on `center` and
 *  clamps it inside the frame (reframe.crop_filter). CSS `object-position: p%` instead puts
 *  p% of the overflow on the left, so p must be (center - r/2) / (1 - r), clamped - using
 *  the raw center as the percentage only agreed at dead centre, and drifted by up to ~15%
 *  of the frame toward the edges. */
export function objectPositionFor(center: number, sourceAspect: number, targetAspect = 9 / 16): number {
  const r = sourceAspect > 0 ? Math.min(1, targetAspect / sourceAspect) : 1;
  if (r >= 1) return 50;
  const p = (center - r / 2) / (1 - r);
  return Math.max(0, Math.min(1, p)) * 100;
}

/** "9:16" -> 0.5625 (falls back to 9:16). */
export function aspectValue(aspect: string | undefined): number {
  const [a, b] = String(aspect || "9:16").split(":").map(Number);
  return a > 0 && b > 0 ? a / b : 9 / 16;
}
