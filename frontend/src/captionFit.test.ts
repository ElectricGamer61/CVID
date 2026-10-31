// The caption fit rule must give the SAME layout in the preview as the backend export
// (captions.fit_layout). The expected sizes below are what the Python implementation emits.
import { describe, expect, it } from "vitest";
import { FALLBACK_PRESETS, fitLayout, textEm, Word } from "./captionStyles";

const W = (word: string, extra: Partial<Word> = {}): Word => ({ start: 0, end: 0.5, word, ...extra });

describe("fitLayout (mirror of captions.fit_layout)", () => {
  const cinematic = FALLBACK_PRESETS.cinematic;
  it("leaves a line that fits untouched", () => {
    expect(fitLayout([W("the"), W("cat")], cinematic)).toEqual({ scale: 1, split: null });
  });
  it("puts two long words on two rows instead of crushing one row", () => {
    const r = fitLayout([W("gratification"), W("monkey")], cinematic);
    expect(r.split).toBe(1);
    expect(Math.floor(cinematic.size * r.scale)).toBe(102);   // backend writes {\fs102}
  });
  it("counts an AI emoji and emphasis exactly like the export", () => {
    const r = fitLayout([W("gratification"), W("monkey", { emoji: "\u{1F412}", emphasis: true })], cinematic);
    expect(r.split).toBe(1);
    expect(Math.floor(cinematic.size * r.scale)).toBe(102);
  });
  it("shrinks a single word that is wider than the frame", () => {
    const r = fitLayout([W("procrastinator")], cinematic);
    expect(r.split).toBeNull();
    expect(Math.floor(cinematic.size * r.scale)).toBe(85);
  });
  it("never shrinks below 45%", () => {
    expect(fitLayout([W("supercalifragilisticexpialidocious")], cinematic).scale).toBeCloseTo(0.45);
  });
  it("leaves an ordinary capcut line alone", () => {
    expect(fitLayout([W("this"), W("is"), W("a"), W("perfect")], FALLBACK_PRESETS.capcut).scale).toBe(1);
  });
  it("measures Arial Bold advances", () => {
    expect(textEm("MONKEY")).toBeCloseTo(4.389, 3);
  });
});
