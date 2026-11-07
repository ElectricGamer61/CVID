// The Cut room's junk finders. Each one turns transcripts into suggestions: a span of words
// (possibly across clips) that could go, why, and the exact cut that would remove it. Nothing
// is cut until the user applies a suggestion; ignored ones are remembered per project.
//
// Pure and deterministic (detect.test.ts). They only see what the speech engine wrote down,
// which is why Studio insists on a verbatim engine: Whisper writes no "um"s to find.

import { cutForWords, pauseCut } from "./snap";
import { isCut, type Range } from "./timeline";
import type { Cut, CutReason, Word } from "./types";

export type SuggestionType = "filler" | "cutoff" | "repeat" | "retake" | "pause" | "dead";

export interface Part {
  clip: string;
  first: number; // word indices in that clip, inclusive; -1 for pure silence
  last: number;
  start: number;
  end: number;
}

export interface Suggestion {
  id: string;
  type: SuggestionType;
  parts: Part[];
  text: string; // what would be removed, for the list
  why: string;
  seconds: number;
}

export interface ClipWords {
  id: string;
  duration: number;
  words: Word[];
  energy: Float32Array | null;
}

export interface DetectOptions {
  pauseMax: number; // shorten silences longer than this...
  pauseKeep: number; // ...down to this much
}

export const DEFAULT_OPTIONS: DetectOptions = { pauseMax: 0.8, pauseKeep: 0.35 };

export const TYPE_INFO: Record<SuggestionType, { label: string; hint: string; reason: CutReason }> = {
  filler: { label: "Filler words", hint: "um, uh, er", reason: "filler" },
  cutoff: { label: "Stumbles", hint: "words you started and dropped", reason: "cutoff" },
  repeat: { label: "Repeated words", hint: "“I I think”", reason: "repeat" },
  retake: { label: "Retakes", hint: "lines you said again; keeps the last take", reason: "retake" },
  pause: { label: "Long pauses", hint: "shortened, not removed", reason: "pause" },
  dead: { label: "Dead air", hint: "before you start and after you stop", reason: "dead" },
};

const FILLERS = new Set(["um", "umm", "uhm", "uh", "uhh", "er", "erm", "ah", "ahh", "hmm", "hm",
  "mhm", "mm", "mmm", "eh"]);
export const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
export const isFiller = (w: Word) => w.kind === "filler" || FILLERS.has(norm(w.word));
const isSpeech = (w: Word) => !isFiller(w) && w.kind !== "event" && w.kind !== "cutoff" && norm(w.word) !== "";

const textOf = (words: Word[], a: number, b: number, max = 14) => {
  const ws = words.slice(a, b + 1).map((w) => w.word);
  return ws.length > max ? ws.slice(0, max).join(" ") + " …" : ws.join(" ");
};

function wordsPart(c: ClipWords, first: number, last: number): Part {
  const [start, end] = cutForWords(c.words, first, last, c.duration, c.energy);
  return { clip: c.id, first, last, start, end };
}

function make(type: SuggestionType, parts: Part[], text: string, why: string): Suggestion {
  const p = parts[0];
  return {
    id: `${type}:${p.clip}:${p.first >= 0 ? p.first : Math.round(p.start * 100)}`,
    type, parts, text, why,
    seconds: parts.reduce((s, x) => s + (x.end - x.start), 0),
  };
}

