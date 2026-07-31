// Unit tests for App.tsx's pure UI logic — the rules that decide what the app shows you,
// with no DOM involved. Run with `npm test` in frontend/.
import { describe, expect, it } from "vitest";

import {
  beatHasCustomDetails, brainLabel, MAKE_STEPS, makeStepOf, makeStepOfBeats, nextStepFor,
  NEXT_STEP_HINT, optionsSummary, SECTION_LABELS, sidebarViewFor,
} from "./App";
import type { Ticket } from "./api";

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 1, brand: "NoCrapDiet", angle: "", format: "reel", capture_mode: "native-short",
  stage: "scripted", hook_text: "", auto_voiceover: false,
  ...over,
} as Ticket);

describe("sidebarViewFor", () => {
  it("lights up the section you're in", () => {
    for (const name of ["home", "board", "intake", "queue", "insights", "library"]) {
      expect(sidebarViewFor({ name } as any)).toBe(name);
    }
  });

  it("keeps a video under Create videos", () => {
    expect(sidebarViewFor({ name: "video", tid: 7 })).toBe("board");
  });

  it("keeps the editor under Create videos when it was opened from a video", () => {
    expect(sidebarViewFor({ name: "editor", pid: 1, cid: 2, from: "video", tid: 7 })).toBe("board");
  });

  it("keeps the editor and its moments grid under Projects otherwise", () => {
    expect(sidebarViewFor({ name: "editor", pid: 1, cid: 2 })).toBe("home");
    expect(sidebarViewFor({ name: "editor", pid: 1, cid: 2, from: "project" })).toBe("home");
    expect(sidebarViewFor({ name: "project", pid: 1 })).toBe("home");
  });

  it("names every section it can return", () => {
    const routes = [{ name: "home" }, { name: "board" }, { name: "intake" }, { name: "queue" },
      { name: "insights" }, { name: "library" }, { name: "video", tid: 1 },
      { name: "project", pid: 1 }, { name: "editor", pid: 1, cid: 1 }] as any[];
    for (const r of routes) expect(SECTION_LABELS[sidebarViewFor(r)]).toBeTruthy();
  });
});

describe("makeStepOf", () => {
  it("asks for a script before anything else", () => {
    expect(makeStepOf(ticket({ n_beats: 0, n_clips: 0, n_vo: 0 }))).toBe("script");
  });

  it("asks for clips until every scene has one", () => {
    expect(makeStepOf(ticket({ n_beats: 3, n_clips: 0, n_vo: 0 }))).toBe("clips");
    expect(makeStepOf(ticket({ n_beats: 3, n_clips: 2, n_vo: 0 }))).toBe("clips");
  });

  it("asks for a voiceover once the clips are in", () => {
    expect(makeStepOf(ticket({ n_beats: 3, n_clips: 3, n_vo: 0 }))).toBe("voice");
  });

  it("skips the voiceover step when AI voice is on", () => {
    expect(makeStepOf(ticket({ n_beats: 3, n_clips: 3, n_vo: 0, auto_voiceover: true }))).toBe("build");
  });

  it("is ready to build once something is voiced", () => {
    expect(makeStepOf(ticket({ n_beats: 3, n_clips: 3, n_vo: 1 }))).toBe("build");
  });

  it("sends the footage modes to Projects instead of down the scene checklist", () => {
    for (const capture_mode of ["longform-clip", "repurpose"]) {
      expect(makeStepOf(ticket({ capture_mode, n_beats: 0, n_clips: 0, n_vo: 0 }))).toBe("footage");
      expect(makeStepOf(ticket({ capture_mode, n_beats: 3, n_clips: 3, n_vo: 1 }))).toBe("footage");
    }
  });

  it("has a Make It lane heading for every step it can return", () => {
    const lanes = new Set(MAKE_STEPS.map((s) => s.key));
    for (const step of ["script", "clips", "voice", "build", "footage"]) {
      expect(lanes.has(step)).toBe(true);   // a step with no lane drops its cards silently
    }
  });
});

