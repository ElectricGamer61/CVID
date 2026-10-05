// Automatic clean-up cuts: filler words and long pauses, expressed as the same
// [start, end] source-time cut ranges the editor's Cut tool already uses. Pure functions,
// unit-tested in cleanup.test.ts; the render path (kept_segments + remap_words_for_cuts)
// needs nothing new - a filler cut is just a very small cut.
import type { Word } from "./captionStyles";

export type Range = [number, number];

/** Disfluencies that carry no meaning. Deliberately NOT "like", "so", "you know": those are
 *  real words far more often than they are fillers, and cutting them mangles sentences. */
export const FILLER_WORDS = new Set([
  "um", "umm", "uhm", "uh", "uhh", "er", "erm", "ah", "ahh", "hmm", "hm", "mhm", "mm", "mmm",
]);

export const normalizeWord = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");

const inRange = (w: Word, start: number, end: number) => w.end > start && w.start < end;

/** One cut per filler word inside [start, end], padded slightly so the audio edge is clean. */
export function fillerRanges(words: Word[], start: number, end: number, pad = 0.03): Range[] {
  const out: Range[] = [];
  for (const w of words) {
    if (!inRange(w, start, end)) continue;
    if (!FILLER_WORDS.has(normalizeWord(w.word))) continue;
    const a = Math.max(start, w.start - pad), b = Math.min(end, w.end + pad);
    if (b - a >= 0.05) out.push([a, b]);
  }
  return mergeRanges(out, []);
}

/** Cuts for silences longer than `minGap` between consecutive words, keeping `keep` seconds
 *  of breath on each side so speech never slams together. */
export function pauseRanges(words: Word[], start: number, end: number, minGap = 1.0, keep = 0.15): Range[] {
  const ws = words.filter((w) => inRange(w, start, end)).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (let i = 0; i + 1 < ws.length; i++) {
    const gap = ws[i + 1].start - ws[i].end;
    if (gap <= minGap) continue;
    const a = ws[i].end + keep, b = ws[i + 1].start - keep;
    if (b - a >= 0.2) out.push([Math.max(start, a), Math.min(end, b)]);
  }
  return mergeRanges(out, []);
}

/** Union of two cut lists: sorted, overlapping or touching ranges merged. */
export function mergeRanges(a: Range[], b: Range[]): Range[] {
  const all = [...a, ...b].filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  const out: Range[] = [];
  for (const [x, y] of all) {
    const last = out[out.length - 1];
    if (last && x <= last[1] + 0.001) last[1] = Math.max(last[1], y);
    else out.push([x, y]);
  }
  return out;
}

/** Ranges in `found` not already covered by `existing` (so counts say what is left to do). */
export function newRanges(existing: Range[], found: Range[]): Range[] {
  return found.filter(([a, b]) => !existing.some(([x, y]) => x <= a + 0.001 && y >= b - 0.001));
}

export const totalSeconds = (r: Range[]) => r.reduce((s, [a, b]) => s + (b - a), 0);
