// Cinematic Look + big title — the preview half. Pure logic, no DOM.
// The point of most of these: a clip with no look and no title must be EXACTLY what it was
// before this feature shipped, in the preview as well as the export.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STRENGTH, emptyTitle, FALLBACK_LOOKS, fitTitle, lookLayers, STRENGTHS, TITLE_BASE_W,
  titleMargins, titleVisible, TITLE_PLACES, TITLE_STYLES, wrapTitle,
} from "./looks";

// Must stay in lockstep with backend/app/pipeline/look.py (LOOK_IDS / PLACE_IDS / TITLE_STYLE_IDS).
const BACKEND_LOOK_IDS = ["none", "warm_film", "cold_cinema", "punchy", "soft_glow", "night"];
const BACKEND_PLACE_IDS = ["left", "right", "top", "bottom", "center"];
const BACKEND_TITLE_STYLE_IDS = ["bold", "glow", "boxed"];

describe("look presets", () => {
  it("mirrors the backend ids, in the same order", () => {
    expect(FALLBACK_LOOKS.map((l) => l.id)).toEqual(BACKEND_LOOK_IDS);
    expect(TITLE_PLACES.map((p) => p.id)).toEqual(BACKEND_PLACE_IDS);
    expect(TITLE_STYLES.map((t) => t.id)).toEqual(BACKEND_TITLE_STYLE_IDS);
  });

  it("labels every preset in plain English (no rendering jargon)", () => {
    const jargon = /lut|gamma|curve|chroma|luma|filter|codec/i;
    for (const l of FALLBACK_LOOKS) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.hint).not.toMatch(jargon);
    }
  });

  it("offers exactly one strength control with a sane default", () => {
    expect(STRENGTHS.map((s) => s.label)).toEqual(["Subtle", "Medium", "Strong"]);
    expect(STRENGTHS.some((s) => s.value === DEFAULT_STRENGTH)).toBe(true);
  });
});

