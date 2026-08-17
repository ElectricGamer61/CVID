// Unit tests for App.tsx's pure UI logic — the rules that decide what the app shows you,
// with no DOM involved. Run with `npm test` in frontend/.
import { beforeEach, describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import sidebarSource from "./Sidebar.tsx?raw";

import {
  beatHasCustomDetails, brainLabel, clearLastEdit, editorRouteFor, MAKE_STEPS, makeStepOf,
  makeStepOfBeats, nextStepFor, NEXT_STEP_HINT, optionsSummary, readLastEdit, SECTION_LABELS,
  sidebarViewFor,
} from "./App";
import type { Ticket } from "./api";

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 1, brand: "NoCrapDiet", angle: "", format: "reel", capture_mode: "native-short",
  stage: "scripted", hook_text: "", auto_voiceover: false,
  ...over,
} as Ticket);

describe("sidebarViewFor", () => {
  it("lights up the section you're in", () => {
    for (const name of ["home", "board", "library"]) {
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
    const routes = [{ name: "home" }, { name: "board" },
      { name: "library" }, { name: "video", tid: 1 },
      { name: "project", pid: 1 }, { name: "editor", pid: 1, cid: 1 }] as any[];
    for (const r of routes) expect(SECTION_LABELS[sidebarViewFor(r)]).toBeTruthy();
  });

  it("has one sidebar section per label, and nothing beyond the editor's four", () => {
    // The whole product is: get footage in, edit it, take the file away. A fifth label
    // here would mean a route still points at a section the sidebar no longer shows.
    expect(Object.keys(SECTION_LABELS).sort()).toEqual(["board", "editor", "home", "library"]);
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

  it("has a card label for every step it can return", () => {
    const lanes = new Set(MAKE_STEPS.map((s) => s.key));
    for (const step of ["script", "clips", "voice", "build", "footage"]) {
      expect(lanes.has(step)).toBe(true);   // a step with no label leaves a card blank
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

  it("switches to \"it's made\" once the reel exists", () => {
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

  it("agrees with the card's label for a footage-mode video", () => {
    // One rule: a longform-clip whose card said "Needs clips" while its workspace said
    // "ingest it on Clipping" is exactly the drift this shares makeStepOf to avoid.
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

  it("never offers a brand to pick — there is only one, and it isn't a decision", () => {
    const base = { genMode: "caption", brain: "ollama", transcribe: "local", aspect: "9:16" };
    expect(optionsSummary(base)).toBe("local transcription · 9:16");
    expect(optionsSummary({ ...base, genMode: "moments" }))
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

  it("leads with an icon and one obvious Create Video button", () => {
    // What people missed after the board went away: the old empty state's big icon tile and
    // a button that said what it makes. Both live in the hero now.
    expect(src).toContain('className="ch-icon"');
    expect(src).toContain("Create Video");
    expect(src).toMatch(/className="primary big-cta"/);
    expect(src).toContain("Make your first video");   // first-run headline, no videos yet
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

  // The captain opened the Editor, looked for the big cinematic title, and didn't find it:
  // he expected text controls to live with the caption controls. They do now.
  it("puts the big cinematic title inside the Subtitles/Captions panel", () => {
    const at = src.indexOf('{tool === "subs" && (');
    const subs = src.slice(at, src.indexOf('{COMING_SOON.includes(tool)', at));
    expect(subs).toBeTruthy();
    expect(subs).toContain("<BigTitlePanel");                 // the controls themselves
    expect(subs).toMatch(/setSubsTab\("title"\)/);            // a tab in the captions toggle
    expect(subs).toMatch(/Cinematic title/);                  // and a signpost card in the Captions tab
    // BigTitlePanel is rendered nowhere else — the Subtitles panel is its only home.
    expect(src.match(/<BigTitlePanel/g)).toHaveLength(1);
  });

  it("has no separate Big title rail tool to hunt for", () => {
    const at = src.indexOf("const TOOLS:");
    const tools = src.slice(at, src.indexOf("];", at));
    expect(tools).not.toMatch(/id: "title"/);
    expect(tools).toMatch(/id: "subs", label: "Text & titles"/);
    // With no rail tool of its own, the "you have one" dot has to land on Subtitles.
    expect(src).toMatch(/if \(doc\.bigTitle\?\.text\.trim\(\)\) on\.add\("subs"\)/);
  });

  it("promises text NEAR the person, not a true behind-person cutout", () => {
    const at = src.indexOf("function BigTitlePanel(");
    const panel = src.slice(at, src.indexOf("\nfunction ", at + 10));
    expect(panel).toMatch(/near the person/i);
    expect(panel).not.toMatch(/behind (you|the (person|subject))/i);
  });

  it("tells you the rest of the styling is in the Editor when you're just captioning a clip", () => {
    // "Just caption my clip" has almost no options, which read as "this is all you get".
    const at = src.indexOf('<details className="np-more">');
    const options = src.slice(at, src.indexOf("</details>", at));
    expect(options).toContain("np-editor-note");
    expect(options).toMatch(/genMode === "caption" && <div className="muted np-editor-note"/);
    expect(options).toMatch(/<b>Editor<\/b>/);
  });

  it("lets the editor bail out to its start screen when the remembered clip is gone", () => {
    // A 404 must not leave the Editor button parked on a loading skeleton forever.
    expect(src).toMatch(/onMissing={editorGone}/);
    expect(src).toMatch(/if \(isNotFound\(e\)\) setGone\(true\)/);
    expect(src).toMatch(/clearLastEdit\(\);\s*\n\s*setRoute\(\{ name: "editorStart" \}\)/);
  });

  // A failed analyze used to be a dead end: the Clipping card showed the error with only a
  // 🗑, and the Editor toasted once and then looked like nothing had ever been uploaded.
  // The media is still on disk, so there must always be a way forward from an error.
  it("offers Retry on a project that failed", () => {
    expect(src).toMatch(/onRetry\(p\)/);
    expect(src).toContain("↻ Retry");
    expect(src).toMatch(/api\.retryProject/);
  });

  it("holds a failed editor upload on screen instead of only toasting", () => {
    expect(src).toMatch(/const prepFailed = prepping\?\.status === "error"/);
    expect(src).toContain("Couldn't get “{pending.name}” ready");
    expect(src).toContain("Pick another file");
    // The old behaviour: clear the upload and rely on a toast the user may never see.
    expect(src).not.toContain("Couldn't prepare that footage");
  });

  it("shows the error text on the card, not just an error badge", () => {
    expect(src).toMatch(/\{p\.error && <div className="err">\{p\.error\}<\/div>\}/);
  });
});

describe("editorRouteFor", () => {
  it("reopens the clip you had open last", () => {
    expect(editorRouteFor({ pid: 3, cid: 9 })).toEqual({ name: "editor", pid: 3, cid: 9 });
    expect(editorRouteFor({ pid: 3, cid: 9, from: "video", tid: 4 }))
      .toEqual({ name: "editor", pid: 3, cid: 9, from: "video", tid: 4 });
  });

  it("opens the editor's own drop-footage start screen when nothing is remembered", () => {
    // Not Clipping, not Create: the button says Editor, so it lands on the editor.
    expect(editorRouteFor(null)).toEqual({ name: "editorStart" });
    expect(sidebarViewFor(editorRouteFor(null))).toBe("editor");
  });
});

describe("last-edited clip", () => {
  // localStorage doesn't exist in the node test env; a tiny stand-in is enough to pin
  // the read/clear rules that decide where the Editor button points.
  const store: Record<string, string> = {};
  const stub = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (globalThis as any).localStorage = stub;
  });

  it("ignores a half-written or foreign entry instead of routing at it", () => {
    for (const bad of ["", "not json", "{}", '{"pid":1}', '{"pid":"1","cid":2}', "null"]) {
      store["cv.lastEdit"] = bad;
      expect(readLastEdit()).toBeNull();
      expect(editorRouteFor(readLastEdit())).toEqual({ name: "editorStart" });
    }
  });

  it("reads back what the editor remembered", () => {
    store["cv.lastEdit"] = JSON.stringify({ pid: 2, cid: 5, from: "home" });
    expect(readLastEdit()).toEqual({ pid: 2, cid: 5, from: "home" });
  });

  it("forgets a clip that's gone, so the next Editor click starts clean", () => {
    store["cv.lastEdit"] = JSON.stringify({ pid: 2, cid: 5 });
    clearLastEdit();
    expect(readLastEdit()).toBeNull();
    expect(editorRouteFor(readLastEdit())).toEqual({ name: "editorStart" });
  });
});

/* The declutter guards. CVideo is a local video editor: footage in, edit, export. Every
   assertion here is a surface that was on screen and shouldn't come back by accident —
   an autonomous operator, its approval gates, a posting queue, a performance database and
   a multi-brand picker, plus the "Advanced" button that revealed them. */
describe("the app is only an editor", () => {
  const src = appSource + sidebarSource;

  it("has exactly four sidebar stops", () => {
    const labels = ["Clipping", "Create", "Editor", "Downloads"];
    for (const l of labels) expect(sidebarSource).toContain(`"${l}"`);
    expect(sidebarSource.match(/^\s*\{item\(/gm)?.length).toBe(labels.length);
  });

  it("has no Advanced toggle — there is no second mode to reveal", () => {
    expect(src).not.toMatch(/useAdvanced|setAdvanced|advanced=1/);
    expect(src).not.toContain("Advanced on");
  });

  it("has no autopilot, gates or approval queue", () => {
    for (const gone of [/[Aa]utopilot/, /awaiting_approval/, /Needs your OK/, /Kill autopilot/,
      /Run once/, /Needs you \(/]) {
      expect(src).not.toMatch(gone);
    }
  });

  it("has no scheduling, posting or results screens", () => {
    for (const gone of [/function SchedulePage\(/, /function Queue\(/, /function Insights\(/,
      /function BulkLogger\(/, /function PlatformEditor\(/, /function PostCopyCard\(/,
      /Post now/, /Practice mode/, /Sync to Google Sheet/, /Upload-Post/]) {
      expect(src).not.toMatch(gone);
    }
  });

  it("has no brand picker — one name, set in code, never asked about", () => {
    expect(src).not.toMatch(/field-lab">Brand/);
    expect(src).not.toMatch(/BRANDS\.map/);
    expect(src).not.toMatch(/api\.setVideoBrand/);
  });

  it("keeps the editor product itself intact", () => {
    // The point of the cull was to leave these standing, so pin them.
    for (const kept of [/function EditorStart\(/, /function ClipEditor\(/, /function LookPanel\(/,
      /function BigTitlePanel\(/, /function Library\(/, /function NewProject\(/,
      /field-lab">Transcription/]) {
      expect(appSource).toMatch(kept);
    }
  });
});
