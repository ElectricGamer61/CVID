import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, isNotFound, Beat, Clip, ClipEffects, ExportItem, Folder, Presets, Project, Ticket } from "./api";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionStyle, DEFAULT_PRESET, FALLBACK_PRESETS, groupLines, isBigSubtitleStyle, presetHint, presetLabel, Word, wordsInRange } from "./captionStyles";
import { DEFAULT_STRENGTH, emptyTitle, FALLBACK_LOOKS, LookSetting, lookLayers, STRENGTHS, TitleCard, TITLE_PLACES, TITLE_STYLES } from "./looks";
import { TitleOverlay } from "./TitleOverlay";
import { Sidebar } from "./Sidebar";
import { useToast } from "./Toast";
import { useConfirm, usePrompt } from "./Dialog";
import { useRecorder } from "./useRecorder";
import { VideoModal } from "./VideoModal";
import { exportDirSupported, getExportDir, pickExportDir } from "./exportDir";
import {
  buildScriptPrompt, canBuildPrompt, clampScenes, EMPTY_ANSWERS, MAX_SCENES, MIN_SCENES,
  ScriptAnswers, SCRIPT_QUESTIONS,
} from "./scriptPrompt";

/* Every video is filed under one name. There is no brand picker any more — this app edits
   your videos, it doesn't run a multi-brand content operation — but exports still group by
   it, so the constant keeps existing folders where they are. */
const BRAND = "NoCrapDiet";

export type Route =
  | { name: "home" }
  | { name: "board" }
  | { name: "library" }
  | { name: "video"; tid: number }
  | { name: "project"; pid: number }
  | { name: "editorStart" }
  | { name: "editor"; pid: number; cid: number; from?: "board" | "project" | "home" | "video"; tid?: number };

/** The sidebar sections, and the name each one shows in the breadcrumb.
 *
 *  One stop per thing you actually do, and nothing else: get footage in (Clipping or
 *  Create), edit it (Editor), take the finished file away (Downloads). Scheduling,
 *  posting and performance tracking are not part of a video editor and are gone. */
export const SECTION_LABELS: Record<string, string> = {
  home: "Clipping", board: "Create", editor: "Editor", library: "Downloads",
};

/* The editor is where the actual work happens, so the sidebar links straight at it: remember
   the last clip you had open and reopen exactly that one. */
const LAST_EDIT_KEY = "cv.lastEdit";
export type LastEdit = { pid: number; cid: number; from?: "board" | "project" | "home" | "video"; tid?: number };
export const readLastEdit = (): LastEdit | null => {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_EDIT_KEY) || "null");
    return v && typeof v.pid === "number" && typeof v.cid === "number" ? v : null;
  } catch { return null; }
};
const writeLastEdit = (e: LastEdit) => {
  try { localStorage.setItem(LAST_EDIT_KEY, JSON.stringify(e)); } catch { /* private mode */ }
};
/** Forget the remembered clip once it's gone, so Editor stops aiming at a dead row. */
export const clearLastEdit = () => {
  try { localStorage.removeItem(LAST_EDIT_KEY); } catch { /* private mode */ }
};

/** Where the sidebar's Editor button goes.
 *
 *  Back into the clip you had open last, or — with nothing remembered — the editor's own
 *  start screen, where you drop footage in. Never another section: the button says Editor,
 *  so it lands on the editor either way. If the remembered clip turns out to be gone, the
 *  editor forgets it and falls back here (see `EditorPage`'s `onMissing`). */
export const editorRouteFor = (last: LastEdit | null): Route =>
  last ? { name: "editor", ...last } : { name: "editorStart" };

/** Which sidebar item lights up for a route.
 *
 *  A video belongs to "Create" and a project's moments grid to "Clipping". The editor
 *  is its own sidebar stop now, so it lights itself up however you got there.
 */
export const sidebarViewFor = (route: Route): string => {
  if (route.name === "video") return "board";
  if (route.name === "editor" || route.name === "editorStart") return "editor";
  return route.name === "project" ? "home" : route.name;
};