describe("lookLayers", () => {
  it("paints nothing at all when no look is chosen", () => {
    for (const l of [undefined, null, { id: "none", strength: 1 }, { id: "warm_film", strength: 0 }]) {
      expect(lookLayers(l as any)).toEqual({ vignette: 0 });
    }
  });

  it("gives every real preset a visible grade", () => {
    for (const id of BACKEND_LOOK_IDS.slice(1)) {
      const layers = lookLayers({ id, strength: 1 });
      expect(layers.filter).toMatch(/contrast\(/);
      expect(layers.filter).not.toMatch(/NaN|undefined/);
    }
  });

  // These exact strings were FITTED against real ffmpeg renders of each look (same frame,
  // both pipelines, iterated until the mean RGB matched within ~2/255 per channel). They are
  // not decorative: if you change a chain in look.py, re-fit and update this snapshot —
  // otherwise the editor quietly starts lying about what the export will look like.
  it("keeps the fitted full-strength grade", () => {
    const at1 = (id: string) => lookLayers({ id, strength: 1 });
    expect(at1("warm_film").filter).toBe("contrast(1.14) saturate(1.12) brightness(0.9)");
    expect(at1("cold_cinema").filter).toBe("contrast(1.18) saturate(0.9) brightness(0.87)");
    expect(at1("punchy").filter).toBe("contrast(1.28) saturate(1.28) brightness(1.01)");
    expect(at1("soft_glow").filter).toBe("contrast(0.94) saturate(1.1) brightness(0.97)");
    expect(at1("night").filter).toBe("contrast(1.22) saturate(0.72) brightness(0.64)");
    expect(at1("night").tint).toEqual({ color: "#1a3a80", opacity: 0.26, blend: "soft-light" });
    expect(at1("night").vignette).toBe(0.7);
  });

  it("scales with strength", () => {
    const soft = lookLayers({ id: "night", strength: 0.35 });
    const hard = lookLayers({ id: "night", strength: 1 });
    expect(soft.filter).not.toBe(hard.filter);
    expect(soft.vignette).toBeLessThan(hard.vignette);
  });

  it("clamps nonsense strengths instead of emitting broken CSS", () => {
    expect(lookLayers({ id: "punchy", strength: 9 })).toEqual(lookLayers({ id: "punchy", strength: 1 }));
    expect(lookLayers({ id: "punchy", strength: NaN }))
      .toEqual(lookLayers({ id: "punchy", strength: DEFAULT_STRENGTH }));
    expect(lookLayers({ id: "not_a_look", strength: 1 })).toEqual({ vignette: 0 });
  });
});

describe("wrapTitle", () => {
  it("breaks at word boundaries within the column width", () => {
    const lines = wrapTitle("the one habit that changed everything", 11);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(11);
    expect(lines.join(" ").split(/\s+/)).toEqual("the one habit that changed everything".split(" "));
  });

  it("honors typed newlines and drops empty edges", () => {
    expect(wrapTitle("\nstop\nscrolling\n", 20)).toEqual(["stop", "scrolling"]);
  });

  it("never loses a word that is longer than the column", () => {
    expect(wrapTitle("supercalifragilistic", 5)).toEqual(["supercalifragilistic"]);
  });

  it("wraps blank text to nothing", () => {
    expect(wrapTitle("   ", 10)).toEqual([]);
    expect(wrapTitle("", 10)).toEqual([]);
  });

});

// Mirrors backend test_look.test_title_fit — the export and the preview must agree, and
// neither may run a title off the edge of the frame (ASS wraps nothing and clips nothing).
describe("fitTitle", () => {
  const CHAR_EM = 0.6;
  const column = (place: string) => {
    const [ml, mr] = titleMargins(place);
    return TITLE_BASE_W - ml - mr;
  };

  it("always fits the placement's column", () => {
    for (const place of BACKEND_PLACE_IDS) {
      for (const text of ["the one habit that changed everything", "supercalifragilisticexpialidocious",
        "STOP", "why nobody talks about this one thing"]) {
        const { lines, size } = fitTitle(text, place);
        const widest = Math.max(...lines.map((l) => l.length)) * CHAR_EM * size;
        expect(widest).toBeLessThanOrEqual(column(place) + 1);
        expect(lines.join(" ").split(/\s+/)).toEqual(text.split(" "));
        expect(size).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it("shrinks the type for a word too long to break", () => {
    expect(fitTitle("supercalifragilisticexpialidocious", "left").size)
      .toBeLessThan(fitTitle("STOP", "left").size);
  });

  it("stacks a side title into more lines than a full-width one", () => {
    expect(fitTitle("one two three four five six", "left").lines.length)
      .toBeGreaterThan(fitTitle("one two three four five six", "top").lines.length);
  });

  it("mirrors left and right", () => {
    const [l, r] = titleMargins("left");
    expect(titleMargins("right")).toEqual([r, l]);
    expect(fitTitle("a big cinematic title", "left")).toEqual(fitTitle("a big cinematic title", "right"));
  });

  it("fits blank text to nothing", () => {
    expect(fitTitle("  ", "left").lines).toEqual([]);
  });
});

describe("titleVisible", () => {
  const t = { ...emptyTitle(), text: "BIG", start: 2, duration: 3 };
  it("is off for an empty title, whatever the time", () => {
    expect(titleVisible(emptyTitle(), 0)).toBe(false);
    expect(titleVisible({ ...emptyTitle(), text: "  " }, 1)).toBe(false);
    expect(titleVisible(undefined, 1)).toBe(false);
  });
  it("shows only inside its window", () => {
    expect(titleVisible(t, 1.9)).toBe(false);
    expect(titleVisible(t, 2)).toBe(true);
    expect(titleVisible(t, 4.9)).toBe(true);
    expect(titleVisible(t, 5.2)).toBe(false);
  });
  it("starts blank, at the top of the clip", () => {
    const e = emptyTitle();
    expect(e.text).toBe("");
    expect(e.start).toBe(0);
    expect(BACKEND_PLACE_IDS).toContain(e.place);
    expect(BACKEND_TITLE_STYLE_IDS).toContain(e.style);
  });
});
