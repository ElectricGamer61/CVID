import { describe, expect, it } from "vitest";
import { cutsFor, detect, isRetakeOf, phrases, type ClipWords } from "./detect";
import { cutForWords, quietest } from "./snap";
import {
  editedDuration, keptSegments, mergeRanges, subtractRange, toEdited, toSource,
} from "./timeline";
import type { Cut, Word } from "./types";

// Words at a steady pace: each `dur` long with `gap` of silence between.
function say(text: string, start = 0, dur = 0.3, gap = 0.1): Word[] {
  let t = start;
  return text.split(" ").map((raw) => {
    const [word, kind] = raw.split("|") as [string, Word["kind"]];
    const w: Word = { start: t, end: t + dur, word, ...(kind ? { kind } : {}) };
    t += dur + gap;
    return w;
  });
}

// Loudness: speech (-20 dB) inside words, silence (-80 dB) between them.
function energyFor(words: Word[], duration: number): Float32Array {
  const e = new Float32Array(Math.ceil(duration / 0.01)).fill(-80);
  for (const w of words) for (let i = Math.floor(w.start / 0.01); i < Math.ceil(w.end / 0.01); i++) e[i] = -20;
  return e;
}

const clip = (id: string, words: Word[], duration?: number, withEnergy = true): ClipWords => {
  const d = duration ?? (words.length ? words[words.length - 1].end + 0.5 : 5);
  return { id, duration: d, words, energy: withEnergy ? energyFor(words, d) : null };
};

describe("timeline", () => {
  const clips = [{ id: "a", duration: 10 }, { id: "b", duration: 5 }];
  const cuts: Cut[] = [
    { clip: "a", start: 2, end: 3, reason: "manual" },
    { clip: "a", start: 2.5, end: 4, reason: "manual" }, // overlaps the first
    { clip: "b", start: 0, end: 1, reason: "manual" },
  ];

  it("merges overlapping and touching ranges", () => {
    expect(mergeRanges([[3, 4], [1, 2], [2, 2.5], [5, 5]])).toEqual([[1, 2.5], [3, 4]]);
  });

  it("keeps what the cuts leave, in timeline order, with edited offsets", () => {
    const segs = keptSegments(clips, cuts);
    expect(segs.map((s) => [s.clip, s.start, s.end, s.offset])).toEqual([
      ["a", 0, 2, 0], ["a", 4, 10, 2], ["b", 1, 5, 8],
    ]);
    expect(editedDuration(segs)).toBe(12);
  });

  it("maps between source and edited time both ways", () => {
    const segs = keptSegments(clips, cuts);
    expect(toEdited(segs, "a", 5)).toBe(3);
    expect(toEdited(segs, "a", 2.5)).toBe(2); // inside a cut: lands where the cut closes
    expect(toEdited(segs, "b", 2)).toBe(9);
    expect(toSource(segs, 9)).toEqual({ seg: 2, clip: "b", time: 2 });
    expect(toSource(segs, 0.5)).toEqual({ seg: 0, clip: "a", time: 0.5 });
  });

  it("drops pieces shorter than a frame, like the export", () => {
    const segs = keptSegments([{ id: "a", duration: 3 }],
      [{ clip: "a", start: 0, end: 1, reason: "x" }, { clip: "a", start: 1.01, end: 3, reason: "x" }]);
    expect(segs).toEqual([]);
  });

  it("restoring leaves no sliver of a snapped cut behind", () => {
    // The cut ran 5 ms past the next word's start (snapping); restoring up to that word's
    // start must not leave a 5 ms cut that splits the clip in two.
    expect(subtractRange([{ clip: "a", start: 17.375, end: 18.445, reason: "manual" }], "a", 16.82, 18.44)).toEqual([]);
  });

  it("restoring splits a cut around the restored part", () => {
    const out = subtractRange([{ clip: "a", start: 1, end: 5, reason: "retake" }], "a", 2, 3);
    expect(out).toEqual([
      { clip: "a", start: 1, end: 2, reason: "retake" },
      { clip: "a", start: 3, end: 5, reason: "retake" },
    ]);
  });
});