export default function App() {
  const [presets, setPresets] = useState<Presets | null>(null);
  // Land on Clipping — the long-form clipper and everything you've already cut. It's the
  // home page: what you open the app to look at, with "Create" one click away.
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [projName, setProjName] = useState("");
  const [backendDown, setBackendDown] = useState(false);
  const toast = useToast();

  useEffect(() => { api.presets().then(setPresets); }, []);
  // Poll the backend so a crash is visible immediately — the editor autosaves silently, so a
  // dead server used to eat edits with no warning. This banner makes the outage impossible to miss.
  useEffect(() => {
    let alive = true;
    const ping = () => api.health().then(() => alive && setBackendDown(false)).catch(() => alive && setBackendDown(true));
    ping();
    const t = setInterval(ping, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const goHome = () => setRoute({ name: "home" });
  const goBoard = () => setRoute({ name: "board" });
  const goLibrary = () => setRoute({ name: "library" });
  const goEditor = () => setRoute(editorRouteFor(readLastEdit()));
  // The remembered clip can be deleted from under us (or belong to a database that's since
  // been replaced). Then the editor has nothing to draw and used to sit on its loading
  // skeleton forever — the Editor button looked broken. Forget it and show the real start
  // screen instead, so the button always lands somewhere you can work.
  const editorGone = () => {
    clearLastEdit();
    setRoute({ name: "editorStart" });
    toast("That clip isn't there any more — here's the editor.", "info");
  };
  // Remember where the editor was, so that button has somewhere to go next time.
  useEffect(() => {
    if (route.name === "editor") writeLastEdit({ pid: route.pid, cid: route.cid, from: route.from, tid: route.tid });
  }, [route]);

  // The editor builds its own trail (section / project / moments), so it takes no flat label.
  const crumbLabel = route.name === "editor" ? null
    : route.name === "editorStart" ? SECTION_LABELS.editor
      : SECTION_LABELS[route.name] ?? null;
  const fromVideo = route.name === "editor" && route.from === "video";
  const sbView = sidebarViewFor(route) as any;

  return (
    <div className="shell">
      <Sidebar view={sbView} onHome={goHome} onBoard={goBoard} onEditor={goEditor} onLibrary={goLibrary} />
      <main className="main">
        {backendDown && (
          <div className="backend-down-banner" role="alert">
            ⚠ Backend offline — your edits are <b>NOT</b> saving. It auto-restarts in a couple of seconds; this clears on its own when it's back.
          </div>
        )}
        <header className="topbar">
          <div className="crumbs">
            {crumbLabel
              ? <span className="cur">{crumbLabel}</span>
              : route.name === "video" || fromVideo
                ? <button className="back" onClick={goBoard}>Create</button>
                : <button className="back" onClick={goHome}>Clipping</button>}
            {(route.name === "project" || route.name === "editor") && (<><span className="sep">/</span><span className="cur">{projName}</span></>)}
            {route.name === "editor" && !fromVideo && (<><span className="sep">/</span><button className="back" onClick={() => setRoute({ name: "project", pid: route.pid })}>moments</button></>)}
          </div>
          <div className="spacer" />
        </header>

        {route.name === "board" && <CreatePage presets={presets} onOpenTicket={(tid) => setRoute({ name: "video", tid })} />}
        {route.name === "editorStart" && (
          <EditorStart presets={presets}
            onOpenClip={(pid, cid) => setRoute({ name: "editor", pid, cid, from: "home" })}
            onGoCreate={goBoard} />
        )}
        {route.name === "video" && (
          <VideoWorkspace tid={route.tid} presets={presets} onBack={goBoard}
            onOpenEditor={(pid, cid) => setRoute({ name: "editor", pid, cid, from: "video", tid: route.tid })} />
        )}
        {route.name === "library" && <Library />}
        {route.name === "home" && <Home presets={presets} onOpen={(pid) => setRoute({ name: "project", pid })} />}
        {route.name === "project" && (
          <MomentsGrid pid={route.pid} onName={setProjName}
            onEdit={(cid) => setRoute({ name: "editor", pid: route.pid, cid })}
            onEditReel={(cid) => setRoute({ name: "editor", pid: route.pid, cid, from: "home" })}
            onBack={goHome} />
        )}
        {route.name === "editor" && (
          <EditorPage pid={route.pid} cid={route.cid} presets={presets} onName={setProjName}
            onMissing={editorGone}
            onBack={() => setRoute(
              route.from === "video" && route.tid != null ? { name: "video", tid: route.tid }
                : route.from === "board" ? { name: "board" }
                : route.from === "home" ? { name: "home" }
                : { name: "project", pid: route.pid })} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------- Create --------------------------------- */
// "Recently opened" memory (localStorage) — Create floats these to the top of the grid and
// marks them, so you never lose track of the videos you were working on.
const RECENT_KEY = "cv.recentTickets";
const getRecent = (): number[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
};
const markRecent = (tid: number) => {
  try {
    const r = [tid, ...getRecent().filter((i) => i !== tid)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch { /* private mode etc. — Create just skips the highlight */ }
};

// What a video needs NEXT, derived from its real scene progress (not the stage field,
// which nobody remembers to bump). It's the one line every video card ends with.
type MakeStep = { key: string; label: string };
export const MAKE_STEPS: MakeStep[] = [
  { key: "script", label: "✍️ Needs a script" },
  { key: "clips",  label: "🎬 Needs clips" },
  { key: "voice",  label: "🎙 Needs a voice" },
  { key: "build",  label: "🧩 Ready to build" },
  { key: "footage", label: "📼 From footage — ingest on Clipping" },
];
export const makeStepOf = (t: Ticket): string => {
  // Only a native short is built here from scenes; the older footage modes come from
  // video you already have, which is ingested and exported on Clipping — so the scene
  // checklist would be naming controls the workspace rail doesn't put on screen.
  if (t.capture_mode !== "native-short") return "footage";
  const beats = t.n_beats ?? 0, clips = t.n_clips ?? 0, vo = t.n_vo ?? 0;
  if (beats === 0) return "script";
  if (clips < beats) return "clips";
  if (!t.auto_voiceover && vo === 0) return "voice";   // AI-voice tickets skip this — TTS covers it
  return "build";
};

/** Same rule, but against the scenes the workspace already has loaded (the ticket's
 *  cached counters lag a just-uploaded clip by one poll). */
export const makeStepOfBeats = (t: Ticket, beats: { clip_path?: string | null; voiceover_path?: string | null }[]): string =>
  makeStepOf({
    ...t,
    n_beats: beats.length,
    n_clips: beats.filter((b) => b.clip_path).length,
    n_vo: beats.filter((b) => b.voiceover_path).length,
  });

// The card says what a video is waiting on; the workspace says what to DO about it.
export const NEXT_STEP_HINT: Record<string, string> = {
  script: "Paste the script you wrote — it turns into your scenes.",
  clips: "Add a video to every scene, then make and export your video.",
  voice: "Record a voiceover per scene, or switch on 🎙 AI voice up top.",
  build: "Everything's in — make and export your video, or open the editor first.",
  footage: "This one comes from footage you already have — ingest it on Clipping, then edit and export it there.",
  done: "Your video's made — save it here, or pick it up again in Downloads.",
};

/** The workspace's next step — the same {@link makeStepOf} rule the video cards show, so
 *  the two never disagree, plus a `done` step the cards have no use for (they only ever
 *  label videos that aren't made yet). */
export const nextStepFor = (t: Ticket, beats: { clip_path?: string | null; voiceover_path?: string | null }[]): string =>
  t.clip_url ? "done" : makeStepOfBeats(t, beats);

/** Create: one hero that starts a video, then the videos you're already making.
 *
 *  It used to be a four-lane board with a "how it works" strip, a saved-ideas database and a
 *  raw-footage bin bolted underneath — four ways to start, none of them obvious. Now there's
 *  one start (paste your script, or answer the questions and we write you the AI prompt) and
 *  a plain grid of what's in flight. Footage lives in the Editor, where you edit it. */
function CreatePage({ presets, onOpenTicket }: { presets: Presets | null; onOpenTicket: (tid: number) => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const refresh = () => api.listTickets().then(setTickets).catch(() => {});
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  const del = async (t: Ticket) => {
    if (!await confirm({ title: "Delete this video?", body: t.angle ? `“${t.angle}” and its scenes will be removed.` : "Its scenes will be removed.", confirmLabel: "Delete", danger: true })) return;
    try { await api.deleteTicket(t.id); toast("Video deleted", "ok"); refresh(); }
    catch (e: any) { toast(`Delete failed: ${e?.message || e}`, "err"); }
  };

  // Recently-opened first (the ones you were working on), then newest.
  const recent = getRecent();
  const recencyRank = (t: Ticket) => { const i = recent.indexOf(t.id); return i === -1 ? Infinity : i; };
  const mine = [...(tickets ?? [])].sort((a, b) => recencyRank(a) - recencyRank(b) || b.id - a.id);

  return (
    <div className="board-page">
      {/* No "Create" h2 here: the topbar already says Create, and a lone left-aligned title
          floating beside the centred hero just pulled the eye off the one thing to do. */}
      <CreateHero presets={presets} firstRun={tickets != null && tickets.length === 0}
        onCreated={(tid) => { markRecent(tid); onOpenTicket(tid); }} />

      {/* Everything you're already making, newest (and most recently opened) first. No lanes,
          no stages to drag between — each card says what it still needs. They sit in the same
          centred column as the hero above them, so the page reads as one thing. */}
      {tickets == null ? <div className="muted" style={{ marginTop: 24 }}>Loading…</div> : tickets.length === 0 ? null : (
        <div className="cv-below">
          <div className="page-head" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Your videos</h3><span className="muted">{tickets.length} in progress</span>
          </div>
          <div className="vid-grid">
            {mine.map((t) => (
              <VideoCard key={t.id} t={t}
                recent={recent.indexOf(t.id) > -1 && recent.indexOf(t.id) < 3}
                onOpen={() => { markRecent(t.id); onOpenTicket(t.id); }} onDelete={del} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One video you're making. Says what it needs next and opens where you do that — no stage
 *  arrows, no lane it has to be dragged out of. */
function VideoCard({ t, recent, onOpen, onDelete }: {
  t: Ticket; recent?: boolean; onOpen: () => void; onDelete: (t: Ticket) => void;
}) {
  const made = !!t.clip_url;
  const step = MAKE_STEPS.find((s) => s.key === makeStepOf(t));
  const beats = t.n_beats ?? 0, clips = t.n_clips ?? 0, vo = t.n_vo ?? 0;
  return (
    <div className={"tkt-card" + (recent ? " tkt-recent" : "")} onClick={onOpen} title="Open">
      {recent && (
        <div className="tkt-badges">
          <span className="tkt-recent-chip" title="You opened this recently">⏱</span>
        </div>
      )}
      <div className="tkt-thumb">
        {made ? (
          <img src={api.ticketThumbUrl(t.id)} alt="" loading="lazy"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          <div className="tkt-thumb-ph"><span>🎬</span></div>
        )}
        {made && <span className="tkt-made" title="Video made">✓</span>}
      </div>
      <div className="tkt-card-body">
        {t.hook_text
          ? <div className="tkt-hook-main">“{t.hook_text}”</div>
          : <div className="tkt-angle">{t.angle || <span className="muted">Untitled video</span>}</div>}
        {!made && beats > 0 ? (
          <div className="tkt-prog">
            <span className="tkt-chip done" title="Scenes written">✍ {beats}</span>
            <span className={"tkt-chip" + (clips >= beats ? " done" : "")} title="Clips added">🎬 {clips}/{beats}</span>
            <span className={"tkt-chip" + (t.auto_voiceover || vo >= beats ? " done" : "")}
              title={t.auto_voiceover ? "AI voiceover — read over the whole video when it's built" : "Voiceovers recorded"}>
              🎙 {t.auto_voiceover ? "AI" : `${vo}/${beats}`}
            </span>
          </div>
        ) : (
          <div className="tkt-sub">{t.angle || <span className="muted">Untitled video</span>}</div>
        )}
        <div className="tkt-next">{made ? "✓ Made — open it to export" : step?.label}</div>
      </div>
      <div className="tkt-side" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn danger tkt-del" title="Delete this video" onClick={() => onDelete(t)}>🗑</button>
      </div>
    </div>
  );
}

/* ------------------------------- Create hero ---------------------------- */
/* The one place a video starts.
 *
 * Two answers to "do you have a script?", on one screen:
 *   yes → paste it, it splits into scenes (`intake.parse_script`, deterministic, no LLM)
 *         and you land in the workspace to add clips.
 *   no  → answer a few plain questions, copy the prompt we build, paste it into whatever
 *         AI you use, and paste the script it writes back into the same box. CVideo never
 *         has to be the one holding an API key for this.
 */
function CreateHero({ presets, firstRun, onCreated }: { presets: Presets | null; firstRun?: boolean; onCreated: (tid: number) => void }) {
  const [angle, setAngle] = useState("");
  const [script, setScript] = useState("");
  const [autoVoice, setAutoVoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [helper, setHelper] = useState(false);            // the "no script yet" questions
  const [answers, setAnswers] = useState<ScriptAnswers>(EMPTY_ANSWERS);
  const [prompt, setPrompt] = useState<string | null>(null);
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const capture = "native-short";   // scenes you film yourself; footage you already have goes to the Editor

  const start = async () => {
    setBusy(true);
    try {
      const res = await api.createTicketFromScript({
        brand: BRAND, angle, format: "reel", capture_mode: capture, script,
        auto_voiceover: autoVoice,
      });
      toast(`Made ${res.beats.length} scene${res.beats.length === 1 ? "" : "s"} — add your clips`, "ok");
      onCreated(res.ticket.id);
    } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); setBusy(false); }
  };

  // Take the questions and hand back one prompt to paste into Claude/ChatGPT.
  const makePrompt = () => {
    if (!canBuildPrompt(answers)) { toast("Say what the video's about first", "err"); return; }
    setPrompt(buildScriptPrompt(answers));
    if (!angle.trim()) setAngle(answers.topic.trim());   // the topic is the video's name too
  };
  // Coming back from the AI: close the card and put the cursor in the paste box.
  const backToPaste = () => {
    setPrompt(null); setHelper(false);
    requestAnimationFrame(() => scriptRef.current?.focus());
  };

  return (
    <div className="card create-hero">
      <div className="ch-head">
        <div className="ch-icon" aria-hidden>🎬</div>
        <h3>{firstRun ? "Make your first video" : "Make a video"}</h3>
        <span className="muted">Paste your script and it becomes scenes. Then add clips, style it in the editor, and export.</span>
        {firstRun && (
          <div className="ch-steps">
            <span className="ch-step"><b>1</b> Paste the script</span><span className="how-arrow">→</span>
            <span className="ch-step"><b>2</b> Add your clips</span><span className="how-arrow">→</span>
            <span className="ch-step"><b>3</b> Style &amp; export</span>
          </div>
        )}
      </div>

      <label className="field"><span className="field-lab">Your script</span>
        <textarea ref={scriptRef} rows={8} value={script} className="ch-script"
          placeholder={"Paste it here — plain lines work, or the labeled format:\n\nHOOK: the first line\n\nBEAT\nSpoken: what you say out loud\nShot: what to film"}
          onChange={(e) => setScript(e.target.value)} />
      </label>

      <div className="ch-row">
        <label className="field grow"><span className="field-lab">Call it…</span>
          <input value={angle} placeholder="e.g. hidden sugar in sauces" onChange={(e) => setAngle(e.target.value)} />
        </label>
      </div>

      <label className="nt-toggle" title="Reads the whole script in your AI voice as ONE continuous voiceover over all your clips — for silent B-roll">
        <input type="checkbox" checked={autoVoice} onChange={(e) => setAutoVoice(e.target.checked)} />
        <span>🎙 AI voiceover (one read over the whole video)</span>
      </label>

      {/* The one obvious button on the page, centred under the box the way the old Create
          tab's empty state did it — the "no script" way in stays a quiet line below it. */}
      <div className="ch-actions">
        <button className="primary big-cta" onClick={start} disabled={busy || !script.trim()}
          title={!script.trim() ? "Paste your script first" : "Split it into scenes"}>
          {busy ? "Making scenes…" : "🎬 Create Video"}
        </button>
        <button className="link-btn" onClick={() => setHelper((v) => !v)}>
          {helper ? "Hide the questions" : "I don't have a script yet"}
        </button>
      </div>

      {helper && (
        <div className="ch-helper">
          <div className="ch-helper-h">
            <b>No script? Answer these.</b>
            <span className="muted">We'll write the prompt — you paste it into Claude, ChatGPT or whatever you use, then paste the script it gives you back up top.</span>
          </div>
          {SCRIPT_QUESTIONS.map((q) => (
            <label className="field" key={q.key}>
              <span className="field-lab">{q.label}{q.required ? "" : <span className="muted"> (optional)</span>}</span>
              {q.long
                ? <textarea rows={2} value={answers[q.key] as string} placeholder={q.placeholder}
                    onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
                : <input value={answers[q.key] as string} placeholder={q.placeholder}
                    onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />}
            </label>
          ))}
          <div className="ch-helper-foot">
            <label className="field ch-scenes"><span className="field-lab">How many scenes?</span>
              <input type="number" min={MIN_SCENES} max={MAX_SCENES} value={answers.scenes}
                onChange={(e) => setAnswers({ ...answers, scenes: clampScenes(Number(e.target.value)) })} />
            </label>
            <button className="primary" onClick={makePrompt} disabled={!canBuildPrompt(answers)}
              title={canBuildPrompt(answers) ? "Build the prompt to copy" : "Say what the video's about first"}>
              ✨ Write my AI prompt
            </button>
          </div>
        </div>
      )}

      {prompt && <ScriptPromptCard prompt={prompt} onClose={backToPaste} />}
    </div>
  );
}

/** The copy-me card: one prompt, one button, and what to do with it. */
function ScriptPromptCard({ prompt, onClose }: { prompt: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = async () => {
    if (await copyText(prompt)) { setCopied(true); toast("Prompt copied — paste it into your AI", "ok"); }
    else toast("Couldn't copy — select the text and copy it by hand", "err");
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-slim prompt-card" onClick={(e) => e.stopPropagation()}>
        <h3>Copy this into your AI</h3>
        <div className="muted prompt-steps">
          <span><b>1</b> Copy it</span><span className="how-arrow">→</span>
          <span><b>2</b> Paste it into Claude / ChatGPT</span><span className="how-arrow">→</span>
          <span><b>3</b> Paste the script it writes back into CVideo</span>
        </div>
        <textarea className="prompt-text" rows={14} readOnly value={prompt}
          onFocus={(e) => e.currentTarget.select()} />
        <div className="modal-actions">
          <button onClick={onClose}>Done — I'll paste my script</button>
          <button className="primary" onClick={copy}>{copied ? "✓ Copied" : "Copy prompt"}</button>
        </div>
      </div>
    </div>
  );
}

/** Clipboard write that also works on the plain-HTTP LAN origins this app gets opened on
 *  (navigator.clipboard is https/localhost only). Returns whether it landed. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the textarea trick */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/* ------------------------- Video workspace ------------------------------ */
// Full-page home for one video: header band (hook + angle), scenes in the main column,
// and "make it" plus the AI draft in a sticky right rail.
function VideoWorkspace({ tid, presets, onBack, onOpenEditor }: { tid: number; presets: Presets | null; onBack: () => void; onOpenEditor: (pid: number, cid: number) => void }) {
  const [data, setData] = useState<{ ticket: Ticket; beats: Beat[] } | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const load = () => api.getTicket(tid).then(setData).catch(() => {});
  useEffect(() => { load(); markRecent(tid); }, [tid]);
  // AI voice is on by default, and without an ElevenLabs key every build dies partway
  // through with "ELEVENLABS_API_KEY not set". /api/presets carries the flag (it's already
  // loaded once at startup), so the warning costs nothing. undefined = not known, so say nothing.
  const ttsMissing = presets?.tts_available === false;

  const patchT = async (body: Partial<Ticket>) => { await api.patchTicket(tid, body); load(); };
  const addBeat = async () => { await api.addBeat(tid); load(); };
  const reorder = async (b: Beat, dir: 1 | -1) => {
    if (!data) return;
    const ids = data.beats.map((x) => x.id);
    const i = ids.indexOf(b.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.reorderBeats(tid, ids); load();
  };

  const [building, setBuilding] = useState(false);
  const openEditor = async () => {
    setBuilding(true);
    try {
      const r = await api.buildEdit(tid);
      if (r.wiped_edits) toast("Scenes changed — previous trims/cuts were reset", "err");
      else if (r.reused_edits) toast("Kept your trims & cuts", "ok");
      onOpenEditor(r.pid, r.cid);
    }
    catch (e: any) { toast(`Couldn't open editor: ${e?.message || e}`, "err"); }
    finally { setBuilding(false); }
  };

  const [hooks, setHooks] = useState<string[] | null>(null);
  const [aiBusy, setAiBusy] = useState<"" | "script" | "hook">("");
  const runScript = async () => {
    if (data && data.beats.length && !await confirm({ title: "Rewrite the whole script?", body: "AI will replace all current scenes with a fresh script.", confirmLabel: "Rewrite" })) return;
    setAiBusy("script");
    try { const r = await api.scriptFactory(tid); toast(`Script: ${r.beats.length} beats`, "ok"); setData(r); }
    catch (e: any) { toast(`Script Factory failed: ${e?.message || e}`, "err"); } finally { setAiBusy(""); }
  };
  const runHooks = async () => {
    setAiBusy("hook");
    try { const r = await api.hookForge(tid); setHooks(r.hooks); }
    catch (e: any) { toast(`Hook Forge failed: ${e?.message || e}`, "err"); } finally { setAiBusy(""); }
  };
  const pickHook = (h: string) => { patchT({ hook_text: h }); setHooks(null); toast("Hook set", "ok"); };

  const [asm, setAsm] = useState<{ state: string; stage: string; error: string | null } | null>(null);
  const assembleReel = async () => {
    try {
      await api.assembleTicket(tid);
      setAsm({ state: "running", stage: "Starting", error: null });
      const poll = setInterval(async () => {
        const st = await api.assembleStatus(tid);
        setAsm(st);
        if (st.state === "done" || st.state === "error" || st.state === "idle") {
          clearInterval(poll); load();
          if (st.state === "done") toast("Reel assembled", "ok");
          if (st.state === "error") toast(`Assemble failed: ${st.error}`, "err");
        }
      }, 1500);
    } catch (e: any) { toast(`Assemble failed: ${e?.message || e}`, "err"); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, "ok"); load(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); }
  };

  return (
    <div className="page vw-page">
      {!data ? <div className="muted">Loading…</div> : (() => {
        const { ticket, beats } = data;
        const proofGaps = beats.filter((b) => b.is_proof_beat && !b.clip_path).length;
        return (
          <>
            <div className="vw-head">
              <button className="icon-btn vw-back" onClick={onBack} title="Back to Create">←</button>
              <div className="vw-title">
                <input className="vw-hook-input" key={"h" + ticket.hook_text} defaultValue={ticket.hook_text}
                  placeholder="First line (the hook) — the line that stops people scrolling"
                  onBlur={(e) => e.target.value !== ticket.hook_text && patchT({ hook_text: e.target.value })} />
                <input className="vw-angle-input" key={"a" + ticket.angle} defaultValue={ticket.angle} placeholder="What's it about?"
                  onBlur={(e) => e.target.value !== ticket.angle && patchT({ angle: e.target.value })} />
              </div>
              <div className="vw-meta">
                <button className={"vw-voice-toggle" + (ticket.auto_voiceover ? " on" : "")}
                  title={ticket.auto_voiceover ? "AI voiceover ON — your whole script is read as ONE continuous voiceover over all clips when the video is built" : "Turn on to read the whole script in your AI voice as one continuous voiceover over all your clips (for silent B-roll)"}
                  onClick={() => act(() => api.patchTicket(tid, { auto_voiceover: !ticket.auto_voiceover } as Partial<Ticket>),
                    ticket.auto_voiceover ? "AI voiceover off" : "AI voiceover on — one read over the whole video when it's built")}>
                  🎙 {ticket.auto_voiceover ? "AI voice on" : "AI voice"}
                </button>
              </div>
            </div>

            {/* One line, always answering "so what do I do now?" — the same rule the video
                cards label themselves with, worded as an instruction. */}
            <div className="vw-next"><span className="vw-next-k">Next</span>{NEXT_STEP_HINT[nextStepFor(ticket, beats)]}</div>

            <div className="vw-grid">
              <div className="vw-main">
                <div className="vw-sec-head">
                  <h4>Scenes ({beats.length})</h4>
                  {proofGaps > 0 && (
                    <span className="warn-chip">
                      ⚠ {proofGaps} scene{proofGaps > 1 ? "s" : ""} need{proofGaps > 1 ? "" : "s"} a video showing proof
                    </span>
                  )}
                </div>
                {beats.length === 0 ? (
                  <div className="vw-empty">
                    <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>No scenes yet — paste the script and it becomes your scenes.</div>
                    <ReimportBox tid={tid} onDone={load} empty />
                    <div className="beat-add-row" style={{ marginTop: 10 }}>
                      <span className="muted" style={{ fontSize: 12.5 }}>No script? </span>
                      <button className="link-btn" onClick={addBeat}>Write scenes by hand</button>
                      <span className="muted" style={{ fontSize: 12.5 }}>or use ✨ AI draft on the right.</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="beats">
                      {beats.map((b, i) => (
                        <BeatRow key={b.id} b={b} first={i === 0} last={i === beats.length - 1}
                          onChanged={load} onReorder={reorder} toast={toast} />
                      ))}
                    </div>
                    <div className="beat-add-row">
                      <button onClick={addBeat}>+ Add scene</button>
                      <ReimportBox tid={tid} onDone={load} />
                    </div>
                  </>
                )}
              </div>

              {/* Rail order = the order you use it: build the video, and only then the AI
                  draft, which is the fallback for a blank day. */}
              <div className="vw-rail">
                <div className="vw-card">
                  <h4>🎬 Make the video</h4>
                  {ticket.capture_mode !== "native-short" ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      This video comes from existing footage — ingest it on <b>Clipping</b>, then edit and export from there.
                    </div>
                  ) : beats.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>Add scenes first — then preview, record your voice, and make the final video here.</div>
                  ) : (
                    <div className="assemble-box">
                      {ticket.auto_voiceover && ttsMissing && (
                        <div className="vw-warn">
                          🎙 AI voice is on, but no ElevenLabs key is set — building will fail.
                          Add <code>ELEVENLABS_API_KEY</code> to <code>backend/.env</code>, or turn AI voice off and record the scenes yourself.
                        </div>
                      )}
                      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Open your scenes as one video — preview it, record your voice, add captions and cut:</div>
                      <button className="primary big-btn" onClick={openEditor} disabled={building}>
                        {building ? "Opening editor…" : "✏️ Open in editor"}
                      </button>
                      <div className="muted" style={{ fontSize: 12, margin: "10px 0 8px" }}>…or make the final video right away:</div>
                      {/* The backend refuses to assemble while a proof scene has no footage
                          (POST /assemble → 400). Say so here instead of offering a button whose
                          only outcome is an error toast. */}
                      <button className="big-btn" onClick={assembleReel} disabled={asm?.state === "running" || proofGaps > 0}
                        title={proofGaps > 0 ? "Add the product/label footage to the highlighted scene first" : ""}>
                        {asm?.state === "running" ? `⏳ ${asm.stage}…` : ticket.clip_url ? "↻ Make it again" : "🎬 Make my video"}
                      </button>
                      {proofGaps > 0 && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                          Add footage to the {proofGaps > 1 ? `${proofGaps} highlighted scenes` : "highlighted scene"} first.
                        </div>
                      )}
                      {asm?.state === "error" && <div className="err">{asm.error}</div>}
                      {ticket.clip_url && asm?.state !== "running" && (
                        <div className="reel-out">
                          <div className="muted" style={{ fontSize: 12.5 }}>Done! Here's your video:</div>
                          <video src={api.ticketDownloadUrl(tid)} controls playsInline className="reel-video" />
                          <button className="primary" onClick={() => downloadFile(api.ticketDownloadUrl(tid), safeFileName(ticket.angle || "reel"), toast)}>⬇ Save video</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>


                <details className="vw-card vw-aside" open={beats.length === 0}>
                  <summary>✨ AI draft <span className="muted">— no script yet?</span></summary>
                  <div className="muted" style={{ fontSize: 12.5, margin: "8px 0" }}>
                    Normally you paste the script you already wrote (“Paste a script” by the scenes).
                    This writes a rough one for you instead.
                  </div>
                  <div className="ai-row" style={{ margin: 0 }}>
                    <button onClick={runScript} disabled={!!aiBusy}>{aiBusy === "script" ? "Writing…" : "Write my script"}</button>
                    <button onClick={runHooks} disabled={!!aiBusy}>{aiBusy === "hook" ? "Thinking…" : "Suggest first lines"}</button>
                  </div>
                  {hooks && (
                    <div className="hook-options">
                      <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Tap one to use it:</div>
                      {hooks.map((h, i) => <button key={i} className="hook-chip" onClick={() => pickHook(h)}>{h}</button>)}
                    </div>
                  )}
                </details>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

/** Has this scene got per-scene tweaks worth showing without asking?
 *
 *  A scene is "say this, film that". The on-screen title and the caption override are
 *  extras almost nobody sets, and an imported script copies the spoken line straight into
 *  `caption` (intake.parse_script), which rendered as a duplicate of the field right above
 *  it — an echo like that doesn't count as set. Anything genuinely custom keeps the extra
 *  fields open so nothing hides silently.
 */
export const beatHasCustomDetails = (b: { on_screen_text?: string | null; caption?: string | null; spoken_line?: string | null }): boolean => {
  const caption = (b.caption ?? "").trim();
  return !!(b.on_screen_text ?? "").trim() || (!!caption && caption !== (b.spoken_line ?? "").trim());
};

/* One editable beat row (uncontrolled inputs → patch on blur to avoid re-render churn). */
function BeatRow({ b, first, last, onChanged, onReorder, toast }: {
  b: Beat; first: boolean; last: boolean; onChanged: () => void; onReorder: (b: Beat, d: 1 | -1) => void; toast: Notify;
}) {
  const clipInput = useRef<HTMLInputElement>(null);
  const voInput = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState<"" | "clip" | "vo">("");
  const [over, setOver] = useState(false);   // footage dragged from the desktop onto this scene
  // Open only for scenes with real per-scene tweaks — see beatHasCustomDetails.
  const [more, setMore] = useState(() => beatHasCustomDetails(b));
  const save = async (field: keyof Beat, val: string) => {
    if ((b[field] ?? "") === val) return;
    await api.patchBeat(b.id, { [field]: val } as Partial<Beat>); onChanged();
  };
  const toggleProof = async () => { await api.patchBeat(b.id, { is_proof_beat: !b.is_proof_beat }); onChanged(); };
  const del = async () => { await api.deleteBeat(b.id); toast("Beat removed", "ok"); onChanged(); };
  const upClip = async (file?: File) => {
    if (!file) return; setUp("clip");
    try { await api.uploadBeatClip(b.id, file); toast("Clip uploaded", "ok"); onChanged(); }
    catch (e: any) { toast(`Upload failed: ${e?.message || e}`, "err"); } finally { setUp(""); }
  };
  const upVo = async (file?: File) => {
    if (!file) return; setUp("vo");
    try { await api.uploadBeatVoiceover(b.id, file); toast("Voiceover uploaded", "ok"); onChanged(); }
    catch (e: any) { toast(`Upload failed: ${e?.message || e}`, "err"); } finally { setUp(""); }
  };
  return (
    <div className={"beat beat-edit" + (b.is_proof_beat && !b.clip_path ? " beat-warn" : "")}>
      <div className="beat-idx">{b.order_index + 1}</div>
      <div className="beat-body">
        <textarea className="beat-in spoken" rows={2} defaultValue={b.spoken_line} placeholder="What you say out loud…" onBlur={(e) => save("spoken_line", e.target.value)} />
        <input className="beat-in" defaultValue={b.shot_cue} placeholder="What to film…" onBlur={(e) => save("shot_cue", e.target.value)} />
        {more && (
          <div className="beat-details">
            <input className="beat-in" defaultValue={b.on_screen_text} placeholder="Big text on screen…" onBlur={(e) => save("on_screen_text", e.target.value)} />
            <input className="beat-in" defaultValue={b.caption} placeholder="Captions (defaults to what you say)…" onBlur={(e) => save("caption", e.target.value)} />
          </div>
        )}
        <div className="beat-media">
          {/* Drop a file straight from the desktop onto the slot — same as clicking it. */}
          <button className={"slot" + (b.clip_path ? " filled" : "") + (over ? " drop-over" : "")}
            onClick={() => clipInput.current?.click()} disabled={up === "clip"}
            title="Click, or drag a video file onto this scene"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upClip(e.dataTransfer.files?.[0]); }}>
            {up === "clip" ? "…" : b.clip_path ? "✓ Video added" : over ? "Drop it here" : "＋ Add video"}
          </button>
          <button className={"slot" + (b.voiceover_path ? " filled" : "")} onClick={() => voInput.current?.click()} disabled={up === "vo"}>
            {up === "vo" ? "…" : b.voiceover_path ? "✓ Voice added" : "＋ Add voice"}
          </button>
          <input ref={clipInput} type="file" accept="video/*" hidden onChange={(e) => upClip(e.target.files?.[0])} />
          <input ref={voInput} type="file" accept="audio/*" hidden onChange={(e) => upVo(e.target.files?.[0])} />
          <button className="link-btn beat-more" onClick={() => setMore((v) => !v)}
            title="On-screen title and a custom caption for this scene">
            {more ? "Fewer options" : "More options"}
          </button>
        </div>
        {b.is_proof_beat && !b.clip_path && <div className="beat-warn-txt">⚠ This scene says a real number — add a video that shows the product/label</div>}
      </div>
      <div className="beat-ctl">
        <button className="icon-btn" disabled={first} title="Move up" onClick={() => onReorder(b, -1)}>▲</button>
        <button className="icon-btn" disabled={last} title="Move down" onClick={() => onReorder(b, 1)}>▼</button>
        <label className="beat-proof" title="Proof beat (states a real number → needs a proof clip)">
          <input type="checkbox" checked={b.is_proof_beat} onChange={toggleProof} /><span>Proof</span>
        </label>
        <button className="icon-btn danger" title="Delete beat" onClick={del}>🗑</button>
      </div>
    </div>
  );
}

function ReimportBox({ tid, onDone, empty }: { tid: number; onDone: () => void; empty?: boolean }) {
  const [open, setOpen] = useState(!!empty);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!open) return <button className="link-btn" onClick={() => setOpen(true)}>Paste a script</button>;
  const run = async () => {
    setBusy(true);
    try { const r = await api.importScript(tid, script); toast(`Made ${r.beats.length} scenes`, "ok"); setScript(""); setOpen(!!empty); onDone(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="reimport">
      <div className="muted" style={{ fontSize: 12.5 }}>{empty ? "Paste your script — it turns into scenes:" : "This replaces all the scenes below:"}</div>
      <textarea rows={6} value={script} placeholder={"HOOK: the line that stops people scrolling\n\nBEAT\nSpoken: what you say out loud\nShot: what to film"} onChange={(e) => setScript(e.target.value)} />
      <div className="modal-actions">
        {!empty && <button onClick={() => setOpen(false)} disabled={busy}>Cancel</button>}
        <button className="primary" onClick={run} disabled={busy || !script.trim()}>{busy ? "Working…" : "Use this script"}</button>
      </div>
    </div>
  );
}

/* ---------------------------- Editor start ----------------------------- */
/* The Editor with nothing open yet — a real editor screen, not a dead end.
 *
 * The preview pane IS the drop target: drag footage onto it and that footage becomes an
 * editable video (transcribed, captioned) that opens in the editor when it's ready. Beside
 * it: the videos you can pick straight back up, and the way to Create if what you have is
 * a script rather than footage. Nothing is auto-placed anywhere — you drop it, you edit it.
 */
function EditorStart({ presets, onOpenClip, onGoCreate }: {
  presets: Presets | null; onOpenClip: (pid: number, cid: number) => void; onGoCreate: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<{ pid: number; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const refresh = () => api.listProjects().then(setProjects).catch(() => {});
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, []);

  // The footage we just dropped: watch it until it's editable, then open it.
  const prepping = pending ? (projects ?? []).find((p) => p.id === pending.pid) ?? null : null;
  // It died on the way in (bad file, no ffmpeg, no model download, …). Hold it on screen
  // with the reason and a Retry: a toast fades, and the drop zone underneath it looked
  // exactly like nothing had ever been uploaded.
  const prepFailed = prepping?.status === "error";
  useEffect(() => {
    if (!pending || !prepping) return;
    if (prepping.status !== "ready") return;
    let alive = true;
    api.getProject(pending.pid).then((d) => {
      if (!alive) return;
      const clip = d.clips[0];
      setPending(null);
      if (clip) onOpenClip(pending.pid, clip.id);
      else toast("That footage came back with nothing to edit", "err");
    }).catch(() => {});
    return () => { alive = false; };
  }, [pending, prepping?.status]);

  const take = async (files: File[]) => {
    const vid = files.find((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
    if (!vid) { toast("Drop a video file here", "err"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("name", vid.name.replace(/\.[^.]+$/, "") || "My footage");
      fd.append("brain", presets?.brains_default ?? "ollama");
      fd.append("transcribe_backend", presets?.transcribe_default ?? "local");
      fd.append("aspect", "9:16");
      fd.append("caption_preset", DEFAULT_PRESET);
      fd.append("mode", "caption");     // one editable video, not a hunt for moments
      fd.append("brand", "");
      fd.append("file", vid);
      const r = await api.createFromUpload(fd);
      setPending({ pid: r.id, name: vid.name });
      toast("Got it — reading the audio so your captions land on the words", "ok");
      refresh();
    } catch (e: any) { toast(`Upload failed: ${e?.message || e}`, "err"); } finally { setUploading(false); }
  };

  const retryPending = async () => {
    if (!pending) return;
    try { await api.retryProject(pending.pid); toast("Retrying…", "ok"); refresh(); }
    catch (e: any) { toast(`Retry failed: ${e?.message || e}`, "err"); }
  };

  const open = async (p: Project) => {
    try {
      const d = await api.getProject(p.id);
      if (d.clips[0]) onOpenClip(p.id, d.clips[0].id);
      else toast("Nothing to edit in that one yet", "info");
    } catch (e: any) { toast(`Couldn't open it: ${e?.message || e}`, "err"); }
  };

  const ready = (projects ?? []).filter((p) => p.status === "ready").slice(0, 8);

  return (
    <div className="page editor-start">
      <div className="page-head">
        <h2>Editor</h2>
        <span className="muted">Drop footage in, then trim it, caption it and give it a look.</span>
      </div>
      <div className="es-body">
        <div
          className={"es-stage" + (dragOver ? " over" : "") + (pending ? " busy" : "")}
          onClick={() => !pending && fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); take(Array.from(e.dataTransfer.files)); }}
        >
          {pending && prepFailed ? (
            <div className="es-prep" onClick={(e) => e.stopPropagation()}>
              <div className="es-icon">⚠️</div>
              <div className="es-title">Couldn't get “{pending.name}” ready</div>
              {prepping?.error && <div className="err" style={{ maxWidth: 420, marginTop: 8 }}>{prepping.error}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="primary" onClick={() => retryPending()}>↻ Retry</button>
                <button onClick={() => { setPending(null); fileInput.current?.click(); }}>Pick another file</button>
              </div>
            </div>
          ) : pending ? (
            <div className="es-prep">
              <div className="es-icon">⏳</div>
              <div className="es-title">Getting “{pending.name}” ready…</div>
              <div className="muted">{prepping?.stage || prepping?.status || "uploading"}…</div>
              <div className="progress" style={{ maxWidth: 260, marginTop: 12 }}><div style={{ width: `${prepping?.progress ?? 5}%` }} /></div>
              <div className="muted es-note">It opens in the editor on its own when it's done.</div>
            </div>
          ) : (
            <div className="es-prep">
              <div className="es-icon">🎬</div>
              <div className="es-title">{uploading ? "Uploading…" : "Drag your footage here"}</div>
              <div className="muted">…or click to pick a file. Your video shows up right here, ready to cut.</div>
            </div>
          )}
          <input ref={fileInput} type="file" accept="video/*" hidden
            onChange={(e) => { if (e.target.files?.length) take(Array.from(e.target.files)); e.target.value = ""; }} />
        </div>

        <div className="es-rail">
          <div className="es-rail-h">Pick up where you left off</div>
          {projects == null ? <div className="muted">Loading…</div>
            : ready.length === 0 ? <div className="muted es-none">Nothing edited yet — drop a video on the left to start.</div>
              : (
                <div className="es-list">
                  {ready.map((p) => (
                    <button className="es-item" key={p.id} onClick={() => open(p)} title="Open in the editor">
                      <img src={api.projectThumbUrl(p.id)} alt="" loading="lazy"
                        onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
                      <span className="es-item-name">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
          <div className="es-script">
            <div className="es-rail-h">Got a script instead?</div>
            <div className="muted">Paste it on Create and it turns into scenes you can film and edit.</div>
            <button className="primary" onClick={onGoCreate}>Go to Create →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Library -------------------------------- */
function Library() {
  const [items, setItems] = useState<ExportItem[] | null>(null);
  const [preview, setPreview] = useState<ExportItem | null>(null);
  const toast = useToast();
  useEffect(() => {
    const load = () => api.listExports().then(setItems).catch(() => setItems([]));
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);
  if (items == null) return <div className="page"><div className="proj-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div></div>;

  // Build folders: group (brand / project) → subgroup (Reels / Clips) → items.
  const folders = new Map<string, Map<string, ExportItem[]>>();
  for (const it of items) {
    const g = it.group || "Other";
    if (!folders.has(g)) folders.set(g, new Map());
    const sub = folders.get(g)!;
    const sg = it.subgroup || "Videos";
    if (!sub.has(sg)) sub.set(sg, []);
    sub.get(sg)!.push(it);
  }
  const dl = (it: ExportItem) => downloadFile(it.download, it.filename || safeFileName(it.title), toast);
  const move = async (kind: string, id: number, folder: string) => {
    try { await api.setExportFolder(kind as "clip" | "reel", id, folder); toast(`Moved to "${folder}"`, "ok"); api.listExports().then(setItems).catch(() => {}); }
    catch (e: any) { toast(`Move failed: ${e?.message || e}`, "err"); }
  };
  const rename = async (oldName: string, newName: string, list: ExportItem[]) => {
    const n = newName.trim();
    if (!n || n === oldName) return;
    try { await Promise.all(list.map((it) => api.setExportFolder(it.kind as "clip" | "reel", it.id, n))); toast(`Renamed to "${n}"`, "ok"); api.listExports().then(setItems).catch(() => {}); }
    catch (e: any) { toast(`Rename failed: ${e?.message || e}`, "err"); }
  };

  return (
    <div className="page">
      <div className="page-head"><h2>Downloads</h2>
        <span className="muted">
          {items.length === 0 ? "Every video you export lands here" : `${items.length} finished video${items.length === 1 ? "" : "s"} · drag a video to move it between folders`}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <div className="big" style={{ fontSize: 28 }}>⬇</div>
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 16 }}>No videos yet</div>
          <div>Make a video and it shows up here, ready to download.</div>
        </div>
      ) : (
        <>
          {[...folders.entries()].map(([group, subs]) => (
            <DownloadFolder key={group} group={group} subs={subs} onPreview={setPreview} onDownload={dl} onMove={move} onRename={(newName, list) => rename(group, newName, list)} />
          ))}
          <NewFolderDrop onMove={move} />
        </>
      )}
      {preview && (
        <VideoModal src={preview.download} title={preview.title}
          onClose={() => setPreview(null)} onDownload={() => dl(preview)} />
      )}
    </div>
  );
}

function DownloadFolder({ group, subs, onPreview, onDownload, onMove, onRename }: {
  group: string; subs: Map<string, ExportItem[]>; onPreview: (it: ExportItem) => void;
  onDownload: (it: ExportItem) => void; onMove: (kind: string, id: number, folder: string) => void;
  onRename: (newName: string, items: ExportItem[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group);
  const cancelRef = useRef(false);
  const total = [...subs.values()].reduce((n, arr) => n + arr.length, 0);
  const items = [...subs.values()].flat();
  const startEdit = () => { setName(group); setEditing(true); };
  const finishEdit = () => {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; return; }
    const n = name.trim();
    if (n && n !== group) onRename(n, items);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); if (d && d.group !== group) onMove(d.kind, d.id, group); } catch { /* not our payload */ }
  };
  return (
    <div className={"dl-folder" + (over ? " drop-over" : "")}
         onDragOver={(e) => { e.preventDefault(); setOver(true); }}
         onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
         onDrop={onDrop}>
      <div className="dl-folder-head">
        {editing ? (
          <input className="dl-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                 onBlur={finishEdit}
                 onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") { cancelRef.current = true; (e.target as HTMLInputElement).blur(); } }} />
        ) : (
          <button className="dl-head-main" onClick={() => setOpen((o) => !o)}>
            <span className="dl-caret">{open ? "▾" : "▸"}</span>
            <span className="dl-folder-ic">📁</span>
            <span className="dl-folder-name" onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}>{group}</span>
          </button>
        )}
        <span className="board-count">{total}</span>
        {!editing && <button className="dl-rename-btn" title="Rename folder" onClick={startEdit}>✏️</button>}
      </div>
      {open && [...subs.entries()].map(([sg, arr]) => (
        <div className="dl-sub" key={sg}>
          <div className="dl-sub-head">{sg} <span className="muted">· {arr.length}</span></div>
          <div className="exp-rows">
            {arr.map((it) => (
              <div className="exp-row" key={`${it.kind}-${it.id}`} draggable
                   onDragStart={(e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: it.kind, id: it.id, group })); e.dataTransfer.effectAllowed = "move"; }}>
                <span className="exp-drag" title="Drag to another folder">⠿</span>
                <div className="exp-row-thumb" onClick={() => onPreview(it)} title="Click to preview">
                  {it.thumb ? <img src={it.thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <div className="exp-noimg sm">🎬</div>}
                  <div className="exp-play sm">▶</div>
                </div>
                <div className="exp-row-main">
                  <div className="exp-title">{it.title}</div>
                  <div className="muted exp-sub"><span className={"exp-kind-tag " + it.kind}>{it.kind}</span> · {it.subtitle}{it.score != null ? ` · ${it.score}` : ""}</div>
                </div>
                <button className="primary exp-dl-row" onClick={() => onDownload(it)}>⬇ Download</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewFolderDrop({ onMove }: { onMove: (kind: string, id: number, folder: string) => void }) {
  const [over, setOver] = useState(false);
  const prompt = usePrompt();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    let d: any;
    try { d = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (!d) return;
    prompt({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create" }).then((name) => {
      if (name) onMove(d.kind, d.id, name);
    });
  };
  return (
    <div className={"dl-newfolder" + (over ? " drop-over" : "")}
         onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      ＋ Drop a video here to make a new folder
    </div>
  );
}

/* ------------------------------- Home ---------------------------------- */
// A project's Home folder: its own `folder`, else caption reels auto-fall into "Reels".
const REELS = "Reels";
const folderOf = (p: Project): string | null => p.folder || (p.mode === "caption" ? REELS : null);

function Home({ presets, onOpen }: { presets: Presets | null; onOpen: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const refresh = () => {
    api.listProjects().then(setProjects).catch(() => {});
    api.listFolders().then(setFolders).catch(() => {});
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, []);

  const del = async (p: Project) => {
    if (!await confirm({ title: "Delete this project?", body: `“${p.name}” and all its files will be removed.`, confirmLabel: "Delete", danger: true })) return;
    try { await api.deleteProject(p.id); toast("Project deleted", "ok"); refresh(); }
    catch (e: any) { toast(`Delete failed: ${e?.message || e}`, "err"); }
  };
  const retry = async (p: Project) => {
    try { await api.retryProject(p.id); toast("Retrying…", "ok"); refresh(); }
    catch (e: any) { toast(`Retry failed: ${e?.message || e}`, "err"); }
  };
  const move = async (pid: number, folder: string) => {
    try { await api.patchProject(pid, { folder }); refresh(); }
    catch (e: any) { toast(`Move failed: ${e?.message || e}`, "err"); }
  };
  const rename = async (p: Project, name: string) => {
    try { await api.patchProject(p.id, { name }); refresh(); }
    catch (e: any) { toast(`Rename failed: ${e?.message || e}`, "err"); }
  };
  const newFolder = async (pid?: number) => {
    const name = (await prompt({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create" }))?.trim();
    if (!name) return;
    try { await api.createFolder(name); if (pid != null) await api.patchProject(pid, { folder: name }); refresh(); toast(`Folder “${name}” created`, "ok"); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); }
  };
  const renameFolder = async (f: Folder) => {
    const name = (await prompt({ title: "Rename folder", defaultValue: f.name, confirmLabel: "Rename" }))?.trim();
    if (!name || name === f.name) return;
    try { await api.renameFolder(f.id, name); refresh(); }
    catch (e: any) { toast(`Rename failed: ${e?.message || e}`, "err"); }
  };
  const deleteFolder = async (f: Folder) => {
    if (!await confirm({ title: `Delete folder “${f.name}”?`, body: "The projects inside move back out — they aren't deleted.", confirmLabel: "Delete folder", danger: true })) return;
    try { await api.deleteFolder(f.id); refresh(); toast("Folder deleted", "ok"); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); }
  };
  const toggle = (name: string) => setExpanded((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

  // Group projects: loose cards + folder buckets (Reels virtual + user folders, even empty).
  const loose: Project[] = [];
  const buckets = new Map<string, Project[]>();
  for (const p of projects ?? []) {
    const f = folderOf(p);
    if (f == null) loose.push(p);
    else (buckets.get(f) ?? buckets.set(f, []).get(f)!).push(p);
  }
  for (const uf of folders) if (!buckets.has(uf.name)) buckets.set(uf.name, []);
  const idByName = new Map(folders.map((f) => [f.name, f.id]));
  const folderNames = [REELS, ...[...buckets.keys()].filter((n) => n !== REELS).sort((a, b) => a.localeCompare(b))]
    .filter((n) => buckets.has(n));

  // Dropping a card on the open grid (not on a folder/tile) → pull it out of any folder.
  const gridDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); if (d?.id != null) move(d.id, ""); } catch { /* */ }
  };

  return (
    <div className="page">
      <NewProject presets={presets} onCreated={refresh} />
      <div className="page-head" style={{ marginTop: 32 }}>
        <h2>Your projects</h2><span className="muted">{projects?.length ?? 0} total</span>
      </div>
      {projects == null ? (
        <div className="proj-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 250 }} />)}</div>
      ) : projects.length === 0 ? (
        <div className="empty">
          <div className="big" style={{ fontSize: 28 }}>★</div>
          <div className="empty-title">No clipped videos yet</div>
          <div>Paste a YouTube link or upload a video above to get your first clips.</div>
        </div>
      ) : (
        <div className="proj-grid" onDragOver={(e) => e.preventDefault()} onDrop={gridDrop}>
          {loose.map((p) => <ProjectCard key={p.id} p={p} onOpen={onOpen} onDelete={del} onRename={rename} onRetry={retry} />)}
          {folderNames.map((name) => (
            <FolderCard key={name} name={name} fid={idByName.get(name)} members={buckets.get(name)!}
              expanded={expanded.has(name)} onToggle={() => toggle(name)} onOpen={onOpen} onDeleteProject={del}
              onRenameProject={rename} onRetryProject={retry} onDropProject={(pid) => move(pid, name)}
              onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} />
          ))}
          <NewFolderTile onCreate={() => newFolder()} onDropProject={(pid) => newFolder(pid)} />
        </div>
      )}
    </div>
  );
}

function FolderCard({ name, fid, members, expanded, onToggle, onOpen, onDeleteProject, onRenameProject, onRetryProject, onDropProject, onRenameFolder, onDeleteFolder }: {
  name: string; fid?: number; members: Project[]; expanded: boolean; onToggle: () => void;
  onOpen: (id: number) => void; onDeleteProject: (p: Project) => void; onRenameProject: (p: Project, n: string) => void;
  onRetryProject: (p: Project) => void;
  onDropProject: (pid: number) => void; onRenameFolder: (f: Folder) => void; onDeleteFolder: (f: Folder) => void;
}) {
  const [over, setOver] = useState(false);
  const folder: Folder | null = fid != null ? { id: fid, name } : null;   // null = virtual Reels (not editable)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); if (d?.id != null) onDropProject(d.id); } catch { /* */ }
  };
  const dnd = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); },
    onDrop,
  };
  if (!expanded) {
    return (
      <div className={"proj-card folder-card" + (over ? " drop-over" : "")} onClick={onToggle} {...dnd} title="Open folder">
        <div className="proj-thumb folder-thumb">
          <span className="folder-emoji">📁</span>
          <span className="folder-count">{members.length}</span>
        </div>
        <div className="proj-body">
          <div className="name">{name}</div>
          <div className="proj-foot">
            <span className="muted tkt-open">▸ Open folder</span>
            {folder && (
              <div className="proj-actions" onClick={(e) => e.stopPropagation()}>
                <button className="sm" title="Rename folder" onClick={() => onRenameFolder(folder)}>✏️</button>
                <button className="sm danger" title="Delete folder" onClick={() => onDeleteFolder(folder)}>🗑</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={"folder-expanded" + (over ? " drop-over" : "")} style={{ gridColumn: "1 / -1" }} {...dnd}>
      <div className="folder-exp-head">
        <button className="dl-head-main" onClick={onToggle}>
          <span className="dl-caret">▾</span><span className="folder-emoji sm">📁</span>
          <span className="dl-folder-name">{name}</span><span className="board-count">{members.length}</span>
        </button>
        {folder && (<>
          <button className="dl-rename-btn" title="Rename folder" onClick={() => onRenameFolder(folder)}>✏️</button>
          <button className="dl-rename-btn" title="Delete folder" onClick={() => onDeleteFolder(folder)}>🗑</button>
        </>)}
      </div>
      {members.length === 0
        ? <div className="cv-lane-empty">Empty — drag a project here to add it.</div>
        : <div className="proj-grid">{members.map((p) => <ProjectCard key={p.id} p={p} onOpen={onOpen} onDelete={onDeleteProject} onRename={onRenameProject} onRetry={onRetryProject} />)}</div>}
    </div>
  );
}

function NewFolderTile({ onCreate, onDropProject }: { onCreate: () => void; onDropProject: (pid: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className={"proj-card folder-card newfolder-card" + (over ? " drop-over" : "")} onClick={onCreate} title="Make a new folder"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); if (d?.id != null) onDropProject(d.id); } catch { /* */ } }}>
      <div className="proj-thumb folder-thumb new"><span className="folder-emoji">＋</span></div>
      <div className="proj-body"><div className="name">New folder</div><div className="muted" style={{ fontSize: 12 }}>Click, or drop a project in</div></div>
    </div>
  );
}

function ProjectCard({ p, onOpen, onDelete, onRename, onRetry }: { p: Project; onOpen: (id: number) => void; onDelete: (p: Project) => void; onRename?: (p: Project, name: string) => void; onRetry?: (p: Project) => void }) {
  const [imgOk, setImgOk] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nm, setNm] = useState(p.name);
  const ready = p.status === "ready";
  const failed = p.status === "error";
  const finishRename = () => { setEditing(false); const v = nm.trim(); if (v && v !== p.name) onRename?.(p, v); };
  return (
    <div className="proj-card" draggable={!editing}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ id: p.id })); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => !editing && ready && onOpen(p.id)}>
      <div className="proj-thumb">
        {ready && imgOk ? <img src={api.projectThumbUrl(p.id)} alt="" onError={() => setImgOk(false)} loading="lazy" draggable={false} />
          : <div className="ph" style={{ fontSize: 30 }}>{p.status === "error" ? "!" : "▦"}</div>}
      </div>
      <div className="proj-body">
        {editing ? (
          <input className="proj-rename" autoFocus value={nm} onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNm(e.target.value)} onBlur={finishRename}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") { setNm(p.name); setEditing(false); } }} />
        ) : (
          <div className="name" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setNm(p.name); setEditing(true); }}>{p.name}</div>
        )}
        <div className="proj-tags"><span className="tag">{p.brain}</span><span className="tag">{p.aspect}</span><span className="tag">{p.caption_preset}</span></div>
        {!ready && !failed && (
          <div><div className="muted" style={{ marginBottom: 5, fontSize: 12.5 }}>{p.stage || p.status}…</div>
            <div className="progress"><div style={{ width: `${p.progress}%` }} /></div></div>
        )}
        <div className="proj-foot">
          {ready ? <span className="badge ready">✓ ready</span> : failed ? <span className="badge error">error</span> : <span className="badge busy">working</span>}
          <div className={"proj-actions" + (failed ? " always" : "")} onClick={(e) => e.stopPropagation()}>
            {ready && <button className="sm" onClick={() => onOpen(p.id)}>Open</button>}
            {failed && onRetry && <button className="sm" title="Run it again — your upload is still here" onClick={() => onRetry(p)}>↻ Retry</button>}
            {onRename && <button className="sm" title="Rename" onClick={() => { setNm(p.name); setEditing(true); }}>✏️</button>}
            <button className="sm danger" title="Delete" onClick={() => onDelete(p)}>🗑</button>
          </div>
        </div>
        {p.error && <div className="err">{p.error}</div>}
      </div>
    </div>
  );
}

function NewProject({ presets, onCreated }: { presets: Presets | null; onCreated: () => void }) {
  const [mode, setMode] = useState<"url" | "file">("url");
  const [genMode, setGenMode] = useState<"moments" | "caption">("moments");
  const [name, setName] = useState(""); const [url, setUrl] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [brain, setBrain] = useState("ollama"); const [aspect, setAspect] = useState("9:16");
  // Caption style is chosen per clip in the editor; every new project starts on the default.
  const preset = DEFAULT_PRESET;
  const [transcribe, setTranscribe] = useState("local");
  const [busy, setBusy] = useState(false); const toast = useToast();
  // Default the transcription + brain picks to the backend defaults (CVIDEO_DEFAULT_TRANSCRIBE /
  // CVIDEO_DEFAULT_BRAIN). Fires once when presets load; the stable dep never clobbers a later pick.
  useEffect(() => { if (presets?.transcribe_default) setTranscribe(presets.transcribe_default); }, [presets?.transcribe_default]);
  useEffect(() => { if (presets?.brains_default) setBrain(presets.brains_default); }, [presets?.brains_default]);

  const submit = async () => {
    if (!name.trim()) { toast("Give your project a name", "err"); return; }
    setBusy(true);
    try {
      // Reels are filed under the one brand name; moments projects aren't brand-owned.
      const reelBrand = genMode === "caption" ? BRAND : "";
      if (mode === "url") {
        if (!url.trim()) { toast("Paste a YouTube URL", "err"); return; }
        await api.createFromUrl({ name, source_url: url, brain, transcribe_backend: transcribe, aspect, caption_preset: preset, mode: genMode, brand: reelBrand });
      } else {
        if (!file) { toast("Choose a video file", "err"); return; }
        const fd = new FormData();
        fd.append("name", name); fd.append("brain", brain); fd.append("transcribe_backend", transcribe); fd.append("aspect", aspect); fd.append("caption_preset", preset); fd.append("mode", genMode); fd.append("brand", reelBrand); fd.append("file", file);
        await api.createFromUpload(fd);
      }
      setName(""); setUrl(""); setFile(null);
      toast(genMode === "caption" ? "Captioning your clip…" : "Project started — finding clips…", "ok");
      onCreated();
    } finally { setBusy(false); }
  };

  const summary = optionsSummary({ genMode, brain, transcribe, aspect });

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Clip a long video</h2>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>Turn one long video into vertical shorts.</div>
        </div>
        <div className="seg">
          <button className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}>YouTube link</button>
          <button className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>Upload file</button>
        </div>
      </div>
      <div className="row">
        <label className="field grow"><span className="field-lab">Project name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My video" /></label>
        {mode === "url" ? (
          <label className="field grow"><span className="field-lab">YouTube URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" /></label>
        ) : (
          <label className="field grow"><span className="field-lab">Video file</span><input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        )}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <label className="field grow"><span className="field-lab">What do you want?</span>
          <div className="seg" style={{ marginTop: 4 }}>
            <button className={genMode === "moments" ? "on" : ""} onClick={() => setGenMode("moments")}>Find viral moments</button>
            <button className={genMode === "caption" ? "on" : ""} onClick={() => setGenMode("caption")}>Just caption my clip</button>
          </div>
        </label>
      </div>
      {/* Brain / transcription / aspect were the loudest thing on the landing screen, and the
          defaults are right nearly always. Folded away, with the current picks summarised so
          nothing is hidden. Caption style isn't here at all: it's a per-clip look you pick in
          the editor, where you can see it, not a project-wide guess made before any clip exists. */}
      <details className="np-more">
        <summary>Options <span className="muted">· {summary}</span></summary>
        <div className="row" style={{ marginTop: 12 }}>
          {genMode === "moments" && <label className="field"><span className="field-lab">Brain</span><select value={brain} onChange={(e) => setBrain(e.target.value)}>{(presets?.brains ?? ["ollama"]).map((b) => <option key={b} value={b}>{brainLabel(b)}</option>)}</select></label>}
          <label className="field"><span className="field-lab">Transcription</span><select value={transcribe} onChange={(e) => setTranscribe(e.target.value)}>{(presets?.transcribe ?? ["local"]).map((t) => <option key={t} value={t}>{t === "local" ? "Local (free)" : "ElevenLabs"}</option>)}</select></label>
          <label className="field"><span className="field-lab">Shape</span><select value={aspect} onChange={(e) => setAspect(e.target.value)}>{(presets?.aspects ?? ["9:16"]).map((a) => <option key={a}>{a}</option>)}</select></label>
        </div>
        {/* Captioning a clip has almost nothing to set here on purpose — the look of the
            captions, the trim, titles and effects are all per-clip things you do once you can
            see the video. Say so, so this short list doesn't read as "that's all you get". */}
        {genMode === "caption" && <div className="muted np-editor-note">✏️ Caption style, trims, titles and effects come next — open the finished clip in the <b>Editor</b> to style it.</div>}
      </details>
      <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
        <button className="primary" disabled={busy} onClick={submit}>{busy ? "Starting…" : genMode === "caption" ? "Caption my clip" : "Generate clips"}</button>
      </div>
    </div>
  );
}

const BRAIN_LABELS: Record<string, string> = {
  claude: "Claude (smartest)", ollama: "Local (free)", gemini: "Gemini",
};
/** Anything the backend offers that we have no friendly name for is the heuristic scorer. */
export const brainLabel = (b: string) => BRAIN_LABELS[b] ?? "Basic (no AI)";

/** The folded-away Options summary — so a non-default pick is still visible at a glance. */
export const optionsSummary = (o: { genMode: string; brain: string; transcribe: string; aspect: string }) =>
  [o.genMode === "moments" ? brainLabel(o.brain) : null,
   o.transcribe === "local" ? "local transcription" : "ElevenLabs",
   o.aspect].filter(Boolean).join(" · ");

/* ---------------------------- Moments grid ----------------------------- */
function MomentsGrid({ pid, onName, onEdit, onEditReel, onBack }: {
  pid: number; onName: (s: string) => void; onEdit: (cid: number) => void; onEditReel?: (cid: number) => void; onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const toast = useToast();
  const confirm = useConfirm();
  const refresh = () => api.getProject(pid).then((d) => { setProject(d.project); setClips(d.clips); onName(d.project.name); }).catch(() => {});
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [pid]);

  // A reel (caption mode) is a single video, not a project of clips — open it straight in
  // the editor every time, with Back → Home (a per-mount guard avoids re-firing; Back
  // goes Home so there's no project↔editor loop).
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && project?.mode === "caption" && project.status === "ready" && clips.length >= 1) {
      opened.current = true;
      (onEditReel ?? onEdit)(clips[0].id);
    }
  }, [project, clips]);

  const sorted = [...clips].sort((a, b) => b.score - a.score);
  const act = async (fn: () => Promise<any>, msg: string) => {
    try { await fn(); toast(msg, "ok"); refresh(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><button className="back" onClick={onBack}>← Clipping</button>
          <h2 style={{ marginTop: 4 }}>{project?.name}</h2></div>
        <span className="muted">{clips.length} moments · sorted by viral score</span>
      </div>
      {!project ? <div className="skeleton" style={{ height: 300 }} /> : (
        <div className="moments-grid">
          {sorted.map((c) => (
            <MomentCard key={c.id} clip={c} onEdit={() => onEdit(c.id)}
              onRender={() => act(() => api.renderClip(c.id), "Exporting…")}
              onDelete={async () => { if (await confirm({ title: "Delete this clip?", body: c.title ? `“${c.title}”` : undefined, confirmLabel: "Delete", danger: true })) act(() => api.deleteClip(c.id), "Clip deleted"); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function fmtR(a: number, b: number) {
  const f = (t: number) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`; };
  return `${f(a)} – ${f(b)}`;
}

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

const clipFileName = (title: string) =>
  `${(title || "clip").replace(/[\\/:*?"<>|]+/g, " ").trim() || "clip"}.mp4`;
const safeFileName = (title: string) =>
  `${(title || "export").replace(/[\\/:*?"<>|]+/g, " ").trim() || "export"}.mp4`;

/* Download any server file. On Chromium it saves STRAIGHT into the user's
   remembered export folder (picked once, persisted in IndexedDB) — no dialog
   after the first time. If no folder is set yet it prompts once. Firefox/Safari
   fall back to a normal browser download. */
async function downloadFile(url: string, name: string, notify?: Notify) {
  if (exportDirSupported()) {
    try {
      let dir = await getExportDir();          // remembered folder (re-verifies permission)
      if (!dir) dir = await pickExportDir();    // first time → choose + remember
      if (!dir) return;                         // user cancelled the folder picker
      const fileHandle = await dir.getFileHandle(name, { create: true });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`server ${res.status}`);
      const writable = await fileHandle.createWritable();
      if (res.body) await res.body.pipeTo(writable);
      else { await writable.write(await res.blob()); await writable.close(); }
      notify?.(`Saved to "${dir.name}"`, "ok");
    } catch (err: any) {
      notify?.(`Save failed: ${err?.message || err}`, "err");
    }
    return;
  }
  // Fallback (Firefox/Safari): normal download to the browser's download location.
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`server ${res.status}`);
    const objUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = objUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    notify?.("Downloaded", "ok");
  } catch (err: any) {
    notify?.(`Download failed: ${err?.message || err}`, "err");
  }
}

const downloadClip = (cid: number, title: string, notify?: Notify) =>
  downloadFile(api.downloadUrl(cid), clipFileName(title), notify);

function MomentCard({ clip, onEdit, onRender, onDelete }: {
  clip: Clip; onEdit: () => void; onRender: () => void; onDelete: () => void;
}) {
  const rendered = clip.status === "rendered";
  const busy = clip.status === "rendering";
  const toast = useToast();
  const scoreCls = clip.score >= 75 ? "hi" : clip.score >= 50 ? "mid" : "lo";
  return (
    <div className="moment-card">
      <div className="moment-thumb" onClick={onEdit}>
        <img src={api.clipThumbUrl(clip.id)} alt="" loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
        <div className="moment-play">▶</div>
        <span className="moment-time">{fmtR(clip.start, clip.end)}</span>
        {rendered && <span className="moment-flag">Exported</span>}
        {busy && <span className="moment-flag busy">{clip.stage || "Rendering"}…</span>}
      </div>
      <div className="moment-body">
        <div className="moment-scorerow">
          <div className={"viral " + scoreCls}><b>{Math.round(clip.score)}</b><span>/100</span></div>
          <div className="moment-actions">
            <button className="sm" onClick={onEdit} title="Edit">✎</button>
            {rendered && <button className="sm" title="Download" onClick={() => downloadClip(clip.id, clip.title, toast)}>⬇</button>}
            <button className="sm" onClick={onRender} disabled={busy} title="Export">{busy ? "…" : "⤓"}</button>
            <button className="sm danger" onClick={onDelete} title="Delete">🗑</button>
          </div>
        </div>
        <div className="moment-title">{clip.title}</div>
        {clip.hook && <div className="moment-hook">“{clip.hook}”</div>}
        <div className="moment-reason">{clip.reason}</div>
        {clip.error && <div className="err">{clip.error}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Editor --------------------------------- */
function EditorPage({ pid, cid, presets, onName, onBack, onMissing }: {
  pid: number; cid: number; presets: Presets | null; onName: (s: string) => void; onBack: () => void;
  onMissing?: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  // "Gone" is only ever the backend answering — a 404, or a project that no longer lists this
  // clip. An unreachable server keeps us on the skeleton (the offline banner explains that
  // one), because bouncing out of an editor over a dropped request would be worse.
  const [gone, setGone] = useState(false);
  const refresh = () => api.getProject(pid).then((d) => {
    setProject(d.project); onName(d.project.name);
    const c = d.clips.find((c) => c.id === cid) || null;
    setClip(c);
    if (!c) setGone(true);
  }).catch((e) => { if (isNotFound(e)) setGone(true); });
  useEffect(() => {
    setGone(false);
    refresh(); api.getWords(pid).then((d) => setWords(d.words)).catch(() => {});
    const t = setInterval(refresh, 3000); return () => clearInterval(t);
  }, [pid, cid]);
  useEffect(() => { if (gone) onMissing?.(); }, [gone]);

  if (!project || !clip) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
  return <ClipEditor key={clip.id} pid={pid} clip={clip} words={words} duration={project.duration} presets={presets} onChange={refresh} onBack={onBack} />;
}

function fmt(t: number) { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${s.toString().padStart(2, "0")}`; }

function ClipEditor({ pid, clip, words, duration, presets, onChange, onBack }: {
  pid: number; clip: Clip; words: Word[]; duration: number; presets: Presets | null; onChange: () => void; onBack: () => void;
}) {
  const presetMap = presets?.caption_styles ?? FALLBACK_PRESETS;
  const jsonOr = <T,>(s: string | undefined, fb: T): T => { if (s) { try { return JSON.parse(s); } catch { /* */ } } return fb; };
  const baseStyle = presetMap[clip.caption_preset] ?? FALLBACK_PRESETS[DEFAULT_PRESET];
  const initEffects: ClipEffects = jsonOr(clip.effects_json, {} as ClipEffects);
  const initDoc: EditDoc = {
    start: clip.start, end: clip.end, preset: clip.caption_preset,
    style: jsonOr(clip.style_json, baseStyle),
    words: jsonOr(clip.words_json, wordsInRange(words, clip.start, clip.end)),
    center: clip.crop_center, resolution: clip.resolution ?? "1080p", title: clip.title,
    cuts: jsonOr(clip.cuts_json, [] as [number, number][]),
    splits: jsonOr(clip.splits_json, [] as number[]),
    look: initEffects.look ?? { id: "none", strength: DEFAULT_STRENGTH },
    bigTitle: initEffects.title ?? emptyTitle(),
  };
  const { doc, set, reset, undo, redo, canUndo, canRedo } = useHistory<EditDoc>(initDoc);
  const confirm = useConfirm();
  // Snapshot of the doc exactly as it opened (captured once — initDoc recomputes from the
  // clip prop, which the poll mutates after autosave). Powers "Revert to opened".
  const openedDoc = useRef(initDoc);

  const [tool, setTool] = useState<string>("subs");
  // Captions owns every text-on-screen control. "Where do I get the huge text?" is a
  // captions question in everyone's head, and the answer is a subtitle style, not a tool.
  const [subsTab, setSubsTab] = useState<"style" | "edit">("style");
  // Multi-clip timeline: which block is selected + transient split marks (a no-gap
  // split that isn't stored in start/end/cuts — see applySplits).
  const [selClip, setSelClip] = useState<number | null>(null);
  // Resync captions from the transcript when the clip range moves to a new section.
  // Saved words are respected on open; once the user hand-edits words this session,
  // we stop auto-resyncing so their edits aren't clobbered by a later trim.
  const [manualWords, setManualWords] = useState<boolean>(false);
  // Opt-in AI auto-effects (zoom/sfx). Emphasis/emoji live on doc.words; these drive the preview.
  const [effects, setEffects] = useState<ClipEffects>(() => initEffects);
  const [time, setTime] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [boxH, setBoxH] = useState(560);
  // Start zoomed in when the clip is a small slice of a long source, so it isn't
  // a thin sliver in the full-source timeline (otherwise show the whole thing).
  const [zoom, setZoom] = useState(() => {
    const len = clip.end - clip.start, dur = duration || 0;
    if (dur <= 0 || len <= 0 || len >= 0.4 * dur) return 1;
    const cap = Math.min(20, Math.max(4, Math.ceil(dur / 30)));
    return Math.min(cap, Math.max(1, Math.round((dur / len) * 0.5)));
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoBusy, setAutoBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Scene boundaries (when this clip was stitched from a reel's scenes).
  const markers: { start: number; end: number; label: string }[] = jsonOr(clip.markers_json, []);
  // Recorded voiceover for this clip (layered in preview, muxed on export).
  const [voUrl, setVoUrl] = useState<string | null>(clip.voiceover_path ? api.clipVoiceoverUrl(clip.id) + "?t=" + Date.now() : null);
  // Per-scene voice (reel clips with scene markers).
  const hasScenes = markers.length > 0;
  const [sceneIdx, setSceneIdx] = useState(0);
  const [readRate, setReadRate] = useState(1);
  const [sceneVos, setSceneVos] = useState<(string | null)[]>(() => jsonOr(clip.scene_vo_json, [] as (string | null)[]));
  const [voBust, setVoBust] = useState(0);   // cache-buster for scene VO audio after re-record
  const [previewMode, setPreviewMode] = useState<"off" | "scene" | "reel">("off");
  const loopRangeRef = useRef<{ s: number; e: number; rec?: boolean } | null>(null);
  const recordEndRef = useRef<(() => void) | null>(null);   // fired when a recording take reaches the clip end
  const previewTimer = useRef<number | undefined>(undefined);
  const previewChain = useRef(false);
  const activeScene = hasScenes ? markers[Math.min(sceneIdx, markers.length - 1)] : null;
  const applySceneVos = (v: (string | null)[]) => { setSceneVos(v); setVoBust((b) => b + 1); };

  // Seed captions when the transcript arrives after mount and nothing is loaded yet.
  useEffect(() => {
    if (!manualWords && doc.words.length === 0 && words.length) set({ words: wordsInRange(words, clip.start, clip.end) });
  }, [words]);

  // Captions STAY when you trim or cut — we never silently replace them (that used
  // to wipe captions when you moved the clip). To instead pull the transcript text
  // for the current section, the "Match captions to this part" button calls this.
  const resyncCaptions = async () => {
    if (!words.length) return;
    const next = wordsInRange(words, doc.start, doc.end);
    // Guard: if the user has hand-edited captions, don't clobber them without a heads-up.
    const changed = JSON.stringify(next.map((w) => w.word)) !== JSON.stringify(doc.words.map((w) => w.word));
    if (changed && doc.words.length && !await confirm({
      title: "Replace your captions?",
      body: "This swaps the current captions for the transcript text of the trimmed section. You can undo it with Ctrl+Z.",
      confirmLabel: "Replace",
    })) return;
    setManualWords(false); set({ words: next });
  };
  const revertToOpened = async () => {
    if (!await confirm({
      title: "Revert to how it opened?",
      body: "Discards every edit you made this session (trims, cuts, captions, style) and restores the clip to the state it was in when you opened it.",
      confirmLabel: "Revert", danger: true,
    })) return;
    reset(openedDoc.current);
    toast("Reverted to how it opened", "ok");
  };

  // STABLE timeline window = the WHOLE source video, so trimming can reach ANY
  // part of it (not just a margin around the current clip). Navigated by zoom +
  // horizontal scroll. Depends only on duration, so it never jumps mid-trim.
  const win = useMemo(() => ({ s: 0, e: Math.max(duration || 0, clip.end, 2) }), [clip.id, duration]);
  const maxZoom = Math.min(20, Math.max(4, Math.ceil((duration || 0) / 30)));
  // The kept "clips" the timeline shows — derived from the trim range + cuts.
  const segments = useMemo(() => keptSegments(doc.start, doc.end, doc.cuts), [doc.start, doc.end, doc.cuts]);
  // Captions retimed onto the edited (post-cut) timeline so the PREVIEW matches the
  // EXPORT exactly — captions always continue after a cut, never disappear.
  const editedWords = useMemo(() => remapWords(doc.words, segments), [doc.words, segments]);

  // The first frame that survives trimming/cuts — where the clip (and any recording)
  // should actually begin, even if a leading part was cut away.
  const clipStart = useMemo(() => (segments.length ? segments[0][0] : doc.start), [segments, doc.start]);
  // For a stitched reel, each SCENE is its own editable clip on the timeline — split the
  // kept video at every scene boundary so you see (and trim/cut) 3 clips, not one. Scene
  // boundaries come from the persistent markers, so the per-scene blocks always reappear.
  const sceneBounds = useMemo(() => hasScenes
    ? markers.slice(1).map((m) => m.start).filter((s) => s > clipStart + 0.05 && s < doc.end - 0.05)
    : [], [hasScenes, markers, clipStart, doc.end]);
  const blocks = useMemo(() => applySplits(segments, [...doc.splits, ...sceneBounds]), [segments, doc.splits, sceneBounds]);
  const allowAdd = !hasScenes;   // can't drop an external clip into a stitched reel
  // Every block mutation funnels through set(docFromClips()) so doc.start/end/cuts
  // stays canonical (preview, thumbnails, autosave, undo/redo, render all unchanged).
  const commitClips = (next: Seg[]) => set(docFromClips(next));
  const onTrimClip = (i: number, edge: "start" | "end", t: number) => {
    commitClips(trimClip(blocks, i, edge, snapTrim(words, t, edge === "end"), win.s, win.e));
  };
  const onDeleteClip = (i: number) => {
    // Deleting a block re-derives start/end/cuts; clear splits (their geometry changed).
    set({ ...docFromClips(deleteClip(blocks, i)), splits: [] }); setSelClip(null);
  };
  const onAddClip = (a: number, b: number) => { if (allowAdd) commitClips(addClip(blocks, a, b, win.s, win.e)); };
  const addClipAtPlayhead = () => onAddClip(time, Math.min(time + 3, win.e));
  const splitAtPlayhead = () => {
    const i = blocks.findIndex(([a, b]) => time > a && time < b);
    if (i >= 0 && splitClip(blocks, i, time) !== blocks) set({ splits: [...doc.splits, time].sort((x, y) => x - y) });
  };
  const matchCaptionsToClips = () => { if (words.length) { setManualWords(false); set({ words: blocks.flatMap(([a, b]) => wordsInRange(words, a, b)) }); } };

  // Autosave (debounced) whenever the doc changes.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSaveState("saving");
    const id = setTimeout(async () => {
      try {
        await api.patchClip(clip.id, { start: doc.start, end: doc.end, caption_preset: doc.preset, resolution: doc.resolution, crop_center: doc.center, style: doc.style, words: doc.words, title: doc.title, cuts: doc.cuts, splits: doc.splits, effects: { ...effects, look: doc.look, title: doc.bigTitle } });
        setSaveState("saved"); onChange();
      } catch {
        // Backend down / request failed — surface it instead of silently pretending we saved.
        setSaveState("error");
      }
    }, 800);
    return () => clearTimeout(id);
  }, [doc]);

  useEffect(() => { if (boxRef.current) setBoxH(boxRef.current.clientHeight); });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const lr = loopRangeRef.current;
        // ONE logical playhead. We compute where the playhead should be (`t`), seek the
        // video there only if it drifted, and drive the UI from `t` — NOT from a stale
        // read of v.currentTime right after a seek (that jitter flashed the wrong caption
        // at every cut). At a cut we jump to the exact next-segment start `b` (no 0.12
        // overshoot that used to swallow the first sliver of kept video/caption).
        let t = v.currentTime;
        let stop = false;
        if (lr && lr.rec) {
          // RECORDING: roll once from the trim start to the clip end, then STOP (no loop).
          for (const [a, b] of doc.cuts) { if (t >= a && t < b) { t = b; break; } }
          if (t >= lr.e) {
            v.pause(); stop = true;
            const cb = recordEndRef.current; recordEndRef.current = null;
            cb?.();                          // auto-stop: hand off to the panel's Stop flow
          }
        } else if (lr) {
          // Scene PREVIEW: loop within the scene while its voice plays once (skip cuts).
          if (t >= lr.e || t < lr.s - 0.05) t = lr.s;
          else { for (const [a, b] of doc.cuts) { if (t >= a && t < b) { t = b >= lr.e - 0.05 ? lr.s : b; break; } } }
        } else {
          // Normal preview: loop the kept range, jump cleanly over cuts.
          if (t >= doc.end) t = clipStart;
          else { for (const [a, b] of doc.cuts) { if (t >= a && t < b) { t = b; break; } } }
          const au = audioRef.current;
          if (au && voUrl) { const want = t - doc.start; if (Math.abs(au.currentTime - want) > 0.25) au.currentTime = Math.max(0, want); }
        }
        if (!stop && Math.abs(t - v.currentTime) > 0.001) v.currentTime = t;
        setTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, doc.start, doc.end, doc.cuts, clipStart, voUrl]);

  // keyboard undo/redo
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [undo, redo]);

  const onLoaded = () => { if (videoRef.current) videoRef.current.currentTime = doc.start; };
  // Keep the preview parked at the (possibly trimmed) clip start. When a trim moves
  // the kept range and we're idle, re-seek so the visible frame — and the NEXT
  // recording — begin at the trimmed start, not the old pre-trim position (otherwise
  // the video sat on the untrimmed frame and the take jumped at record time).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing || recording) return;
    if (v.currentTime < clipStart - 0.01 || v.currentTime > doc.end + 0.01) { v.currentTime = clipStart; setTime(clipStart); }
  }, [clipStart, doc.end]);
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    // A reel with recorded scene voices: the main Play plays the WHOLE thing WITH the
    // voices (so you don't have to hit a separate "play with voice" button).
    if (hasScenes && sceneVos.some(Boolean)) {
      if (previewMode !== "off" || playing) stopPreview();
      else {
        // start from the scene under the PLAYHEAD, not always scene 0
        let i = 0;
        for (let k = markers.length - 1; k >= 0; k--) { if (time >= markers[k].start - 0.05) { i = k; break; } }
        playReel(i);
      }
      return;
    }
    const au = audioRef.current;
    if (playing) { v.pause(); au?.pause(); setPlaying(false); }
    else {
      if (v.currentTime < doc.start || v.currentTime > doc.end) v.currentTime = doc.start;
      v.muted = !!voUrl;                       // VO replaces the source audio in preview
      if (au && voUrl) { au.currentTime = Math.max(0, v.currentTime - doc.start); au.play().catch(() => {}); }
      v.play(); setPlaying(true);
    }
  };
  // Spacebar = play/pause, like every video editor — but never while the user is
  // typing in a field (title, caption words, number inputs). A ref keeps the
  // listener pointed at the latest togglePlay without re-binding every render.
  const togglePlayRef = useRef(togglePlay); togglePlayRef.current = togglePlay;
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const h = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) { e.preventDefault(); togglePlayRef.current(); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  const seek = (t: number) => {
    // Skip into a removed (cut) chunk — jump past it so cuts behave as deleted.
    for (const [a, b] of doc.cuts) { if (t >= a && t < b) { t = b; break; } }
    if (videoRef.current) videoRef.current.currentTime = t; setTime(t);
  };
  // Recording: roll the video over a range (a scene, or the whole clip) — muted, at
  // the chosen reading rate — so the teleprompter scrolls while you read.
  const startRecordPlayback = async (range?: { s: number; e: number }, onEnd?: () => void, startMic?: () => Promise<boolean>) => {
    const v = videoRef.current; if (!v) return;
    // stop any preview that's running
    previewChain.current = false; window.clearTimeout(previewTimer.current);
    const a = audioRef.current; if (a) { a.pause(); a.onended = null; } setPreviewMode("off");
    // Honor the trim. For a reel, a scene's range comes from the ORIGINAL markers, which
    // ignore a trim — so clamp any range to the kept [clipStart, doc.end]. A scene that
    // begins before the trimmed start now records FROM the trim, not the old scene start.
    const r0 = range ?? { s: clipStart, e: doc.end };
    const rs = Math.max(r0.s, clipStart), re = Math.min(r0.e, doc.end);
    const r = re - rs > 0.1 ? { s: rs, e: re } : { s: clipStart, e: doc.end };
    v.muted = true; v.playbackRate = readRate;
    // 1) Park the video ON the trimmed clip start and WAIT for the seek to land FIRST,
    //    so the visible frame is the trimmed start — not the old pre-trim frame the
    //    video may have been sitting on while the mic spun up.
    await new Promise<void>((res) => {
      if (Math.abs(v.currentTime - r.s) < 0.05) return res();
      let done = false;
      const onSeeked = () => { if (done) return; done = true; v.removeEventListener("seeked", onSeeked); res(); };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = r.s;
      window.setTimeout(onSeeked, 600);   // fallback if 'seeked' never fires
    });
    // 2) Now spin up the mic — the video is already sitting on the right frame.
    if (startMic) { const ok = await startMic(); if (!ok) { stopRecordPlayback(); return; } }
    // 3) Roll: the take begins exactly at the trimmed start, in sync with the mic.
    loopRangeRef.current = { s: r.s, e: r.e, rec: true };   // rec → stop at end, don't loop
    recordEndRef.current = onEnd ?? null;
    v.play().catch(() => {}); setPlaying(true); setRecording(true);
  };
  const stopRecordPlayback = () => {
    const v = videoRef.current; if (v) { v.pause(); v.playbackRate = 1; }
    loopRangeRef.current = null; recordEndRef.current = null; setPlaying(false); setRecording(false);
  };
  // ---- Scene preview engine: play a scene (or the whole reel) with the recorded
  // voice over each scene's video. The video loops within a scene while its voice
  // plays once; on voice end (or, for a voiceless scene, after its natural length)
  // we advance to the next scene when chaining the whole reel.
  const stopPreview = () => {
    previewChain.current = false; window.clearTimeout(previewTimer.current);
    const v = videoRef.current; if (v) v.pause();
    const a = audioRef.current; if (a) { a.pause(); a.onended = null; }
    loopRangeRef.current = null; setPlaying(false); setPreviewMode("off");
  };
  const runScene = (i: number) => {
    const m = markers[i]; const v = videoRef.current; const a = audioRef.current;
    if (!m || !v) { stopPreview(); return; }
    // Honor the trim: clamp the scene to the kept [clipStart, doc.end] so preview matches
    // recording + export. A scene trimmed away is skipped.
    const s = Math.max(m.start, clipStart), e = Math.min(m.end, doc.end);
    const advance = () => { if (previewChain.current && i + 1 < markers.length) runScene(i + 1); else stopPreview(); };
    if (e - s < 0.2) { advance(); return; }
    setSceneIdx(i);
    loopRangeRef.current = { s, e };
    v.currentTime = s; v.muted = true; v.playbackRate = 1; v.play().catch(() => {});
    setPlaying(true);
    window.clearTimeout(previewTimer.current);
    if (sceneVos[i] && a) {
      a.onended = advance; a.src = api.sceneVoiceoverUrl(clip.id, i) + "?v=" + voBust;
      a.currentTime = 0; a.play().catch(() => {});
    } else {
      if (a) a.onended = null;
      previewTimer.current = window.setTimeout(advance, Math.max(400, (e - s) * 1000));
    }
  };
  const playScene = (i: number) => { previewChain.current = false; setPreviewMode("scene"); runScene(i); };
  const playReel = (startIdx = 0) => { previewChain.current = true; setPreviewMode("reel"); runScene(startIdx); };
  const selectScene = (i: number) => { if (previewMode !== "off") stopPreview(); const j = Math.max(0, Math.min(i, markers.length - 1)); setSceneIdx(j); if (markers[j]) seek(Math.max(markers[j].start, clipStart)); };
  const choosePreset = (name: string) => set({ preset: name, style: presetMap[name] ?? FALLBACK_PRESETS[DEFAULT_PRESET] });
  const doAutoCenter = async () => { setAutoBusy(true); try { const r = await api.autoCenter(clip.id); set({ center: r.center }); toast("Centered on the speaker", "ok"); } catch { toast("Auto-center failed", "err"); } finally { setAutoBusy(false); } };
  const onPreviewDown = (e: React.PointerEvent) => {
    if (tool !== "reframe") return;
    const move = (ev: PointerEvent) => { const r = boxRef.current!.getBoundingClientRect(); set({ center: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) }); };
    move(e.nativeEvent); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  // Effective (post-cut) length + position, so the timecode shows the real result.
  const removedTotal = doc.cuts.reduce((s, [a, b]) => s + (b - a), 0);
  const removedBefore = (t: number) => doc.cuts.reduce((s, [a, b]) => s + (t >= b ? b - a : t > a ? t - a : 0), 0);
  const effLen = Math.max(0, (doc.end - doc.start) - removedTotal);
  const effPos = Math.max(0, (time - doc.start) - removedBefore(time));
  // ONE clock for every overlay: the playhead in edited (post-cut) time. Captions AND the
  // teleprompter both read this + edited-time words, so cuts compress smoothly instead of
  // the two disagreeing (captions edited, teleprompter source) and flashing at every seam.
  const editedTime = srcToEdited(time, segments);
  // Punch-in zoom preview: match the current SOURCE time against the stored zoom windows.
  const zoomScale = useMemo(() => {
    for (const k of effects.zoom ?? []) if (time >= k.t && time < k.t + k.duration) return k.scale;
    return 1;
  }, [effects, time]);
  // Cinematic Look preview: a CSS approximation of the ffmpeg grade the export burns.
  const layers = useMemo(() => lookLayers(doc.look), [doc.look]);
  const activeTools = useMemo(() => {
    const on = new Set<string>();
    if (doc.look?.id && doc.look.id !== "none") on.add("look");
    // The optional hook line lives inside Captions, so its "you have one" dot goes there.
    if (doc.bigTitle?.text.trim()) on.add("subs");
    if (doc.cuts.length) on.add("cut");
    if ((effects.zoom?.length ?? 0) + (effects.sfx?.length ?? 0) > 0) on.add("fx");
    return on;
  }, [doc.look, doc.bigTitle, doc.cuts, effects]);

  const rendered = clip.status === "rendered";
  const busy = clip.status === "rendering";
  // Instant feedback: disable Export the moment it's clicked, rather than waiting up
  // to 3s for the status poll to report "rendering" (which let a double-click fire two renders).
  const [exporting, setExporting] = useState(false);
  useEffect(() => { if (clip.status === "rendering" || clip.status === "rendered" || clip.status === "error") setExporting(false); }, [clip.status]);
  const exportClip = async () => {
    setExporting(true);
    try { await api.renderClip(clip.id); toast("Exporting clip…", "info"); onChange(); }
    catch (e: any) { setExporting(false); toast(`Export failed: ${e?.message || e}`, "err"); }
  };

  return (
    <div className="ed2">
      <div className="ed2-top">
        <button className="back" onClick={onBack}>← Back</button>
        <input className="ed2-title" value={doc.title} onChange={(e) => set({ title: e.target.value })} placeholder="Untitled clip" />
        <div className="ed2-top-right">
          <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
          <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
          <button className="icon-btn" disabled={!canUndo} onClick={revertToOpened} title="Revert to how this clip opened (discards this session's edits)">⟲</button>
          <span className={"save-ind" + (saveState === "error" ? " save-err" : "")}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : saveState === "error" ? "⚠ Not saved" : ""}
          </span>
          <button className="primary" onClick={exportClip} disabled={busy || exporting}>{busy ? (clip.stage || "Rendering…") : exporting ? "Starting…" : rendered ? "Re-export" : "Export"}</button>
          {rendered && <button className="icon-btn" title="Download" onClick={() => downloadClip(clip.id, doc.title, toast)}>⬇</button>}
        </div>
      </div>

      <div className="ed2-body">
        <div className="ed2-rail">
          {TOOLS.map((t) => (
            <button key={t.id} className={"rail-btn" + (tool === t.id ? " on" : "")} onClick={() => setTool(t.id)} title={t.label}>
              <span className="rail-ic">{t.icon}</span><span className="rail-lb">{t.label}</span>
              {t.soon && <span className="soon-dot" title="Coming soon" />}
              {/* A dot on the rail says "this clip has one" — otherwise a look you set
                  earlier is invisible until you happen to open the panel again. */}
              {activeTools.has(t.id) && <span className="on-dot" title={`${t.label} is on for this clip`} />}
            </button>
          ))}
        </div>

        <div className="ed2-stage">
          <div className={"phone" + (tool === "reframe" ? " reframing" : "")} ref={boxRef} onPointerDown={onPreviewDown}
            style={tool === "reframe" ? undefined : { cursor: "pointer" }}
            onClick={() => { if (tool !== "reframe") togglePlay(); }}
            title={tool === "reframe" ? undefined : "Click or press Space to play / pause"}>
            <video ref={videoRef} src={api.sourceUrl(pid)} onLoadedMetadata={onLoaded} style={{ objectPosition: `${doc.center * 100}% 50%`, transform: zoomScale !== 1 ? `scale(${zoomScale})` : undefined, transition: "transform 0.12s ease-out", filter: layers.filter }} playsInline />
            <audio ref={audioRef} src={hasScenes ? undefined : (voUrl ?? undefined)} preload="auto" />
            {/* The look's tint + vignette sit UNDER the text, exactly like the export
                (ffmpeg grades the picture, then burns the subtitles on top). */}
            {layers.tint && <div className="look-layer" style={{ background: layers.tint.color, opacity: layers.tint.opacity, mixBlendMode: layers.tint.blend as any }} />}
            {layers.vignette > 0 && <div className="look-layer" style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${layers.vignette}) 100%)` }} />}
            <CaptionOverlay words={editedWords} time={editedTime} style={doc.style} containerHeight={boxH} />
            <TitleOverlay title={doc.bigTitle} time={editedTime} style={doc.style} containerHeight={boxH} />
            {tool === "reframe" && <div className="reframe-guide" style={{ left: `${doc.center * 100}%` }} />}
          </div>
          {tool === "voice" && <Teleprompter words={activeScene ? wordsInRange(editedWords, srcToEdited(Math.max(activeScene.start, clipStart), segments), srcToEdited(Math.min(activeScene.end, doc.end), segments)) : editedWords} time={editedTime} maxWords={doc.style.max_words} />}
          <div className="play-row">
            <button className="primary round" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
            <span className="timecode">{fmt(effPos)} / {fmt(effLen)}{removedTotal > 0 ? ` (−${fmt(removedTotal)} cut)` : ""}</span>
            <span className="ar-badge">9:16</span>
          </div>
          {busy && <div className="muted" style={{ fontSize: 12.5 }}>⏳ {clip.stage || "Working"}… (first export downloads the full video)</div>}
          {clip.error && <div className="err">{clip.error}</div>}
        </div>

        <div className="ed2-panel">
          {tool === "cut" && <CutPanel doc={doc} set={set} time={time} onSeek={seek} />}
          {tool === "voice" && (hasScenes
            ? <>
                <WholeReelVoice cid={clip.id} text={doc.words.map((w) => w.word).join(" ")}
                  onGenerated={() => { applySceneVos(markers.map(() => null)); onChange(); }} toast={toast} />
                <SceneVoicePanel cid={clip.id} markers={markers} sceneIdx={Math.min(sceneIdx, markers.length - 1)} onSelectScene={selectScene}
                  sceneVos={sceneVos} setSceneVos={applySceneVos} readRate={readRate} setReadRate={setReadRate}
                  activeScene={activeScene!} onRecordStart={startRecordPlayback} onRecordStop={stopRecordPlayback}
                  previewMode={previewMode} onPlayScene={playScene} onPlayReel={playReel} onStopPreview={stopPreview} onChanged={onChange} toast={toast} />
              </>
            : <VoicePanel cid={clip.id} voUrl={voUrl} text={doc.words.map((w) => w.word).join(" ")} onChanged={(u) => { setVoUrl(u); onChange(); }} toast={toast} onRecordStart={startRecordPlayback} onRecordStop={stopRecordPlayback} />)}
          {tool === "reframe" && <ReframePanel center={doc.center} set={set} autoCenter={doAutoCenter} autoBusy={autoBusy} />}
          {tool === "text" && <TranscriptEditor words={doc.words} cuts={doc.cuts} start={doc.start} end={doc.end}
            time={time} onSeek={seek} onCutsChange={(c) => set({ cuts: c })} />}
          {tool === "look" && <LookPanel look={doc.look} onChange={(l) => set({ look: l })}
            options={presets?.looks ?? FALLBACK_LOOKS} sampleUrl={api.frameUrl(pid, clipStart + 0.5)} />}
          {tool === "fx" && <AIEffectsPanel cid={clip.id}
            onApplied={(w, eff) => { setManualWords(true); set({ words: w }); setEffects(eff); onChange(); }} />}
          {tool === "subs" && (
            <div className="panel-body">
              <div className="seg-toggle wide">
                <button className={subsTab === "style" ? "on" : ""} onClick={() => setSubsTab("style")}>Style</button>
                <button className={subsTab === "edit" ? "on" : ""} onClick={() => setSubsTab("edit")}>Edit words</button>
              </div>
              {subsTab === "style" ? (
                <>
                  {/* The big cinematic text IS the subtitles: it's a style you pick here, made
                      out of the words you already have — never a second thing you have to type. */}
                  <button className={"big-subs-card" + (isBigSubtitleStyle(doc.style) ? " on" : "")}
                    onClick={() => choosePreset("cinematic")}>
                    <span className="big-subs-ic">AA</span>
                    <span>
                      <b>Big cinematic subtitles</b>
                      <span className="muted"> — your words, huge, two at a time, across the frame.{" "}
                        {isBigSubtitleStyle(doc.style) ? "On for this clip." : "Tap to switch."}</span>
                    </span>
                    {isBigSubtitleStyle(doc.style) && <span className="big-subs-on">✓</span>}
                  </button>
                  <div className="field-label">Subtitle style</div>
                  <div className="preset-chips">{(presets?.captions ?? Object.keys(FALLBACK_PRESETS)).map((c) => (
                    <button key={c} className={"chip" + (doc.preset === c ? " on" : "")} onClick={() => choosePreset(c)}
                      title={presetHint(c)}>{presetLabel(c)}</button>))}</div>
                  <StyleEditor style={doc.style} onChange={(s) => set({ style: s })} />
                  <label className="field">Export resolution
                    <select value={doc.resolution} onChange={(e) => set({ resolution: e.target.value })}>
                      {(presets?.resolutions ?? [{ id: "1080p", label: "1080p", hint: "1080×1920" }]).map((r) => (
                        <option key={r.id} value={r.id}>{r.label} · {r.hint}</option>))}
                    </select>
                  </label>
                  {/* Secondary, and deliberately folded away: one extra standalone line, for a
                      hook that isn't in the transcript. Not a tool, not a tab. */}
                  <details className="hook-fold" open={!!doc.bigTitle?.text.trim()}>
                    <summary>
                      Extra hook line (optional)
                      {doc.bigTitle?.text.trim() ? <span className="tab-dot" title="This clip has a hook line" /> : null}
                    </summary>
                    <HookLinePanel title={doc.bigTitle} onChange={(t) => set({ bigTitle: t })}
                      playhead={editedTime} clipLength={effLen} />
                  </details>
                </>
              ) : (
                <>
                  {words.length > 0 && (
                    <button className="sm" style={{ marginBottom: 8 }} onClick={resyncCaptions}
                      title="Replace the captions with the transcript text for the current trimmed section">
                      ↻ Match captions to this part
                    </button>
                  )}
                  <SubtitleWordEditor words={doc.words} time={time} onSeek={seek} onChange={(w) => { setManualWords(true); set({ words: w }); }} />
                </>
              )}
            </div>
          )}
          {COMING_SOON.includes(tool) && <ComingSoon label={TOOLS.find((t) => t.id === tool)?.label || ""} />}
        </div>
      </div>

      <div className="ed2-timeline">
        <div className="tl-zoom">
          <button className="icon-btn" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} title="Zoom out">－</button>
          <span className="muted" style={{ fontSize: 12 }}>{zoom}×</span>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.min(maxZoom, +(z + 0.5).toFixed(1)))} title="Zoom in">＋</button>
        </div>
        <FilmstripTimeline pid={pid} winStart={win.s} winEnd={win.e} clips={blocks} selected={selClip} time={time} zoom={zoom} cuts={doc.cuts} markers={markers}
          allowAdd={allowAdd} onSelectClip={setSelClip} onTrimClip={onTrimClip} onDeleteClip={onDeleteClip} onAddClip={onAddClip} onScrub={seek} />
      </div>
    </div>
  );
}

/* ---------------- wayin-style clip editor helpers ---------------- */
type EditDoc = { start: number; end: number; preset: string; style: CaptionStyle; words: Word[]; center: number; resolution: string; title: string; cuts: [number, number][]; splits: number[];
  /* Cinematic Look (colour grade) + the optional extra hook line. Both live in the clip's
     effects_json, and both are "off" by default so an untouched clip exports unchanged. */
  look: LookSetting; bigTitle: TitleCard };
type Seg = [number, number];

/* Keep a trim handle off the MIDDLE of a spoken word so trimming never chops a
   word's audio (with its caption left dangling). If the dropped time lands inside a
   word, the end handle snaps to that word's END (keep the whole word) and the start
   handle to its START (begin on the whole word). In the silence between words we
   leave the time untouched so fine placement still works. */
// Magnetic snap to a nearby word edge — close enough to land a clean cut on a word boundary,
// but loose enough that dragging stays smooth everywhere else (was: snapped to the word edge
// on ANY position inside a word, which made trimming jump ~1s at a time).
function snapTrim(words: Word[], t: number, isEnd: boolean): number {
  const SNAP = 0.12;   // only snap within 120ms of an edge
  let best = t, bestDist = SNAP;
  for (const w of words) {
    const edge = isEnd ? w.end : w.start;
    const d = Math.abs(t - edge);
    if (d < bestDist) { bestDist = d; best = edge; }
  }
  return best;
}

/* The kept pieces of [start,end] after removing `cuts` — mirrors backend
   render.kept_segments. These are the "clips" the CapCut-style timeline shows. */
function keptSegments(start: number, end: number, cuts: [number, number][]): Seg[] {
  const ranges = (cuts || [])
    .map(([a, b]) => [Math.max(start, Math.min(a, end)), Math.max(start, Math.min(b, end))] as Seg)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: Seg[] = [];
  for (const [a, b] of ranges) {
    if (merged.length && a <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    else merged.push([a, b]);
  }
  const segs: Seg[] = [];
  let cur = start;
  for (const [a, b] of merged) { if (a > cur) segs.push([cur, a]); cur = Math.max(cur, b); }
  if (end > cur) segs.push([cur, end]);
  return segs.length ? segs : [[start, end]];
}

/* ---- Multi-clip timeline helpers ----
   The edit is shown as an ordered list of source sub-ranges ("blocks"). Because the
   blocks stay in source-time order and never overlap, the list is FULLY representable
   by the doc's existing start/end/cuts (the gaps between blocks are the cuts), so the
   preview, caption remap, thumbnails and backend concat render all keep working with
   no backend change. (A future true multi-source timeline would persist a real
   `clips_json` instead of round-tripping through start/end/cuts.) */
const MIN_CLIP = 0.3;

// Blocks -> the doc fields we store. Outer bounds become start/end; the gaps between
// adjacent blocks become cuts. keptSegments(start,end,cuts) reproduces the blocks.
function docFromClips(clips: Seg[]): { start: number; end: number; cuts: [number, number][] } {
  const cl = [...clips].sort((a, b) => a[0] - b[0]);
  const start = cl[0][0], end = cl[cl.length - 1][1];
  const cuts: [number, number][] = [];
  for (let i = 1; i < cl.length; i++) if (cl[i][0] > cl[i - 1][1] + 1e-4) cuts.push([cl[i - 1][1], cl[i][0]]);
  return { start, end, cuts };
}

// Trim one block's edge without crossing its neighbours (order stays fixed).
function trimClip(clips: Seg[], i: number, edge: "start" | "end", t: number, winStart: number, winEnd: number): Seg[] {
  const out = clips.map((c) => [...c] as Seg);
  if (!out[i]) return out;
  const prevEnd = i > 0 ? out[i - 1][1] : winStart;
  const nextStart = i < out.length - 1 ? out[i + 1][0] : winEnd;
  if (edge === "start") out[i][0] = Math.max(prevEnd, Math.min(t, out[i][1] - MIN_CLIP));
  else out[i][1] = Math.min(nextStart, Math.max(t, out[i][0] + MIN_CLIP));
  return out;
}

function deleteClip(clips: Seg[], i: number): Seg[] {
  return clips.length <= 1 ? clips : clips.filter((_, j) => j !== i);
}

// Split block i at time t into two blocks (both halves must be long enough).
function splitClip(clips: Seg[], i: number, t: number): Seg[] {
  const c = clips[i]; if (!c) return clips;
  if (t - c[0] < MIN_CLIP || c[1] - t < MIN_CLIP) return clips;
  return [...clips.slice(0, i), [c[0], t] as Seg, [t, c[1]] as Seg, ...clips.slice(i + 1)];
}

// Add a new block clamped to free space (never overlapping an existing block).
function addClip(clips: Seg[], a: number, b: number, winStart: number, winEnd: number): Seg[] {
  let lo = Math.max(winStart, Math.min(a, b));
  let hi = Math.min(winEnd, Math.max(a, b));
  const sorted = [...clips].sort((x, y) => x[0] - y[0]);
  for (const [s, e] of sorted) if (lo >= s && lo < e) lo = e;        // start inside a block -> push past it
  for (const [s] of sorted) if (s >= lo && s < hi) { hi = s; break; } // a block begins inside [lo,hi) -> stop before it
  if (hi - lo < MIN_CLIP) return clips;
  return [...clips, [lo, hi] as Seg].sort((x, y) => x[0] - y[0]);
}

// Re-apply transient split marks. A split with no gap can't be stored in
// start/end/cuts (keptSegments re-merges it), so the DISPLAYED blocks add it back
// from component state; a mark that no longer lands inside a block is simply ignored.
function applySplits(blocks: Seg[], marks: number[]): Seg[] {
  let out = blocks.map((c) => [...c] as Seg);
  for (const m of marks) {
    const i = out.findIndex(([a, b]) => m > a + 1e-4 && m < b - 1e-4);
    if (i >= 0) out = [...out.slice(0, i), [out[i][0], m] as Seg, [m, out[i][1]] as Seg, ...out.slice(i + 1)];
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/* source time -> edited (compressed) time. Used to retime captions for the preview
   overlay so they match the export (a source time inside a cut maps to the seam). */
function srcToEdited(t: number, segs: Seg[]): number {
  let base = 0;
  for (const [a, b] of segs) {
    if (t < a) return base;            // inside a removed gap -> the seam
    if (t <= b) return base + (t - a);
    base += b - a;
  }
  return base;
}

/* Retime caption words onto the edited timeline. A cut removes the video AND its
   audio, so a word spoken inside a cut is no longer heard — we DROP it (otherwise it
   piled up at the seam and looked like the cut part was "still there"). Words that
   straddle a cut edge are clamped to the seam. Mirrors backend
   render.remap_words_for_cuts so the preview matches the export exactly. */
function remapWords(words: Word[], segs: Seg[]): Word[] {
  return words
    .filter((w) => segs.some(([a, b]) => w.end > a && w.start < b))   // keep only words that overlap kept video
    .map((w) => {
      const s = srcToEdited(w.start, segs);
      let e = srcToEdited(w.end, segs);
      if (e <= s) e = s + 0.15;
      return { ...w, start: s, end: e };
    })
    .sort((x, y) => x.start - y.start);
}

/* Descript-style transcript editor. Edit the video by editing its words: click a word to jump
   there, drag to select a span and press Delete to cut it out of the video; select struck-through
   (already-cut) words and Delete to bring them back. Reuses doc.cuts entirely — the same store
   the Cut/Clips tools, the timeline, the caption preview and the export already honor, so an edit
   here shows up everywhere for free (and undo/redo comes from useHistory). */
function TranscriptEditor({ words, cuts, start, end, time, onSeek, onCutsChange }: {
  words: Word[]; cuts: [number, number][]; start: number; end: number;
  time: number; onSeek: (t: number) => void; onCutsChange: (cuts: [number, number][]) => void;
}) {
  const shown = useMemo(() => annotateWordsWithCuts(
    words.filter((w) => w.end > start + 0.001 && w.start < end - 0.001), cuts),
    [words, cuts, start, end]);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up);
  }, []);

  const activeIdx = shown.findIndex((w) => time >= w.start && time < w.end);
  const range = sel ? ([Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] as const) : null;
  const anchorCut = range ? shown[range[0]].cut : false;
  const cutCount = shown.filter((w) => w.cut).length;

  const applyDelete = () => {
    if (!range) return;
    const span = shown.slice(range[0], range[1] + 1);
    if (!span.length) return;
    const lo = Math.min(...span.map((w) => w.start));
    const hi = Math.max(...span.map((w) => w.end));
    // The anchor word decides intent: cut a live span, or restore a struck-through one.
    onCutsChange(shown[range[0]].cut ? subtractRange(cuts, [lo, hi]) : unionCut(cuts, [lo, hi]));
    setSel(null);
  };
  const onWordDown = (i: number) => { dragging.current = true; setSel({ a: i, b: i }); onSeek(shown[i].start); };
  const onWordEnter = (i: number) => { if (dragging.current) setSel((s) => (s ? { a: s.a, b: i } : { a: i, b: i })); };

  return (
    <div className="panel-body">
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Edit the video by editing its words. <b>Click</b> a word to jump there; <b>drag to select</b>,
        then press <b>Delete</b> to cut it out. Select struck-through words and Delete to bring them back.
      </div>
      {shown.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          No word-timed transcript for this clip yet. (Caption reels stitched without a transcript
          don't carry word timings — use the Cut tool on the timeline instead.)
        </div>
      ) : (
        <>
          <div className="tw-flow" tabIndex={0}
            onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && range) { e.preventDefault(); applyDelete(); } }}>
            {shown.map((w, i) => (
              <span key={i}
                className={"tw-word" + (w.cut ? " tw-cut" : "") + (i === activeIdx ? " tw-active" : "") + (range && i >= range[0] && i <= range[1] ? " tw-sel" : "")}
                onMouseDown={() => onWordDown(i)} onMouseEnter={() => onWordEnter(i)}>
                {w.word}{" "}
              </span>
            ))}
          </div>
          <div className="tw-bar">
            <span className="muted" style={{ fontSize: 12 }}>{cutCount} word{cutCount === 1 ? "" : "s"} cut</span>
            {range && (
              <button className={anchorCut ? "sm" : "sm danger"} onClick={applyDelete}>
                {anchorCut ? "↩ Restore selected" : "⌦ Cut selected"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* 🎨 Cinematic Look — the one control that makes a phone clip look shot, not filmed.
   Six chips, one strength. Everything is plain English: no LUTs, curves or gamma anywhere.
   "None" is the default and produces an export byte-identical to pre-Look CVID. */
function LookPanel({ look, onChange, options, sampleUrl }: {
  look: LookSetting; onChange: (l: LookSetting) => void;
  options: { id: string; label: string; hint: string }[];
  sampleUrl?: string;
}) {
  const strength = look.strength ?? DEFAULT_STRENGTH;
  const active = options.find((o) => o.id === look.id) ?? options[0];
  // Each swatch is a real frame from THIS clip under that look, at the chosen strength —
  // you pick by looking at your own footage, not at an abstract colour chip. If the frame
  // can't be fetched the CSS gradient behind it still reads as the look's palette.
  const [sample, setSample] = useState<string | null>(null);
  useEffect(() => {
    if (!sampleUrl) return;
    const img = new Image();
    img.onload = () => setSample(sampleUrl);
    img.src = sampleUrl;
    return () => { img.onload = null; };
  }, [sampleUrl]);
  return (
    <div className="panel-body">
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Give the whole clip a film-grade colour look. The preview shows it live.
      </div>
      <div className="look-grid">
        {options.map((o) => (
          <button key={o.id} className={"look-card" + (look.id === o.id ? " on" : "")}
            onClick={() => onChange({ id: o.id, strength })}>
            <LookSwatch id={o.id} strength={strength} sample={sample} />
            <b>{o.label}</b><span className="muted">{o.hint}</span>
          </button>
        ))}
      </div>
      {look.id !== "none" && (
        <>
          <div className="field-label" style={{ marginTop: 14 }}>How strong?</div>
          <div className="seg-toggle wide">
            {STRENGTHS.map((sv) => (
              <button key={sv.label} className={Math.abs(strength - sv.value) < 0.01 ? "on" : ""}
                onClick={() => onChange({ id: look.id, strength: sv.value })}>{sv.label}</button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            {active.label} · {active.hint}. Exported exactly as previewed.
          </div>
        </>
      )}
    </div>
  );
}

/* One preset's swatch: this clip's own frame, graded exactly the way the preview grades
   the video (same CSS filter + tint + vignette), so the chips ARE the preview. */
function LookSwatch({ id, strength, sample }: { id: string; strength: number; sample: string | null }) {
  const l = lookLayers({ id, strength });
  return (
    <span className={"look-swatch look-" + id}
      style={sample ? { backgroundImage: `url(${sample})`, filter: l.filter } : undefined}>
      {sample && l.tint && <i className="look-layer"
        style={{ background: l.tint.color, opacity: l.tint.opacity, mixBlendMode: l.tint.blend as any }} />}
      {sample && l.vignette > 0 && <i className="look-layer"
        style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,${l.vignette}) 100%)` }} />}
    </span>
  );
}

/* One optional standalone hook line — for a line that ISN'T in the transcript. The everyday
   big text is the `cinematic` subtitle style above; this is the secondary escape hatch, so it
   lives folded away inside Captions and has no rail tool and no tab of its own.
   Placement is layout (a narrow column hugging an edge, or across the frame), never a
   person-cutout: it can't fail the way matting can, and preview and export agree.
   Returns bare fields — the captions panel already provides the .panel-body wrapper. */
function HookLinePanel({ title, onChange, playhead, clipLength }: {
  title: TitleCard; onChange: (t: TitleCard) => void; playhead: number; clipLength: number;
}) {
  const set = (patch: Partial<TitleCard>) => onChange({ ...title, ...patch });
  const has = !!title.text.trim();
  return (
    <>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        One extra line that isn’t in your transcript — a hook, a name, a stat. Big text
        laid out <b>near the subject</b>, across the frame. Your spoken words already show
        as subtitles; this is on top of them.
      </div>
      <label className="field">What should it say?
        <textarea rows={3} value={title.text} placeholder={"THE ONE HABIT\nTHAT CHANGED\nEVERYTHING"}
          onChange={(e) => set({ text: e.target.value })} />
      </label>
      {has && (
        <>
          <div className="field-label">Where does it sit?</div>
          <div className="preset-chips">
            {TITLE_PLACES.map((p) => (
              <button key={p.id} className={"chip plain" + (title.place === p.id ? " on" : "")}
                onClick={() => set({ place: p.id })}>{p.label}</button>
            ))}
          </div>
          <div className="field-label" style={{ marginTop: 12 }}>How does it look?</div>
          <div className="preset-chips">
            {TITLE_STYLES.map((st) => (
              <button key={st.id} className={"chip plain" + (title.style === st.id ? " on" : "")}
                onClick={() => set({ style: st.id })}>{st.label}</button>
            ))}
          </div>
          <div className="field-label" style={{ marginTop: 12 }}>When does it show?</div>
          <div className="title-when">
            <button className="sm" onClick={() => set({ start: Math.max(0, Math.round(playhead * 10) / 10) })}
              title="Start the title where the playhead is">⤓ Start here</button>
            <span className="muted">from {fmt(title.start)}</span>
            <label className="inline-num">for
              <input type="number" min={0.5} max={60} step={0.5} value={title.duration}
                onChange={(e) => set({ duration: Math.max(0.5, Number(e.target.value) || 1) })} />s
            </label>
          </div>
          {title.start >= clipLength && clipLength > 0 && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              ⚠ That start is past the end of this clip ({fmt(clipLength)}) — it won’t be seen.
            </div>
          )}
          <button className="sm danger" style={{ marginTop: 14 }} onClick={() => set({ text: "" })}>
            Remove title
          </button>
        </>
      )}
    </>
  );
}

/* Submagic-style AI auto-effects — one panel, three opt-in checkboxes. Nothing changes until
   "Apply". Emphasis/emoji land on the caption words (visible in the preview immediately); zoom
   and SFX are stored for the export (zoom also previews via a CSS scale on the video). */
function AIEffectsPanel({ cid, onApplied }: { cid: number; onApplied: (words: Word[], effects: ClipEffects) => void }) {
  const [opts, setOpts] = useState({ emphasis: true, zoom: true, sfx: true });
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const toast = useToast();
  const apply = async () => {
    if (!opts.emphasis && !opts.zoom && !opts.sfx) { toast("Pick at least one effect", "err"); return; }
    setBusy(true);
    try {
      const r = await api.aiEffects(cid, opts);
      onApplied(r.words, r.effects); setCounts(r.counts);
      toast("AI effects applied", "ok");
    } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  const row = (key: keyof typeof opts, label: string, hint: string) => (
    <label className="fx-opt">
      <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} />
      <span><b>{label}</b><span className="muted"> — {hint}</span></span>
    </label>
  );
  return (
    <div className="panel-body">
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>✨ AI auto-effects. Nothing changes until you apply. Runs on your local Ollama.</div>
      {row("emphasis", "Emphasis & emoji", "punch key words, add emoji")}
      {row("zoom", "Punch-in zoom", "zoom on the biggest beats")}
      {row("sfx", "Sound effects", "whoosh / pop on key moments")}
      <button className="primary big-btn" style={{ marginTop: 14 }} onClick={apply} disabled={busy}>
        {busy ? "Analyzing…" : "✨ Apply AI effects"}
      </button>
      {counts && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Added: {counts.emphasis} emphasized · {counts.emoji} emoji · {counts.zoom} zooms · {counts.sfx} SFX
      </div>}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
        Emphasis & emoji show in the preview now; zoom previews as a scale; SFX are mixed in on export.
      </div>
    </div>
  );
}

/* ---- Transcript-editor helpers (reuse doc.cuts — no new storage) ---- */
// Keep EVERY word, tagged whether it falls inside a cut (unlike remapWords, which drops them).
function annotateWordsWithCuts(words: Word[], cuts: [number, number][]): (Word & { cut: boolean })[] {
  return words.map((w) => ({ ...w, cut: cuts.some(([a, b]) => w.end > a && w.start < b) }));
}
// Add a cut range, merging any overlapping/adjacent ranges so the cut set stays tidy.
function unionCut(cuts: [number, number][], add: [number, number]): [number, number][] {
  const all = [...cuts, add].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.001) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
// Remove a range from the cut set (restore that span of video/text).
function subtractRange(cuts: [number, number][], [a, b]: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of cuts) {
    if (e <= a || s >= b) { out.push([s, e]); continue; }   // no overlap → keep as-is
    if (s < a) out.push([s, a]);                            // keep the left remainder
    if (e > b) out.push([b, e]);                            // keep the right remainder
  }
  return out;
}

const TOOLS: { id: string; label: string; icon: string; soon?: boolean }[] = [
  { id: "look", label: "Look", icon: "🎨" },
  { id: "cut", label: "Cut", icon: "⌦" },
  { id: "reframe", label: "Reframe", icon: "⛶" },
  // One home for every word on screen. The big cinematic text is a SUBTITLE STYLE, so it
  // lives in here too — there is no "Big title" rail tool and there never should be one.
  { id: "subs", label: "Captions", icon: "CC" },
  { id: "voice", label: "Voice", icon: "🎙" },
  { id: "text", label: "Transcript", icon: "T" },
  { id: "fx", label: "AI Effects", icon: "✨" },
];
const COMING_SOON = TOOLS.filter((t) => t.soon).map((t) => t.id);

/* Undo/redo with a debounced commit so rapid edits (drags/sliders) coalesce into one step. */
function useHistory<T>(initial: T) {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const timer = useRef<number | undefined>(undefined);
  const pendingBase = useRef<T | null>(null);
  const set = (patch: Partial<T>) => {
    setState((s) => {
      if (pendingBase.current === null) pendingBase.current = s.present;
      return { ...s, present: { ...s.present, ...patch } };
    });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setState((s) => {
        const base = pendingBase.current; pendingBase.current = null;
        return base === null ? s : { past: [...s.past, base], present: s.present, future: [] };
      });
    }, 600);
  };
  const undo = () => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  const redo = () => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  // Replace the whole document and clear history — used by "Revert to opened".
  const reset = (next: T) => { clearTimeout(timer.current); pendingBase.current = null; setState({ past: [], present: next, future: [] }); };
  return { doc: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

/* The "Clips" tool: lists every block as an editable clip — select, fine-tune in/out,
   delete, plus header actions to add a clip or split the one under the playhead. */
function ClipsPanel({ blocks, selected, onSelect, onTrim, onDelete, onAdd, onSplit, time, onSeek, onMatchCaptions, allowAdd, isReel }: {
  blocks: Seg[]; selected: number | null; onSelect: (i: number) => void;
  onTrim: (i: number, edge: "start" | "end", t: number) => void; onDelete: (i: number) => void;
  onAdd: () => void; onSplit: () => void; time: number; onSeek: (t: number) => void;
  onMatchCaptions: () => void; allowAdd?: boolean; isReel?: boolean;
}) {
  const total = blocks.reduce((s, [a, b]) => s + (b - a), 0);
  return (
    <div className="panel-body">
      <h3 className="panel-title">Clips</h3>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {isReel
          ? <>Each block is one <b>scene</b> of your reel. Trim its edges on the timeline, split, or delete it — each scene is edited on its own.</>
          : <>Each block is a clip in your video. Trim its edges on the timeline, split at the playhead, add another part of the source, or delete it.</>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {allowAdd && <button className="primary" onClick={onAdd}>+ Add clip</button>}
        <button onClick={onSplit} title="Split the clip under the playhead into two">Split at playhead</button>
      </div>
      <div className="clip-list">
        {blocks.length === 0 && <div className="muted">No clips.</div>}
        {blocks.map(([a, b], i) => (
          <div key={i} className={"clip-row" + (selected === i ? " sel" : "")} onClick={() => { onSelect(i); onSeek(a); }}>
            <span className="clip-no">{i + 1}</span>
            <div className="clip-meta">
              <div className="clip-range">{fmt(a)} – {fmt(b)}</div>
              <div className="muted clip-len">{fmt(b - a)}</div>
            </div>
            <div className="clip-ops" onClick={(e) => e.stopPropagation()}>
              <input className="clip-in" type="number" step={0.1} value={a.toFixed(2)} title="Clip start (seconds)"
                onChange={(e) => onTrim(i, "start", parseFloat(e.target.value) || 0)} />
              <input className="clip-in" type="number" step={0.1} value={b.toFixed(2)} title="Clip end (seconds)"
                onChange={(e) => onTrim(i, "end", parseFloat(e.target.value) || 0)} />
              <button className="sm danger" title="Delete this clip" disabled={blocks.length <= 1} onClick={() => onDelete(i)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      <button className="sm" style={{ marginTop: 10 }} onClick={onMatchCaptions}
        title="Pull the transcript text for the current clips into the captions">↻ Match captions to these clips</button>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{blocks.length} clip{blocks.length === 1 ? "" : "s"} · <b>{fmt(total)}</b> total</div>
    </div>
  );
}

function TrimPanel({ doc, set, max }: { doc: EditDoc; set: (p: Partial<EditDoc>) => void; max: number }) {
  return (
    <div className="panel-body">
      <h3 className="panel-title">Trim</h3>
      <div className="muted" style={{ fontSize: 12.5 }}>Drag the purple handles on the timeline below — or fine-tune here.</div>
      <label className="field">Start (seconds)
        <input type="number" step={0.1} value={doc.start.toFixed(2)} onChange={(e) => set({ start: Math.min(Math.max(0, parseFloat(e.target.value) || 0), doc.end - 0.5) })} /></label>
      <label className="field">End (seconds)
        <input type="number" step={0.1} value={doc.end.toFixed(2)} onChange={(e) => set({ end: Math.min(Math.max(parseFloat(e.target.value) || 0, doc.start + 0.5), max) })} /></label>
      <div className="muted" style={{ fontSize: 12.5 }}>Length: <b>{fmt(doc.end - doc.start)}</b></div>
    </div>
  );
}

function CutPanel({ doc, set, time, onSeek }: { doc: EditDoc; set: (p: Partial<EditDoc>) => void; time: number; onSeek: (t: number) => void }) {
  const [mark, setMark] = useState<number | null>(null);
  const addCut = (a: number, b: number) => {
    const lo = Math.max(doc.start, Math.min(a, b));
    const hi = Math.min(doc.end, Math.max(a, b));
    if (hi - lo < 0.1) return;
    set({ cuts: [...doc.cuts, [lo, hi] as [number, number]].sort((x, y) => x[0] - y[0]) });
  };
  const removed = doc.cuts.reduce((s, [a, b]) => s + (b - a), 0);
  return (
    <div className="panel-body">
      <h3 className="panel-title">Cut out the middle</h3>
      <div className="muted" style={{ fontSize: 12.5 }}>Delete a part from the middle of the clip. Move the playhead to where the bad part starts, press “Set cut start”, move to where it ends, then press “Cut to here”.</div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button onClick={() => setMark(time)}>Set cut start{mark != null ? ` (${fmt(mark)})` : ""}</button>
        <button className="primary" disabled={mark == null} onClick={() => { if (mark != null) { addCut(mark, time); setMark(null); } }}>Cut to here</button>
      </div>
      {mark != null && <div className="muted" style={{ fontSize: 12 }}>Cut starts at {fmt(mark)} — move the playhead forward, then press “Cut to here”.</div>}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Removed: <b>{fmt(removed)}</b> · Final length: <b>{fmt(Math.max(0, (doc.end - doc.start) - removed))}</b></div>
      <div className="word-list" style={{ marginTop: 8 }}>
        {doc.cuts.length === 0 && <div className="muted">No cuts yet.</div>}
        {doc.cuts.map(([a, b], i) => (
          <div key={i} className="word-row">
            <button className="word-ts" onClick={() => onSeek(a)}>{fmt(a)} – {fmt(b)}</button>
            <button className="sm danger" title="Undo this cut" onClick={() => set({ cuts: doc.cuts.filter((_, j) => j !== i) })}>🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Karaoke teleprompter: shows the current caption line big, highlighting the
// active word as the video plays, with the next line faded beneath.
function Teleprompter({ words, time, maxWords }: { words: Word[]; time: number; maxWords: number }) {
  if (!words.length) return <div className="teleprompter empty">Add captions to use the teleprompter</div>;
  const lines = groupLines(words, maxWords);
  // Find the line covering `time` (else the next upcoming line, else the last).
  let idx = lines.findIndex((ln) => time >= ln[0].start && time <= ln[ln.length - 1].end + 0.15);
  if (idx < 0) idx = lines.findIndex((ln) => ln[0].start > time);
  if (idx < 0) idx = lines.length - 1;
  const cur = lines[idx];
  const next = lines[idx + 1];
  let activeIdx = -1;
  for (let i = 0; i < cur.length; i++) if (time >= cur[i].start) activeIdx = i;
  return (
    <div className="teleprompter">
      <div className="tp-line">
        {cur.map((w, i) => (
          <span key={i} className={"tp-word" + (i === activeIdx ? " active" : i < activeIdx ? " done" : "")}>{w.word.trim()}</span>
        ))}
      </div>
      {next && <div className="tp-next">{next.map((w) => w.word.trim()).join(" ")}</div>}
    </div>
  );
}

/* Whole-reel AI voice: read the ENTIRE script as one continuous voiceover laid over all the
   clips (clips keep their natural length; last frame holds if the voice runs long). One button —
   sits above the per-scene panel for reels. Generating it clears any per-scene voices. */
function WholeReelVoice({ cid, text, onGenerated, toast }: { cid: number; text: string; onGenerated: () => void; toast: Notify }) {
  const [voices, setVoices] = useState<{ voice_id: string; name: string }[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.ttsVoices().then((v) => { setVoices(v.voices); setVoiceId(v.default); }).catch(() => {}); }, []);
  const gen = async () => {
    if (!text.trim()) { toast("No script to read — add captions first", "err"); return; }
    setBusy(true);
    try {
      await api.ttsVoiceover(cid, voiceId || undefined, text);
      onGenerated();
      toast("AI voice added — one read over the whole video", "ok");
    } catch (e: any) { toast(`Voice generation failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="whole-reel-vo">
      <div className="wrv-head">🎙 Voice the whole reel</div>
      <div className="muted" style={{ fontSize: 12.5 }}>One continuous AI read of your whole script, over all the clips. Replaces any per-scene voices below.</div>
      <div className="wrv-row">
        {voices.length > 0 && (
          <select className="vo-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={busy}>
            {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
          </select>
        )}
        <button className="primary" onClick={gen} disabled={busy}>{busy ? "Generating…" : "🔊 Voice whole reel"}</button>
      </div>
    </div>
  );
}

function VoicePanel({ cid, voUrl, text, onChanged, toast, onRecordStart, onRecordStop }: { cid: number; voUrl: string | null; text: string; onChanged: (u: string | null) => void; toast: Notify; onRecordStart: (range?: { s: number; e: number }, onEnd?: () => void, startMic?: () => Promise<boolean>) => void; onRecordStop: () => void }) {
  const { recording, error, start, stop } = useRecorder();
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // AI voice (ElevenLabs TTS): fetch the available voices once for the picker.
  const [voices, setVoices] = useState<{ voice_id: string; name: string }[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [genBusy, setGenBusy] = useState(false);
  useEffect(() => { api.ttsVoices().then((v) => { setVoices(v.voices); setVoiceId(v.default); }).catch(() => {}); }, []);
  const genVoice = async () => {
    if (!text.trim()) { toast("No transcript to read — add captions first", "err"); return; }
    setGenBusy(true);
    try {
      await api.ttsVoiceover(cid, voiceId || undefined, text);
      onChanged(api.clipVoiceoverUrl(cid) + "?t=" + Date.now());
      toast("AI voice generated — it's now your video's audio", "ok");
    } catch (e: any) { toast(`Voice generation failed: ${e?.message || e}`, "err"); } finally { setGenBusy(false); }
  };

  const onStop = async () => {
    const blob = await stop();
    onRecordStop();                                                  // pause the video
    if (blob) setPending({ blob, url: URL.createObjectURL(blob) });
  };
  // Park the video on the trimmed start, THEN start the mic, THEN roll — so the take
  // begins exactly at the trim point (not the old frame); auto-stops (onStop) at clip end.
  const onRecord = () => onRecordStart(undefined, onStop, start);
  const save = async () => {
    if (!pending) return; setBusy(true);
    try {
      await api.uploadClipVoiceover(cid, pending.blob);
      URL.revokeObjectURL(pending.url); setPending(null);
      onChanged(api.clipVoiceoverUrl(cid) + "?t=" + Date.now());
      toast("Voice saved — it'll be the audio of your video", "ok");
    } catch (e: any) { toast(`Save failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  const discard = () => { if (pending) URL.revokeObjectURL(pending.url); setPending(null); };
  const remove = async () => {
    setBusy(true);
    try { await api.deleteClipVoiceover(cid); onChanged(null); toast("Voice removed", "ok"); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="panel-body">
      <h3 className="panel-title">Voiceover</h3>
      <div className="muted" style={{ fontSize: 12.5 }}>Press ▶ on the video, read your lines, and record your voice over it. Your voice becomes the audio of the final video.</div>
      <div className="vo-controls">
        {!recording
          ? <button className="primary big-btn" onClick={onRecord} disabled={busy || !!pending}>● Record voice</button>
          : <button className="big-btn danger" onClick={onStop}>■ Stop</button>}
      </div>
      {recording && <div className="muted vo-live">● Recording… read your script, then press Stop.</div>}
      {error && <div className="err">{error}</div>}

      {/* AI voice — let ElevenLabs read the transcript instead of recording */}
      <div className="vo-ai">
        <div className="muted" style={{ fontSize: 12.5, margin: "6px 0 6px" }}>…or let AI read your transcript aloud:</div>
        {voices.length > 0 && (
          <select className="vo-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={genBusy}>
            {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
          </select>
        )}
        <button className="big-btn" onClick={genVoice} disabled={genBusy || recording || !!pending}>
          {genBusy ? "Generating…" : "🔊 Generate AI voice"}
        </button>
      </div>
      {pending && (
        <div className="vo-pending">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Listen to your take:</div>
          <audio src={pending.url} controls style={{ width: "100%" }} />
          <div className="modal-actions">
            <button onClick={discard} disabled={busy}>Discard</button>
            <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save voice"}</button>
          </div>
        </div>
      )}
      {!pending && voUrl && (
        <div className="vo-current">
          <div className="muted" style={{ fontSize: 12.5, margin: "12px 0 6px" }}>Current voice:</div>
          <audio src={voUrl} controls style={{ width: "100%" }} />
          <button className="sm danger" style={{ marginTop: 8 }} onClick={remove} disabled={busy}>Remove voice</button>
        </div>
      )}
    </div>
  );
}

function SceneVoicePanel({ cid, markers, sceneIdx, onSelectScene, sceneVos, setSceneVos, readRate, setReadRate, activeScene, onRecordStart, onRecordStop, previewMode, onPlayScene, onPlayReel, onStopPreview, onChanged, toast }: {
  cid: number; markers: { start: number; end: number; label: string }[]; sceneIdx: number; onSelectScene: (i: number) => void;
  sceneVos: (string | null)[]; setSceneVos: (v: (string | null)[]) => void; readRate: number; setReadRate: (r: number) => void;
  activeScene: { start: number; end: number; label: string }; onRecordStart: (r?: { s: number; e: number }, onEnd?: () => void, startMic?: () => Promise<boolean>) => void; onRecordStop: () => void;
  previewMode: "off" | "scene" | "reel"; onPlayScene: (i: number) => void; onPlayReel: () => void; onStopPreview: () => void;
  onChanged: () => void; toast: Notify;
}) {
  const { recording, error, start, stop } = useRecorder();
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasVoice = !!sceneVos[sceneIdx];
  const doneCount = sceneVos.filter(Boolean).length;
  // AI voice (ElevenLabs TTS) for THIS scene — same picker + flow as the whole-clip VoicePanel.
  const [voices, setVoices] = useState<{ voice_id: string; name: string }[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [genBusy, setGenBusy] = useState(false);
  useEffect(() => { api.ttsVoices().then((v) => { setVoices(v.voices); setVoiceId(v.default); }).catch(() => {}); }, []);
  const genVoice = async () => {
    if (previewMode !== "off") onStopPreview();
    setGenBusy(true);
    try {
      const r = await api.sceneTtsVoiceover(cid, sceneIdx, voiceId || undefined);
      setSceneVos(r.scene_vos); onChanged();
      toast(`AI voice added to scene ${sceneIdx + 1}`, "ok");
    } catch (e: any) { toast(`Voice generation failed: ${e?.message || e}`, "err"); } finally { setGenBusy(false); }
  };

  const onStop = async () => { const blob = await stop(); onRecordStop(); if (blob) setPending({ blob, url: URL.createObjectURL(blob) }); };
  // Park the video on the scene start, then start the mic, then roll — capture begins
  // exactly at the scene start; auto-stops (onStop) when the scene ends.
  const onRecord = () => { if (previewMode !== "off") onStopPreview(); onRecordStart({ s: activeScene.start, e: activeScene.end }, onStop, start); };
  const save = async () => {
    if (!pending) return; setBusy(true);
    try { const r = await api.uploadSceneVoiceover(cid, sceneIdx, pending.blob); URL.revokeObjectURL(pending.url); setPending(null); setSceneVos(r.scene_vos); onChanged(); toast(`Scene ${sceneIdx + 1} voice saved`, "ok"); }
    catch (e: any) { toast(`Save failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  const discard = () => { if (pending) URL.revokeObjectURL(pending.url); setPending(null); };
  const remove = async () => {
    setBusy(true);
    try { if (previewMode !== "off") onStopPreview(); await api.deleteSceneVoiceover(cid, sceneIdx); const copy = [...sceneVos]; copy[sceneIdx] = null; setSceneVos(copy); onChanged(); toast("Voice removed", "ok"); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="panel-body">
      <h3 className="panel-title">Voiceover — one scene at a time</h3>
      <div className="scene-nav">
        <button className="icon-btn" disabled={sceneIdx <= 0 || recording} onClick={() => onSelectScene(sceneIdx - 1)}>◀</button>
        <span className="scene-pos">Scene {sceneIdx + 1} / {markers.length}{hasVoice ? " ✓" : ""}</span>
        <button className="icon-btn" disabled={sceneIdx >= markers.length - 1 || recording} onClick={() => onSelectScene(sceneIdx + 1)}>▶</button>
      </div>
      {activeScene.label && <div className="muted scene-label">“{activeScene.label}”</div>}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Reading speed (only while recording):</div>
      <div className="seg-toggle wide">
        {[0.5, 0.75, 1].map((r) => <button key={r} className={readRate === r ? "on" : ""} disabled={recording} onClick={() => setReadRate(r)}>{r}×</button>)}
      </div>
      <div className="vo-controls">
        {!recording
          ? <button className="primary big-btn" onClick={onRecord} disabled={busy || !!pending}>● Record this scene</button>
          : <button className="big-btn danger" onClick={onStop}>■ Stop</button>}
      </div>
      {recording && <div className="muted vo-live">● Recording scene {sceneIdx + 1}… read along with the highlight.</div>}
      {error && <div className="err">{error}</div>}

      {/* AI voice — let ElevenLabs read this scene instead of recording it */}
      <div className="vo-ai">
        <div className="muted" style={{ fontSize: 12.5, margin: "6px 0 6px" }}>…or let AI read this scene aloud:</div>
        {voices.length > 0 && (
          <select className="vo-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={genBusy || recording}>
            {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
          </select>
        )}
        <button className="big-btn" onClick={genVoice} disabled={genBusy || recording || !!pending}>
          {genBusy ? "Generating…" : "🔊 Generate AI voice for this scene"}
        </button>
      </div>
      {pending && (
        <div className="vo-pending">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Listen to your take:</div>
          <audio src={pending.url} controls style={{ width: "100%" }} />
          <div className="modal-actions"><button onClick={discard} disabled={busy}>Discard</button><button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save scene voice"}</button></div>
        </div>
      )}
      {!pending && hasVoice && (
        <div className="vo-current">
          <button className="primary big-btn" onClick={() => previewMode === "scene" ? onStopPreview() : onPlayScene(sceneIdx)} disabled={recording || previewMode === "reel"}>
            {previewMode === "scene" ? "■ Stop" : "▶ Hear this scene with voice"}
          </button>
          <button className="sm danger" style={{ marginTop: 8 }} onClick={remove} disabled={busy || previewMode !== "off"}>Remove this scene's voice</button>
        </div>
      )}
      {doneCount > 0 && !pending && (
        <button className="big-btn" style={{ marginTop: 10 }} onClick={() => previewMode === "reel" ? onStopPreview() : onPlayReel()} disabled={recording}>
          {previewMode === "reel" ? "■ Stop preview" : "▶ Play whole video with voice"}
        </button>
      )}
      <div className="muted scene-progress">{doneCount} / {markers.length} scenes have voice. Export times each scene to your voice.</div>
    </div>
  );
}

function ReframePanel({ center, set, autoCenter, autoBusy }: { center: number; set: (p: Partial<EditDoc>) => void; autoCenter: () => void; autoBusy: boolean }) {
  return (
    <div className="panel-body">
      <h3 className="panel-title">Reframe</h3>
      <div className="muted" style={{ fontSize: 12.5 }}>Choose what stays in the tall 9:16 frame. Drag on the preview, pick a side, or auto-center on the speaker.</div>
      <div className="seg-toggle wide">
        <button className={center < 0.34 ? "on" : ""} onClick={() => set({ center: 0.16 })}>Left</button>
        <button className={center >= 0.34 && center <= 0.66 ? "on" : ""} onClick={() => set({ center: 0.5 })}>Center</button>
        <button className={center > 0.66 ? "on" : ""} onClick={() => set({ center: 0.84 })}>Right</button>
      </div>
      <div className="slider"><label><span>Fine position</span><span>{Math.round(center * 100)}%</span></label>
        <input type="range" min={0} max={1} step={0.01} value={center} onChange={(e) => set({ center: parseFloat(e.target.value) })} /></div>
      <button className="primary" onClick={autoCenter} disabled={autoBusy}>{autoBusy ? "Finding the speaker…" : "✨ Auto-center on speaker"}</button>
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="panel-body coming">
      <div className="coming-ic">🚧</div>
      <h3 className="panel-title">{label}</h3>
      <p className="muted" style={{ fontSize: 13 }}>Coming soon. The core editor — Trim, Reframe and Subtitles — is ready to use now.</p>
    </div>
  );
}

/* Per-word subtitle editor: click a time to jump there, edit a word, empty a box to delete it. */
function SubtitleWordEditor({ words, time, onSeek, onChange }: { words: Word[]; time: number; onSeek: (t: number) => void; onChange: (w: Word[]) => void }) {
  const editWord = (i: number, val: string) => {
    const t = val.trim(); const next = [...words];
    if (t === "") next.splice(i, 1); else next[i] = { ...next[i], word: t };
    onChange(next);
  };
  return (
    <div className="word-list">
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Click a time to jump there · edit a word to fix it · empty a box to delete it.</div>
      {words.length === 0 && <div className="muted">No captions in this clip range.</div>}
      {words.map((w, i) => {
        const active = time >= w.start && time < w.end;
        return (
          <div key={i} className={"word-row" + (active ? " active" : "")}>
            <button className="word-ts" onClick={() => onSeek(w.start)}>{fmt(w.start)}</button>
            <input className="word-in" key={w.word + "_" + i} defaultValue={w.word.trim()} onBlur={(e) => editWord(i, e.target.value)} />
          </div>
        );
      })}
    </div>
  );
}

/* Multi-clip scrubbing timeline: one track of source frames with each kept clip
   drawn as its own draggable BLOCK. Drag a block's edge to trim that clip, drag the
   block body to scrub, click to select (then ✕ deletes it). Drag on the dim/unused
   area to rubber-band a NEW clip from that part of the source. Interior gaps (cuts)
   show as a subtle grey band; the playhead rides on top. */
function FilmstripTimeline({ pid, winStart, winEnd, clips, selected, time, zoom, cuts, markers, allowAdd, onSelectClip, onTrimClip, onDeleteClip, onAddClip, onScrub }: {
  pid: number; winStart: number; winEnd: number; clips: Seg[]; selected: number | null; time: number; zoom: number; cuts: [number, number][];
  markers?: { start: number; end: number; label: string }[]; allowAdd?: boolean;
  onSelectClip: (i: number) => void; onTrimClip: (i: number, edge: "start" | "end", t: number) => void;
  onDeleteClip: (i: number) => void; onAddClip: (a: number, b: number) => void; onScrub: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [band, setBand] = useState<[number, number] | null>(null);
  const span = Math.max(0.1, winEnd - winStart);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - winStart) / span) * 100));
  const toTime = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); const x = Math.min(Math.max(0, clientX - r.left), r.width); return winStart + (x / r.width) * span; };
  const cStart = clips.length ? clips[0][0] : winStart;
  const cEnd = clips.length ? clips[clips.length - 1][1] : winEnd;

  const dragHandle = (i: number, edge: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const move = (ev: PointerEvent) => onTrimClip(i, edge, toTime(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  // Pressing/dragging anywhere on a block just scrubs the playhead (no selection). Trim with
  // the edge handles; delete (on a reel with multiple scenes) via the × that shows on hover.
  const dragBlock = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); onScrub(toTime(e.clientX));
    const move = (ev: PointerEvent) => onScrub(toTime(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  // Press on the dim/unused area: rubber-band a new clip, or just scrub on a click.
  const dragTrack = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, t0 = toTime(x0); let moved = false;
    const move = (ev: PointerEvent) => {
      const t = toTime(ev.clientX);
      if (Math.abs(ev.clientX - x0) > 4) moved = true;
      if (moved && allowAdd) setBand([Math.min(t0, t), Math.max(t0, t)]);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      setBand(null);
      if (moved && allowAdd) { const t = toTime(ev.clientX); onAddClip(Math.min(t0, t), Math.max(t0, t)); }
      else onScrub(t0);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const n = Math.max(8, Math.round(10 * zoom));
  const frames = useMemo(() => Array.from({ length: n }, (_, i) => winStart + ((i + 0.5) / n) * span), [winStart, span, n]);
  const total = clips.reduce((s, [a, b]) => s + (b - a), 0);
  return (
    <div className="fs-wrap">
      <div className="fs-scroll">
        <div className="fs-track" ref={ref} onPointerDown={dragTrack} style={{ width: `${zoom * 100}%` }}>
          <div className="fs-frames">{frames.map((t, i) => (
            <img key={i} src={api.frameUrl(pid, t)} alt="" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")} />
          ))}</div>
          <div className="fs-dim" style={{ left: 0, width: `${pct(cStart)}%` }} />
          <div className="fs-dim" style={{ left: `${pct(cEnd)}%`, right: 0 }} />
          {cuts.map(([a, b], i) => (
            <div key={i} className="fs-cut" style={{ left: `${pct(a)}%`, width: `${Math.max(0, pct(b) - pct(a))}%` }} title="Removed — gap between clips" />
          ))}
          {clips.map(([a, b], i) => (
            <div key={i} className={"fs-block" + (selected === i ? " sel" : "")}
              style={{ left: `${pct(a)}%`, width: `${Math.max(0, pct(b) - pct(a))}%` }}
              onPointerDown={dragBlock(i)} title={`Clip ${i + 1}: ${fmt(a)}–${fmt(b)}`}>
              <span className="fs-block-no">{i + 1}</span>
              <div className="fs-handle l" onPointerDown={dragHandle(i, "start")} title="Trim this clip's start" />
              <div className="fs-handle r" onPointerDown={dragHandle(i, "end")} title="Trim this clip's end" />
              {clips.length > 1 && (
                <button className="fs-del" title="Delete this scene" onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onDeleteClip(i); }}>×</button>
              )}
            </div>
          ))}
          {band && <div className="fs-band" style={{ left: `${pct(band[0])}%`, width: `${Math.max(0, pct(band[1]) - pct(band[0]))}%` }} />}
          {(markers ?? []).map((m, i) => (
            i > 0 ? <div key={"mk" + i} className="fs-marker" style={{ left: `${pct(m.start)}%` }} title={`Scene ${i + 1}: ${m.label}`} /> : null
          ))}
          <div className="fs-playhead" style={{ left: `${pct(time)}%` }} />
        </div>
      </div>
      <div className="timeline-labels">
        <span className="tag">{clips.length} clip{clips.length === 1 ? "" : "s"}</span>
        <span className="tag">{fmt(total)} total</span>
        <span className="tag muted">drag a clip edge to trim{allowAdd ? " · drag empty space to add" : ""}</span>
      </div>
    </div>
  );
}

function StyleEditor({ style, onChange }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void }) {
  const set = (k: keyof CaptionStyle, v: any) => onChange({ ...style, [k]: v });
  return (
    <>
      <div className="swatch-row">
        <label className="swatch">Text<input type="color" value={style.color} onChange={(e) => set("color", e.target.value)} /></label>
        <label className="swatch">Highlight<input type="color" value={style.highlight} onChange={(e) => set("highlight", e.target.value)} /></label>
        <label className="swatch">Outline<input type="color" value={style.outline_color} onChange={(e) => set("outline_color", e.target.value)} /></label>
      </div>
      <div className="slider"><label><span>Size</span><span>{style.size}</span></label>
        <input type="range" min={48} max={140} value={style.size} onChange={(e) => set("size", parseInt(e.target.value))} /></div>
      <div className="slider"><label><span>Words per line</span><span>{style.max_words}</span></label>
        <input type="range" min={1} max={8} value={style.max_words} onChange={(e) => set("max_words", parseInt(e.target.value))} /></div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="seg-toggle">{["top", "mid", "bottom"].map((p) => (
          <button key={p} className={style.position === p ? "on" : ""} onClick={() => set("position", p)}>{p}</button>))}</div>
        <button className={style.uppercase ? "primary sm" : "sm"} onClick={() => set("uppercase", !style.uppercase)}>UPPERCASE</button>
      </div>
    </>
  );
}
