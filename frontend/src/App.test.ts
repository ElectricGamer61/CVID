// Unit tests for App.tsx's pure UI logic — the rules that decide what the app shows you,
// with no DOM involved. Run with `npm test` in frontend/.
import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";

import {
  beatHasCustomDetails, brainLabel, MAKE_STEPS, makeStepOf, makeStepOfBeats, nextStepFor,
  NEXT_STEP_HINT, optionsSummary, SECTION_LABELS, sidebarViewFor,
} from "./App";
import { ACTIVE_BRAND } from "./advanced";
import type { Ticket } from "./api";

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 1, brand: "NoCrapDiet", angle: "", format: "reel", capture_mode: "native-short",
  stage: "scripted", hook_text: "", auto_voiceover: false,
  ...over,
} as Ticket);

describe("sidebarViewFor", () => {
  it("lights up the section you're in", () => {
    for (const name of ["home", "board", "queue", "library"]) {
      expect(sidebarViewFor({ name } as any)).toBe(name);
    }
  });

  it("keeps a video under Create", () => {
    expect(sidebarViewFor({ name: "video", tid: 7 })).toBe("board");
  });

  it("lights up Editor in the editor, however you got there", () => {
    expect(sidebarViewFor({ name: "editor", pid: 1, cid: 2 })).toBe("editor");
    expect(sidebarViewFor({ name: "editor", pid: 1, cid: 2, from: "project" })).toBe("editor");
    expect(sidebarViewFor({ name: "editor", pid: 1, cid: 2, from: "video", tid: 7 })).toBe("editor");
  });

  it("keeps the editor's start screen under Editor", () => {
    // Nothing open yet is still the editor — the nav button must not bounce you elsewhere.
    expect(sidebarViewFor({ name: "editorStart" } as any)).toBe("editor");
  });

  it("keeps a project's moments grid under Clipping", () => {
    expect(sidebarViewFor({ name: "project", pid: 1 })).toBe("home");
  });

  it("names every section it can return", () => {
    const routes = [{ name: "home" }, { name: "board" }, { name: "queue" },
      { name: "library" }, { name: "video", tid: 1 },
      { name: "project", pid: 1 }, { name: "editor", pid: 1, cid: 1 }] as any[];
    for (const r of routes) expect(SECTION_LABELS[sidebarViewFor(r)]).toBeTruthy();
  });

  it("has one sidebar section per label, and no folded-away ones left", () => {
    // Ideas folded into Create, Results into Schedule. A leftover label here would
    // mean a route still points at a section the sidebar no longer shows.
    expect(Object.keys(SECTION_LABELS).sort()).toEqual(["board", "editor", "home", "library", "queue"]);
    expect(SECTION_LABELS.home).toBe("Clipping");
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

  it("sends the footage modes to Clipping instead of down the scene checklist", () => {
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

  it("points the footage modes at Clipping instead of a build button they don't have", () => {
    // The rail renders no editor/build control for these, so the scene checklist would
    // be telling you to press something that isn't on screen.
    for (const capture_mode of ["longform-clip", "repurpose"]) {
      expect(nextStepFor(ticket({ capture_mode }), [])).toBe("footage");
      expect(nextStepFor(ticket({ capture_mode }), beats)).toBe("footage");
    }
  });

  it("agrees with the board's grouping for a footage-mode video", () => {
    // One rule: a longform-clip filed under "Needs clips" on the board while its workspace
    // said "ingest it on Clipping" is exactly the drift this shares makeStepOf to avoid.
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
    expect(optionsSummary({ genMode: "moments", brain: "ollama", transcribe: "local", aspect: "9:16" }))
      .toBe("Local (free) · local transcription · 9:16");
  });

  it("drops the brain when there are no moments to score", () => {
    expect(optionsSummary({ genMode: "caption", brain: "ollama", transcribe: "elevenlabs", aspect: "1:1" }))
      .toBe("ElevenLabs · 1:1");
  });

  it("shows a non-default brand only in advanced mode", () => {
    const base = { genMode: "caption", brain: "ollama", transcribe: "local", aspect: "9:16" };
    expect(optionsSummary({ ...base, advanced: true, brand: "SemSeo" }))
      .toBe("SemSeo · local transcription · 9:16");
    expect(optionsSummary({ ...base, advanced: false, brand: "SemSeo" }))
      .toBe("local transcription · 9:16");
    expect(optionsSummary({ ...base, advanced: true, brand: ACTIVE_BRAND }))
      .toBe("local transcription · 9:16");
    expect(optionsSummary({ ...base, genMode: "moments", advanced: true, brand: "SemSeo" }))
      .toBe("Local (free) · local transcription · 9:16");
  });
});

/* The screens themselves need a DOM to render, and these tests deliberately don't have one.
   What they can still hold is the shape of the UI: which components exist, and which copy
   is allowed on screen. Every assertion below is something a user complained about. */
describe("the Create and Editor screens", () => {
  const src = appSource;

  it("starts a video from one hero, not a modal you have to find", () => {
    expect(src).toMatch(/function CreatePage\(/);
    expect(src).toMatch(/function CreateHero\(/);
    expect(src).not.toMatch(/function NewTicketModal\(/);
  });

  it("has no saved-ideas list — the questions live in the hero instead", () => {
    expect(src).not.toMatch(/function Ideas\(/);
    expect(src).not.toContain("Saved ideas");
    expect(src).not.toContain("swipe file");
    expect(src).not.toMatch(/Make a video from this/);
  });

  it("offers a copyable AI prompt when you have no script", () => {
    expect(src).toMatch(/function ScriptPromptCard\(/);
    expect(src).toContain("Copy prompt");
    expect(src).toMatch(/async function copyText\(/);
  });

  it("has an editor start state with a drop target, not a dead nav button", () => {
    expect(src).toMatch(/function EditorStart\(/);
    expect(src).toContain("Drag your footage here");
    // The old behaviour: the Editor button toasted and dumped you on Clipping.
    expect(src).not.toContain("Nothing edited yet — open a video below");
  });

  it("keeps footage inside the editor, not as its own top-level page", () => {
    expect(src).not.toMatch(/function ShootDrop\(/);
    expect(src).not.toContain("📼 Your footage");
  });

  it("never claims clips get placed for you", () => {
    // There is no auto-placement, and promising one made every drop feel broken.
    expect(src).not.toMatch(/get placed automatically/);
    expect(src).not.toMatch(/[Cc]lips you talk in/);
    expect(src).not.toMatch(/auto-match/);
  });

  it("keeps caption style out of the create options — it's a per-clip look", () => {
    // Picking a caption style before any clip exists is a guess you can't see.
    expect(src).not.toMatch(/field-lab">\s*Caption style/);
    // The Options fold offers exactly these, and nothing about captions.
    const at = src.indexOf('<details className="np-more">');
    const options = src.slice(at, src.indexOf("</details>", at));
    expect(options).toBeTruthy();
    expect(options).not.toContain("caption_preset");
    expect(options).not.toContain("caption_styles");
    expect(src).toMatch(/const preset = "capcut"/);   // fixed default; the editor picks the real look
  });

  it("keeps the Cinematic Look and big-title work in the editor", () => {
    expect(src).toMatch(/function LookPanel\(/);
    expect(src).toMatch(/function BigTitlePanel\(/);
  });
});