/** Runs of consecutive words that satisfy `pick`, as [first, last]. */
function runs(words: Word[], pick: (w: Word, i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    if (!pick(words[i], i)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

function fillers(c: ClipWords): Suggestion[] {
  return runs(c.words, isFiller).map(([a, b]) =>
    make("filler", [wordsPart(c, a, b)], textOf(c.words, a, b), "Filler"));
}

function cutoffs(c: ClipWords): Suggestion[] {
  return runs(c.words, (w) => w.kind === "cutoff" || /[a-z]-$/i.test(w.word.trim())).map(([a, b]) =>
    make("cutoff", [wordsPart(c, a, b)], textOf(c.words, a, b),
      b + 1 < c.words.length ? `Dropped before “${c.words[b + 1].word}”` : "Dropped word"));
}

function repeats(c: ClipWords): Suggestion[] {
  const w = c.words;
  // "I I I think": every copy but the last goes. A long pause between the two is a choice
  // ("very... very"), not a stumble, so it doesn't count.
  return runs(w, (x, i) => i + 1 < w.length && isSpeech(x) && norm(x.word) === norm(w[i + 1].word)
    && w[i + 1].start - x.end < 0.6).map(([a, b]) =>
    make("repeat", [wordsPart(c, a, b)], textOf(w, a, b + 1), "Said twice in a row"));
}

function pauses(c: ClipWords, o: DetectOptions): Suggestion[] {
  const out: Suggestion[] = [];
  const w = c.words;
  for (let i = 0; i + 1 < w.length; i++) {
    const gap = w[i + 1].start - w[i].end;
    if (gap <= o.pauseMax) continue;
    const r = pauseCut(w[i], w[i + 1], o.pauseKeep * 0.55, o.pauseKeep * 0.45);
    if (!r) continue;
    out.push({
      id: `pause:${c.id}:${i}`, type: "pause",
      parts: [{ clip: c.id, first: -1, last: -1, start: r[0], end: r[1] }],
      text: `${gap.toFixed(1)}s pause after “${w[i].word}”`, why: `Shortened to ${o.pauseKeep}s`,
      seconds: r[1] - r[0],
    });
  }
  return out;
}

function deadAir(c: ClipWords): Suggestion[] {
  const w = c.words;
  if (!w.length) return [];
  const out: Suggestion[] = [];
  const head = w[0].start - 0.25;
  if (head > 0.4) {
    out.push({ id: `dead:${c.id}:head`, type: "dead", parts: [{ clip: c.id, first: -1, last: -1, start: 0, end: head }],
      text: `${head.toFixed(1)}s before you start`, why: "Start of clip", seconds: head });
  }
  const tail = w[w.length - 1].end + 0.4;
  if (c.duration - tail > 0.5) {
    out.push({ id: `dead:${c.id}:tail`, type: "dead", parts: [{ clip: c.id, first: -1, last: -1, start: tail, end: c.duration }],
      text: `${(c.duration - tail).toFixed(1)}s after you stop`, why: "End of clip", seconds: c.duration - tail });
  }
  return out;
}

// ---------------------------------------------------------------- retakes

interface Phrase { clip: number; first: number; last: number; tokens: string[] }

/** Sentences, or runs of speech between pauses, over the whole timeline. Never across clips. */
export function phrases(clips: ClipWords[]): Phrase[] {
  const out: Phrase[] = [];
  clips.forEach((c, ci) => {
    let cur: Phrase | null = null;
    c.words.forEach((w, i) => {
      if (cur && i > 0 && w.start - c.words[i - 1].end > 0.7) { out.push(cur); cur = null; }
      if (!cur) cur = { clip: ci, first: i, last: i, tokens: [] };
      cur.last = i;
      if (isSpeech(w)) cur.tokens.push(norm(w.word));
      if (/[.!?]["')\]]*$/.test(w.word.trim())) { out.push(cur); cur = null; }
    });
    if (cur) out.push(cur);
  });
  return out.filter((p) => p.tokens.length > 0);
}

function lcs(a: string[], b: string[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Does phrase `b` say phrase `a` again (from its start)? */
export function isRetakeOf(a: string[], b: string[]): boolean {
  if (a.length < 2 || b.length < Math.ceil(a.length * 0.6)) return false;
  // Both must open the same way. Four words, not three, because a failed take often starts
  // with a run-up the clean one drops ("Okay so the gym..." -> "The gym...").
  const head = Math.min(4, a.length);
  if (lcs(a.slice(0, head), b.slice(0, head)) < Math.min(2, head)) return false;
  return lcs(a, b.slice(0, a.length + 3)) / a.length >= 0.6;
}

function retakes(clips: ClipWords[]): Suggestion[] {
  const ps = phrases(clips);
  const out: Suggestion[] = [];
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 3, ps.length - 1); j++) {
      // Whatever sits between the take and its retake must be an aside ("sorry, again"),
      // never real content, or a repeated phrase later on would eat everything in between.
      const between = ps.slice(i + 1, j);
      if (between.some((p) => p.tokens.length > 6)) break;
      if (!isRetakeOf(ps[i].tokens, ps[j].tokens)) continue;
      const parts: Part[] = [];
      for (let k = i; k < j; k++) {
        const p = ps[k], c = clips[p.clip];
        const prev = parts[parts.length - 1];
        if (prev && prev.clip === c.id) parts[parts.length - 1] = wordsPart(c, prev.first, p.last);
        else parts.push(wordsPart(c, p.first, p.last));
      }
      const byId = new Map(clips.map((c) => [c.id, c]));
      const cj = clips[ps[j].clip];
      out.push(make("retake", parts,
        parts.map((p) => textOf(byId.get(p.clip)!.words, p.first, p.last)).join(" … "),
        `You said it again: “${textOf(cj.words, ps[j].first, ps[j].last, 8)}”`));
      i = j - 1; // the retake itself may be retaken again; carry on from it
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- all together

/** Every suggestion, minus the ones already cut or ignored. */
export function detect(clips: ClipWords[], cuts: Cut[], ignored: Set<string>,
                       options: DetectOptions = DEFAULT_OPTIONS): Suggestion[] {
  const all: Suggestion[] = [];
  for (const c of clips) {
    all.push(...fillers(c), ...cutoffs(c), ...repeats(c), ...pauses(c, options), ...deadAir(c));
  }
  all.push(...retakes(clips));

  const ranges = new Map<string, Range[]>();
  const cutRanges = (id: string) => {
    if (!ranges.has(id)) ranges.set(id, cuts.filter((c) => c.clip === id).map((c) => [c.start, c.end] as Range));
    return ranges.get(id)!;
  };
  const done = (s: Suggestion) => s.parts.every((p) => isCut(cutRanges(p.clip), p.start, p.end));
  return all.filter((s) => !ignored.has(s.id) && !done(s));
}

export function cutsFor(s: Suggestion): Cut[] {
  return s.parts.map((p) => ({ clip: p.clip, start: p.start, end: p.end, reason: TYPE_INFO[s.type].reason }));
}