describe("cut placement", () => {
  it("finds the quietest moment, and stays put in flat silence", () => {
    const e = new Float32Array(100).fill(-80);
    e[40] = -20; e[41] = -20; e[45] = -90;
    expect(quietest(e, 0.4, 0.5, 0.42)).toBeCloseTo(0.455, 3);
    expect(quietest(new Float32Array(100).fill(-80), 0.1, 0.3, 0.2)).toBeCloseTo(0.2, 1);
  });

  it("deleting words keeps the pause before and closes the pause after", () => {
    const w = say("one two three four"); // one 0-.3, two .4-.7, three .8-1.1, four 1.2-1.5
    const [a, b] = cutForWords(w, 1, 2, 2, energyFor(w, 2));
    expect(a).toBeGreaterThanOrEqual(0.3); // never into "one"
    expect(a).toBeLessThanOrEqual(0.42);
    expect(b).toBeGreaterThanOrEqual(1.1); // all of "three" goes
    expect(b).toBeLessThanOrEqual(1.2); // resumes before "four" starts
  });

  it("a late engine start still resumes in the silence before the word", () => {
    const w = say("one two three");
    const real = energyFor(w, 2);
    // The engine says "three" starts 60 ms after it really does.
    const late = w.map((x, i) => (i === 2 ? { ...x, start: x.start + 0.06 } : x));
    const [, b] = cutForWords(late, 1, 1, 2, real);
    expect(b).toBeLessThan(0.8); // the real onset of "three" is 0.8
  });

  it("finds the valley between words that touch, instead of cutting mid-sound", () => {
    // "corn syrup. So": the engine says syrup ends exactly where So begins (no gap), but the
    // audio dips 20 ms before that point. A real case from a NoCrapDiet talk.
    const w: Word[] = [
      { start: 0.0, end: 0.4, word: "corn" }, { start: 0.5, end: 1.0, word: "syrup." },
      { start: 1.0, end: 1.3, word: "So" },
    ];
    const e = new Float32Array(150).fill(-18);
    e[42] = e[43] = e[44] = e[45] = e[46] = -60;           // the gap before "syrup."
    e[98] = -25;                                         // the valley before "So"
    const [a, b] = cutForWords(w, 1, 1, 1.5, e);
    expect(a).toBeGreaterThan(0.4);
    expect(a).toBeLessThan(0.5);
    expect(b).toBeCloseTo(0.985, 2);
  });

  it("first words take the silence before them; last words run to the end", () => {
    const w = say("one two", 1.0);
    expect(cutForWords(w, 0, 0, 3, energyFor(w, 3))[0]).toBe(0);
    expect(cutForWords(w, 1, 1, 3, energyFor(w, 3))[1]).toBe(3);
  });
});

