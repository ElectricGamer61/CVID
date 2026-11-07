// The edited timeline: what survives the cuts, and the two clocks Studio lives on.
//
// "Source time" is a position inside one clip. "Edited time" is a position in the finished
// video, after every cut and with the clips laid end to end. Pure functions, mirrored by
// backend/app/studio/export.py (kept_segments) so the preview plays exactly what exports.

import type { Cut } from "./types";

export type Range = [number, number];

export interface Segment {
  clip: string;
  start: number; // source time
  end: number;
  offset: number; // edited time at which this piece begins
}

export interface ClipSpan {
  id: string;
  duration: number;
}

/** Sorted, overlap-free ranges. Touching ranges merge too. */
export function mergeRanges(ranges: Range[]): Range[] {
  const all = ranges.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Range[] = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Cuts of one clip, clamped to the clip and merged. */
export function clipCutRanges(cuts: Cut[], clip: ClipSpan): Range[] {
  return mergeRanges(
    cuts
      .filter((c) => c.clip === clip.id)
      .map((c) => [Math.max(0, c.start), Math.min(clip.duration, c.end)] as Range),
  );
}

/** What survives, in timeline order. Pieces shorter than `minLen` (a frame) are dropped,
 *  exactly as the export drops them. */
export function keptSegments(clips: ClipSpan[], cuts: Cut[], minLen = 1 / 30): Segment[] {
  const out: Segment[] = [];
  let offset = 0;
  for (const c of clips) {
    if (!(c.duration > 0)) continue;
    let t = 0;
    const push = (a: number, b: number) => {
      if (b - a >= minLen) {
        out.push({ clip: c.id, start: a, end: b, offset });
        offset += b - a;
      }
    };
    for (const [a, b] of clipCutRanges(cuts, c)) {
      push(t, a);
      t = Math.max(t, b);
    }
    push(t, c.duration);
  }
  return out;
}

export const editedDuration = (segs: Segment[]) =>
  segs.length ? segs[segs.length - 1].offset + (segs[segs.length - 1].end - segs[segs.length - 1].start) : 0;

/** Index of the segment playing at edited time t (clamped to the ends). */
export function segmentAt(segs: Segment[], t: number): number {
  let lo = 0, hi = segs.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].offset <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Edited time -> where that is in which clip. */
export function toSource(segs: Segment[], t: number): { seg: number; clip: string; time: number } | null {
  const i = segmentAt(segs, t);
  if (i < 0) return null;
  const s = segs[i];
  return { seg: i, clip: s.clip, time: Math.min(s.end, Math.max(s.start, s.start + (t - s.offset))) };
}

/** Source time -> edited time. A time inside a cut maps to where the cut closes, so seeking
 *  to a removed word lands on the first thing you will actually hear after it. */
export function toEdited(segs: Segment[], clip: string, time: number): number | null {
  let after: number | null = null;
  for (const s of segs) {
    if (s.clip !== clip) continue;
    if (time >= s.start && time < s.end) return s.offset + (time - s.start);
    if (s.start >= time && after === null) after = s.offset;
  }
  return after;
}

/** Is [a, b] of this clip fully inside a cut? (The midpoint test keeps a word that a cut
 *  only grazes at its edge from looking removed.) */
export function isCut(ranges: Range[], a: number, b: number): boolean {
  const mid = (a + b) / 2;
  return ranges.some(([x, y]) => mid >= x && mid < y);
}

/** Remove [a, b] from a clip's cuts (restore), splitting any cut that straddles it.
 *  A leftover shorter than `minPiece` is dropped: cut edges are snapped a few ms past word
 *  edges, so restoring words used to leave 5 ms slivers that silently split the clip. */
export function subtractRange(cuts: Cut[], clip: string, a: number, b: number, minPiece = 0.06): Cut[] {
  const out: Cut[] = [];
  for (const c of cuts) {
    if (c.clip !== clip || c.end <= a || c.start >= b) {
      out.push(c);
      continue;
    }
    if (a - c.start >= minPiece) out.push({ ...c, end: a });
    if (c.end - b >= minPiece) out.push({ ...c, start: b });
  }
  return out;
}

/** A length for people: "4.2s" under a minute, "3:05" above. */
export const formatLength = (s: number) => (s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : formatTime(s));

export function formatTime(t: number, withTenths = false): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = withTenths ? sec.toFixed(1).padStart(4, "0") : Math.floor(sec).toString().padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
