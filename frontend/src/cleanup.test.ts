// The automatic clean-up cuts (filler words, long pauses) - pure logic, no DOM.
import { describe, expect, it } from "vitest";
import { fillerRanges, mergeRanges, newRanges, pauseRanges, totalSeconds } from "./cleanup";
import type { Word } from "./captionStyles";

const W = (start: number, end: number, word: string): Word => ({ start, end, word });

const words: Word[] = [
  W(0.0, 0.4, "So"), W(0.4, 0.7, "um,"), W(0.7, 1.1, "today"), W(1.1, 1.3, "we"),
  W(1.3, 1.9, "talk."),
  // a 2.5 s pause
  W(4.4, 4.6, "Uh"), W(4.6, 5.0, "about"), W(5.0, 5.4, "money."),
  W(5.5, 5.8, "Like"), W(5.8, 6.2, "this."),
];

describe("fillerRanges", () => {
  it("finds um/uh regardless of case and punctuation, and nothing else", () => {
    const r = fillerRanges(words, 0, 10, 0);
    expect(r).toEqual([[0.4, 0.7], [4.4, 4.6]]);
  });
  it("never treats 'like' as a filler", () => {
    expect(fillerRanges(words, 5.4, 10, 0)).toEqual([]);
  });
  it("respects the clip window and pads the edges", () => {
    const r = fillerRanges(words, 0.5, 10, 0.05);
    expect(r[0][0]).toBeCloseTo(0.5);      // clamped to the window start
    expect(r[0][1]).toBeCloseTo(0.75);     // padded
  });
});

describe("pauseRanges", () => {
  it("cuts the middle of a long silence and keeps a breath on both sides", () => {
    const r = pauseRanges(words, 0, 10, 1.0, 0.15);
    expect(r).toHaveLength(1);
    expect(r[0][0]).toBeCloseTo(1.9 + 0.15);
    expect(r[0][1]).toBeCloseTo(4.4 - 0.15);
  });
  it("ignores ordinary gaps between words", () => {
    expect(pauseRanges(words, 4.4, 10, 1.0)).toEqual([]);
  });
});

describe("mergeRanges / newRanges", () => {
  it("merges overlapping and touching ranges and sorts", () => {
    expect(mergeRanges([[5, 6], [1, 2]], [[2, 3], [5.5, 7]])).toEqual([[1, 3], [5, 7]]);
  });
  it("reports only ranges not already cut", () => {
    expect(newRanges([[0.4, 0.7]], [[0.4, 0.7], [4.4, 4.6]])).toEqual([[4.4, 4.6]]);
  });
  it("totals seconds", () => {
    expect(totalSeconds([[0, 1], [2, 2.5]])).toBeCloseTo(1.5);
  });
});