describe("nextStepFor", () => {
  const beats = [{ clip_path: "/a.mp4", voiceover_path: null }];

  it("walks the scene checklist for a native short", () => {
    expect(nextStepFor(ticket(), [])).toBe("script");
    expect(nextStepFor(ticket({ auto_voiceover: true }), [{ clip_path: null, voiceover_path: null }])).toBe("clips");
    expect(nextStepFor(ticket({ auto_voiceover: false }), beats)).toBe("voice");
    expect(nextStepFor(ticket({ auto_voiceover: true }), beats)).toBe("build");
  });

  it("switches to posting once the reel exists", () => {
    expect(nextStepFor(ticket({ clip_url: "/reel.mp4", auto_voiceover: true }), beats)).toBe("done");
  });

  it("points the footage modes at Projects instead of a build button they don't have", () => {
    // The rail renders no editor/build control for these, so the scene checklist would
    // be telling you to press something that isn't on screen.
    for (const capture_mode of ["longform-clip", "repurpose"]) {
      expect(nextStepFor(ticket({ capture_mode }), [])).toBe("footage");
      expect(nextStepFor(ticket({ capture_mode }), beats)).toBe("footage");
    }
  });

  it("agrees with the board's grouping for a footage-mode video", () => {
    // One rule: a longform-clip filed under "Needs clips" on the board while its workspace
    // said "ingest it on Projects" is exactly the drift this shares makeStepOf to avoid.
    for (const capture_mode of ["longform-clip", "repurpose"]) {
      const t = ticket({ capture_mode, n_beats: 3, n_clips: 1, n_vo: 0 });
      expect(nextStepFor(t, beats)).toBe(makeStepOf(t));
    }
  });

  it("has a next-step line for every key the rule can return", () => {
    for (const step of ["script", "clips", "voice", "build", "footage", "done"]) {
      expect(NEXT_STEP_HINT[step]).toBeTruthy();
    }
  });
});

describe("makeStepOfBeats", () => {
  const beats = (n: number, clips: number, vos: number) =>
    Array.from({ length: n }, (_, i) => ({
      clip_path: i < clips ? `/clip${i}.mp4` : null,
      voiceover_path: i < vos ? `/vo${i}.wav` : null,
    }));

  it("counts the scenes in hand, not the ticket's stale counters", () => {
    // The counters say "no scenes"; the workspace just imported three and filled them.
    const stale = ticket({ n_beats: 0, n_clips: 0, n_vo: 0, auto_voiceover: true });
    expect(makeStepOfBeats(stale, beats(3, 3, 0))).toBe("build");
    expect(makeStepOfBeats(stale, beats(3, 1, 0))).toBe("clips");
    expect(makeStepOfBeats(stale, [])).toBe("script");
  });

  it("still honours auto_voiceover from the ticket", () => {
    expect(makeStepOfBeats(ticket({ auto_voiceover: false }), beats(2, 2, 0))).toBe("voice");
    expect(makeStepOfBeats(ticket({ auto_voiceover: true }), beats(2, 2, 0))).toBe("build");
  });
});

describe("beatHasCustomDetails", () => {
  it("is false for a plain scene", () => {
    expect(beatHasCustomDetails({ spoken_line: "hello", on_screen_text: "", caption: "" })).toBe(false);
  });

  it("ignores the caption an imported script copies off the spoken line", () => {
    expect(beatHasCustomDetails({ spoken_line: "hello there", caption: "hello there" })).toBe(false);
    expect(beatHasCustomDetails({ spoken_line: " hello there ", caption: "hello there" })).toBe(false);
  });

  it("is true for a caption that was actually edited", () => {
    expect(beatHasCustomDetails({ spoken_line: "hello there", caption: "HELLO 👋" })).toBe(true);
  });

  it("is true for on-screen text", () => {
    expect(beatHasCustomDetails({ spoken_line: "hello", on_screen_text: "4g of sugar" })).toBe(true);
  });

  it("treats whitespace-only values as unset", () => {
    expect(beatHasCustomDetails({ spoken_line: "hello", on_screen_text: "   ", caption: "  " })).toBe(false);
  });

  it("survives missing fields", () => {
    expect(beatHasCustomDetails({})).toBe(false);
    expect(beatHasCustomDetails({ caption: "standalone caption" })).toBe(true);
  });
});

describe("new-project options summary", () => {
  it("names the brains the backend offers", () => {
    expect(brainLabel("claude")).toBe("Claude (smartest)");
    expect(brainLabel("ollama")).toBe("Local (free)");
    expect(brainLabel("gemini")).toBe("Gemini");
    expect(brainLabel("heuristic")).toBe("Basic (no AI)");
  });

  it("summarises the folded-away picks", () => {
    expect(optionsSummary({ genMode: "moments", brain: "ollama", transcribe: "local", aspect: "9:16", preset: "capcut" }))
      .toBe("Local (free) · local transcription · 9:16 · capcut");
  });

  it("drops the brain when there are no moments to score", () => {
    expect(optionsSummary({ genMode: "caption", brain: "ollama", transcribe: "elevenlabs", aspect: "1:1", preset: "clean" }))
      .toBe("ElevenLabs · 1:1 · clean");
  });
});