describe("junk finders", () => {
  const none = new Set<string>();
  const types = (c: ClipWords[], cuts: Cut[] = []) => detect(c, cuts, none).map((s) => [s.type, s.text]);

  it("finds fillers, and runs of them as one", () => {
    const c = clip("a", say("So um|filler uh|filler the sugar [UH]|filler is high."));
    expect(types([c]).filter(([t]) => t === "filler")).toEqual([
      ["filler", "um uh"], ["filler", "[UH]"],
    ]);
  });

  it("finds a filler the engine did not label", () => {
    expect(types([clip("a", say("So um the sugar"))]).map(([t]) => t)).toContain("filler");
  });

  it("finds stumbles: dropped words, even repeated ones", () => {
    const c = clip("a", say("the pe-|cutoff pe-|cutoff people said"));
    expect(types([c]).filter(([t]) => t === "cutoff")).toEqual([["cutoff", "pe- pe-"]]);
  });

  it("finds doubled words but not a deliberate pause between them", () => {
    expect(types([clip("a", say("I I think so"))]).filter(([t]) => t === "repeat")).toEqual([["repeat", "I I"]]);
    const slow = [...say("very", 0), ...say("very good", 1.5)];
    expect(types([clip("a", slow)]).filter(([t]) => t === "repeat")).toEqual([]);
  });

  it("shortens long pauses instead of removing them", () => {
    const w = [...say("before.", 0), ...say("after", 2.3)];
    const s = detect([clip("a", w)], [], none).find((x) => x.type === "pause")!;
    const kept = (w[1].start - w[0].end) - (s.parts[0].end - s.parts[0].start);
    expect(kept).toBeCloseTo(0.35, 2);
  });

  it("finds dead air at both ends of a clip", () => {
    const s = detect([clip("a", say("hello there", 2.0), 6)], [], none).filter((x) => x.type === "dead");
    expect(s.map((x) => x.id)).toEqual(["dead:a:head", "dead:a:tail"]);
  });

  it("retakes keep the LAST take", () => {
    const w = [...say("The sugar in this is.", 0), ...say("The sugar in this can is crazy.", 2.5)];
    const s = detect([clip("a", w)], [], none).filter((x) => x.type === "retake");
    expect(s).toHaveLength(1);
    expect(s[0].parts[0].first).toBe(0);
    expect(s[0].parts[0].last).toBe(4); // only the first take goes
  });

  it("a chain of takes cuts all but the last", () => {
    const w = [...say("Eighteen grams of.", 0), ...say("Eighteen grams of sugar.", 2),
      ...say("Eighteen grams of sugar in here.", 4.5)];
    const s = detect([clip("a", w)], [], none).filter((x) => x.type === "retake");
    expect(s.map((x) => [x.parts[0].first, x.parts[0].last])).toEqual([[0, 2], [3, 6]]);
  });

  it("a retake across a clip boundary cuts the end of the first clip", () => {
    const a = clip("a", say("Okay so the gym is not your problem.", 0), 5);
    const b = clip("b", say("The gym is not your problem, this is.", 0.5), 5);
    const s = detect([a, b], [], none).filter((x) => x.type === "retake");
    expect(s).toHaveLength(1);
    expect(s[0].parts).toHaveLength(1);
    expect(s[0].parts[0].clip).toBe("a");
    expect(s[0].parts[0].end).toBe(5); // runs to the end of clip a
  });

  it("an aside between takes goes with the failed take", () => {
    const w = [...say("Flip it and look.", 0), ...say("Sorry, again.", 2), ...say("Flip it and look at this.", 3.5)];
    const s = detect([clip("a", w)], [], none).filter((x) => x.type === "retake");
    expect(s).toHaveLength(1);
    expect([s[0].parts[0].first, s[0].parts[0].last]).toEqual([0, 5]);
  });

  it("different sentences are not retakes", () => {
    const w = [...say("The sugar is high.", 0), ...say("The label hides it well.", 2)];
    expect(detect([clip("a", w)], [], none).filter((x) => x.type === "retake")).toEqual([]);
    expect(isRetakeOf(["the", "sugar", "is", "high"], ["the", "label", "hides", "it", "well"])).toBe(false);
  });

  it("splits phrases at sentence ends and long pauses, never across clips", () => {
    const a = clip("a", [...say("One two.", 0), ...say("three four", 1), ...say("five", 2.5)]);
    const b = clip("b", say("six seven"));
    expect(phrases([a, b]).map((p) => p.tokens.join(" "))).toEqual(["one two", "three four", "five", "six seven"]);
  });

  it("applied and ignored suggestions disappear", () => {
    const c = clip("a", say("So um|filler the sugar"));
    const [s] = detect([c], [], none).filter((x) => x.type === "filler");
    expect(detect([c], cutsFor(s), none).some((x) => x.type === "filler")).toBe(false);
    expect(detect([c], [], new Set([s.id])).some((x) => x.type === "filler")).toBe(false);
  });

  it("suggestion ids are stable, so ignoring survives a reload", () => {
    const c = clip("a", say("So um|filler the sugar"));
    expect(detect([c], [], none)[0].id).toBe(detect([c], [], none)[0].id);
  });
});
