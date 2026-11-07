// Where exactly a cut goes. Speech engines place word edges 30-100 ms off (the 2026-11-06
// bake-off measured every engine clipping speech at a boundary some of the time), so a cut
// placed on the engine's word edge chops the first consonant of the next word or the tail
// of the last one. Instead every cut edge moves to the quietest 10 ms nearby, measured on
// the clip's own audio (energy.bin: one dB value per 10 ms).

import type { Word } from "./types";
import type { Range } from "./timeline";

export const FRAME = 0.01;

/** energy.bin bytes -> dB per 10 ms. */
export function decodeEnergy(buf: ArrayBuffer): Float32Array {
  const b = new Uint8Array(buf);
  const out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i] - 100;
  return out;
}

/** The quietest moment in [lo, hi] (seconds). Near-ties (within 3 dB) go to the one
 *  closest to `prefer`, so in true silence the cut stays where the words said it should. */
export function quietest(energy: Float32Array | null, lo: number, hi: number, prefer: number): number {
  if (!energy || !energy.length || hi <= lo) return prefer;
  const a = Math.max(0, Math.floor(lo / FRAME));
  const b = Math.min(energy.length - 1, Math.ceil(hi / FRAME) - 1);
  if (b < a) return prefer;
  let min = Infinity;
  for (let i = a; i <= b; i++) min = Math.min(min, energy[i]);
  let best = prefer, bestDist = Infinity;
  for (let i = a; i <= b; i++) {
    if (energy[i] > min + 3) continue;
    const t = (i + 0.5) * FRAME;
    const d = Math.abs(t - prefer);
    if (d < bestDist) { best = t; bestDist = d; }
  }
  return Math.min(hi, Math.max(lo, best));
}

/** The cut that removes words[i..j] of one clip.
 *
 *  Deleting words keeps the pause BEFORE them and removes the pause after, so the sentence
 *  closes up with one natural gap rather than two. Deleting the first words of a clip also
 *  takes the silence before them; deleting the last ones runs to the clip's end. Both edges
 *  then snap to the quietest point nearby, never past the neighbouring kept words. */
export function cutForWords(words: Word[], i: number, j: number, duration: number,
                            energy: Float32Array | null): Range {
  const prev = i > 0 ? words[i - 1] : null;
  const next = j + 1 < words.length ? words[j + 1] : null;

  // Engines put word edges up to ~50 ms off, and in fluent speech one word's end IS the
  // next one's start, which leaves no room at all if the search stops at the edges. So each
  // edge may look EDGE ms into the neighbouring words for the valley between them; the
  // quietest-point rule keeps it out of their sound. (Measured on a real talk: "syrup. So"
  // touch, and the cut landed at -16 dB, mid-sound, until the search could reach the -25 dB
  // valley 20 ms away.)
  const EDGE = 0.045;
  let start: number;
  if (!prev) start = 0;
  else {
    const lo = Math.max(prev.end - EDGE, words[i].start - 0.12);
    start = quietest(energy, lo, words[i].start + EDGE, words[i].start);
  }

  let end: number;
  if (!next) end = duration;
  else {
    // Resume just before the next word. Its engine start may be late, so look back across
    // the gap for the silence before its first sound.
    const lo = Math.max(words[j].end - EDGE, next.start - 0.15);
    end = quietest(energy, lo, next.start + EDGE * 0.5, next.start - 0.03);
  }
  return [Math.max(0, start), Math.min(duration, Math.max(end, start))];
}

/** The part of the silence between two words to remove, keeping a breath on each side. */
export function pauseCut(a: Word, b: Word, keepBefore: number, keepAfter: number): Range | null {
  const x = a.end + keepBefore, y = b.start - keepAfter;
  return y - x >= 0.1 ? [x, y] : null;
}
