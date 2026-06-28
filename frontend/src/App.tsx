import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, Beat, Clip, ExportItem, InsightsData, Outlier, Presets, Project, QueueData, QueueTicket, Ticket } from "./api";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionStyle, FALLBACK_PRESETS, groupLines, Word, wordsInRange } from "./captionStyles";
import { Sidebar } from "./Sidebar";
import { useToast } from "./Toast";
import { useRecorder } from "./useRecorder";
import { VideoModal } from "./VideoModal";
import { exportDirSupported, getExportDir, pickExportDir } from "./exportDir";

type Route =
  | { name: "home" }
  | { name: "board" }
  | { name: "intake" }
  | { name: "queue" }
  | { name: "insights" }
  | { name: "library" }
  | { name: "project"; pid: number }
  | { name: "editor"; pid: number; cid: number; from?: "board" | "project" };

export default function App() {
  const [presets, setPresets] = useState<Presets | null>(null);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [projName, setProjName] = useState("");

  useEffect(() => { api.presets().then(setPresets); }, []);
  const goHome = () => setRoute({ name: "home" });
  const goBoard = () => setRoute({ name: "board" });
  const goIntake = () => setRoute({ name: "intake" });
  const goQueue = () => setRoute({ name: "queue" });
  const goInsights = () => setRoute({ name: "insights" });
  const goLibrary = () => setRoute({ name: "library" });

  const NAMED: Record<string, string> = { board: "Create videos", intake: "Outliers", queue: "Schedule", insights: "Results", library: "Downloads" };
  const crumbLabel = NAMED[route.name] ?? null;
  const sbView = (["board", "intake", "queue", "insights", "library"].includes(route.name) ? route.name : "home") as any;

  return (
    <div className="shell">
      <Sidebar view={sbView} onHome={goHome} onBoard={goBoard} onIntake={goIntake} onQueue={goQueue} onInsights={goInsights} onLibrary={goLibrary} />
      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            {crumbLabel
              ? <span className="cur">{crumbLabel}</span>
              : <button className="back" onClick={goHome}>Projects</button>}
            {route.name !== "home" && !crumbLabel && (<><span className="sep">/</span><span className="cur">{projName}</span></>)}
            {route.name === "editor" && (<><span className="sep">/</span><button className="back" onClick={() => setRoute({ name: "project", pid: route.pid })}>moments</button></>)}
          </div>
          <div className="spacer" />
        </header>

        {route.name === "board" && <Board presets={presets} onOpenEditor={(pid, cid) => setRoute({ name: "editor", pid, cid, from: "board" })} />}
        {route.name === "intake" && <Intake onSpun={goBoard} />}
        {route.name === "queue" && <Queue />}
        {route.name === "insights" && <Insights />}
        {route.name === "library" && <Library />}
        {route.name === "home" && <Home presets={presets} onOpen={(pid) => setRoute({ name: "project", pid })} />}
        {route.name === "project" && (
          <MomentsGrid pid={route.pid} onName={setProjName}
            onEdit={(cid) => setRoute({ name: "editor", pid: route.pid, cid })} onBack={goHome} />
        )}
        {route.name === "editor" && (
          <EditorPage pid={route.pid} cid={route.cid} presets={presets} onName={setProjName}
            onBack={() => setRoute(route.from === "board" ? { name: "board" } : { name: "project", pid: route.pid })} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------- Board --------------------------------- */
// The 8 DB stages collapse into 4 dead-simple Board columns (matches the how-banner).
// Stage stays the DB source of truth; this is display-only grouping.
type Phase = { key: string; label: string; stages: string[] };
const PHASES: Phase[] = [
  { key: "idea",   label: "1. Idea",    stages: ["outlier"] },
  { key: "make",   label: "2. Make it", stages: ["scripted", "staged", "sourced"] },
  { key: "ready",  label: "3. Ready",   stages: ["assembled", "ready"] },
  { key: "posted", label: "4. Posted",  stages: ["scheduled", "posted"] },
];
const phaseOf = (stage: string) => Math.max(0, PHASES.findIndex((p) => p.stages.includes(stage)));
const phaseLabel = (stage: string) => PHASES[phaseOf(stage)].label;
const PHASE_HINT: Record<string, string> = {
  idea: "New videos start here", make: "Write & film your scenes",
  ready: "Made — ready to post", posted: "Posted videos land here",
};
// Plain-language labels for the capture mode (how the video gets made).
const MODE_LABELS: Record<string, string> = {
  "native-short": "Film it myself", "longform-clip": "From a long video", "repurpose": "Reuse old footage",
};
const MODE_ICONS: Record<string, string> = {
  "native-short": "🎬", "longform-clip": "✂", "repurpose": "♻",
};
const modeLabel = (m: string) => MODE_LABELS[m] ?? m;
const modeIcon = (m: string) => MODE_ICONS[m] ?? "🎬";

function Board({ presets, onOpenEditor }: { presets: Presets | null; onOpenEditor: (pid: number, cid: number) => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const toast = useToast();

  const refresh = () => api.listTickets().then(setTickets);
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  const move = async (t: Ticket, dir: 1 | -1) => {
    const j = phaseOf(t.stage) + dir;
    if (j < 0 || j >= PHASES.length) return;
    await api.patchTicket(t.id, { stage: PHASES[j].stages[0] }); refresh();
  };
  const del = async (t: Ticket) => {
    if (!confirm(`Delete this ticket${t.angle ? ` (${t.angle})` : ""}?`)) return;
    await api.deleteTicket(t.id); if (openId === t.id) setOpenId(null);
    toast("Ticket deleted", "ok"); refresh();
  };

  return (
    <div className="board-page">
      <div className="page-head">
        <h2>Create videos</h2>
        <button className="primary" onClick={() => setShowNew(true)}>+ New video</button>
      </div>
      <div className="how-banner">
        <span className="how-step"><b>1</b> Save an idea</span><span className="how-arrow">→</span>
        <span className="how-step"><b>2</b> Write &amp; film it</span><span className="how-arrow">→</span>
        <span className="how-step"><b>3</b> Make the video</span><span className="how-arrow">→</span>
        <span className="how-step"><b>4</b> Post &amp; see results</span>
        <span className="how-tip">Each video is a card below. Use ◀ ▶ to move it forward as you finish each step.</span>
      </div>
      {tickets == null ? <div className="muted">Loading…</div> : (
        <div className="board">
          {PHASES.map((ph) => {
            const col = tickets.filter((t) => ph.stages.includes(t.stage));
            return (
              <div className={"board-col cv-lane cv-" + ph.key} key={ph.key}>
                <div className="board-col-head"><span className="cv-lane-dot" /><span>{ph.label}</span><span className="board-count">{col.length}</span></div>
                <div className="board-col-body">
                  {col.map((t) => <TicketCard key={t.id} t={t} onOpen={() => setOpenId(t.id)} onMove={move} onDelete={del} />)}
                  {col.length === 0 && <div className="cv-lane-empty">{PHASE_HINT[ph.key]}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showNew && <NewTicketModal presets={presets} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
      {openId != null && <TicketDetail tid={openId} presets={presets} onClose={() => setOpenId(null)} onChanged={refresh} onOpenEditor={onOpenEditor} />}
    </div>
  );
}

function TicketCard({ t, onOpen, onMove, onDelete }: {
  t: Ticket; onOpen: () => void; onMove: (t: Ticket, d: 1 | -1) => void; onDelete: (t: Ticket) => void;
}) {
  const i = phaseOf(t.stage);
  const made = !!t.clip_url;
  return (
    <div className="tkt-card" onClick={onOpen}>
      <div className="tkt-thumb">
        {made ? (
          <img src={api.ticketThumbUrl(t.id)} alt="" loading="lazy"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          <div className="tkt-thumb-ph"><span>{modeIcon(t.capture_mode)}</span></div>
        )}
        <span className="tkt-mode">{modeLabel(t.capture_mode)}</span>
        {made && <span className="tkt-made">✓ made</span>}
        <button className="icon-btn danger tkt-del" title="Delete this video" onClick={(e) => { e.stopPropagation(); onDelete(t); }}>🗑</button>
      </div>
      <div className="tkt-card-body">
        {t.hook_text ? <div className="tkt-hook-main">“{t.hook_text}”</div> : null}
        <div className="tkt-angle">{t.angle || <span className="muted">Untitled video</span>}</div>
        <div className="tkt-foot" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" disabled={i <= 0} title="Move back a step" onClick={() => onMove(t, -1)}>◀</button>
          <span className="muted tkt-open">Open ⤢</span>
          <button className="icon-btn" disabled={i >= PHASES.length - 1} title="Move forward a step" onClick={() => onMove(t, 1)}>▶</button>
        </div>
      </div>
    </div>
  );
}

function NewTicketModal({ presets, onClose, onCreated }: { presets: Presets | null; onClose: () => void; onCreated: () => void }) {
  const brand = "NoCrapDiet";
  const [angle, setAngle] = useState("");
  const [format, setFormat] = useState("reel");
  const [capture, setCapture] = useState("native-short");
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState<"" | "create" | "ai">("");
  const toast = useToast();
  const formats = presets?.formats ?? ["reel", "carousel"];
  const modes = presets?.capture_modes ?? ["longform-clip", "native-short", "repurpose"];

  const create = async () => {
    setBusy("create");
    try {
      const body = { brand, angle, format, capture_mode: capture, script: script.trim() || undefined };
      const res = script.trim() ? await api.createTicketFromScript(body) : await api.createTicket(body);
      const n = res.beats?.length ?? 0;
      toast(n ? `Ticket created — ${n} beats from script` : "Ticket created", "ok");
      onCreated();
    } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(""); }
  };

  // ✨ One-step AI path: create the ticket, then fill its scenes via Script Factory.
  const generateWithAI = async () => {
    setBusy("ai");
    try {
      const res = await api.createTicket({ brand, angle, format, capture_mode: capture });
      const sf = await api.scriptFactory(res.ticket.id);
      toast(`Created + AI script — ${sf.beats.length} scenes`, "ok");
      onCreated();
    } catch (e: any) { toast(`AI generate failed: ${e?.message || e}`, "err"); } finally { setBusy(""); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New video</h3>
        <label className="field">What's it about?
          <input value={angle} placeholder="e.g. hidden sugar in sauces" onChange={(e) => setAngle(e.target.value)} />
        </label>
        <div className="form-row">
          <label className="field">How will you make it?
            <select value={capture} onChange={(e) => setCapture(e.target.value)}>{modes.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}</select>
          </label>
          <label className="field">Video type
            <select value={format} onChange={(e) => setFormat(e.target.value)}>{formats.map((f) => <option key={f} value={f}>{f === "reel" ? "Reel (tall video)" : f === "carousel" ? "Carousel (photos)" : f}</option>)}</select>
          </label>
        </div>
        <label className="field">Paste your script here <span className="muted">(optional — or leave blank and write it later)</span>
          <textarea rows={8} value={script} placeholder={"HOOK: the line that stops people scrolling\n\nBEAT\nSpoken: what you say out loud\nOn-screen: BIG TEXT\nShot: what to film\n\nBEAT\nSpoken: the next thing you say"} onChange={(e) => setScript(e.target.value)} />
        </label>
        <div className="muted" style={{ fontSize: 12.5 }}>Enter the topic above, then let AI write the script — or write it yourself below.</div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={!!busy}>Cancel</button>
          <button onClick={generateWithAI} disabled={!!busy || !angle.trim()} title={!angle.trim() ? "Enter a topic first" : "Create + write the script with AI"}>{busy === "ai" ? "Generating…" : "✨ Generate with AI"}</button>
          <button className="primary" onClick={create} disabled={!!busy}>{busy === "create" ? "Creating…" : "Create video"}</button>
        </div>
      </div>
    </div>
  );
}

function TicketDetail({ tid, presets, onClose, onChanged, onOpenEditor }: { tid: number; presets: Presets | null; onClose: () => void; onChanged: () => void; onOpenEditor: (pid: number, cid: number) => void }) {
  const [data, setData] = useState<{ ticket: Ticket; beats: Beat[] } | null>(null);
  const toast = useToast();
  const load = () => api.getTicket(tid).then(setData);
  useEffect(() => { load(); }, [tid]);

  const patchT = async (body: Partial<Ticket>) => { await api.patchTicket(tid, body); load(); onChanged(); };
  const move = async (dir: 1 | -1) => {
    if (!data) return;
    const j = phaseOf(data.ticket.stage) + dir;
    if (j < 0 || j >= PHASES.length) return;
    patchT({ stage: PHASES[j].stages[0] });
  };
  const addBeat = async () => { await api.addBeat(tid); load(); onChanged(); };
  const reorder = async (b: Beat, dir: 1 | -1) => {
    if (!data) return;
    const ids = data.beats.map((x) => x.id);
    const i = ids.indexOf(b.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.reorderBeats(tid, ids); load(); onChanged();
  };

  const [building, setBuilding] = useState(false);
  const openEditor = async () => {
    setBuilding(true);
    try { const r = await api.buildEdit(tid); onOpenEditor(r.pid, r.cid); }
    catch (e: any) { toast(`Couldn't open editor: ${e?.message || e}`, "err"); }
    finally { setBuilding(false); }
  };

  const [hooks, setHooks] = useState<string[] | null>(null);
  const [aiBusy, setAiBusy] = useState<"" | "script" | "hook">("");
  const runScript = async () => {
    if (data && data.beats.length && !confirm("Replace all beats with an AI-generated script?")) return;
    setAiBusy("script");
    try { const r = await api.scriptFactory(tid); toast(`Script: ${r.beats.length} beats`, "ok"); setData(r); onChanged(); }
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
          clearInterval(poll); load(); onChanged();
          if (st.state === "done") toast("Reel assembled", "ok");
          if (st.state === "error") toast(`Assemble failed: ${st.error}`, "err");
        }
      }, 1500);
    } catch (e: any) { toast(`Assemble failed: ${e?.message || e}`, "err"); }
  };

  const modes = presets?.capture_modes ?? ["longform-clip", "native-short", "repurpose"];

  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {!data ? <div className="muted">Loading…</div> : (() => {
          const { ticket, beats } = data;
          const proofGaps = beats.filter((b) => b.is_proof_beat && !b.clip_path).length;
          return (
            <>
              <div className="drawer-head">
                <input className="drawer-angle-input" defaultValue={ticket.angle} placeholder="What's it about?"
                  onBlur={(e) => e.target.value !== ticket.angle && patchT({ angle: e.target.value })} />
                <button className="icon-btn" onClick={onClose} title="Close">✕</button>
              </div>
              <div className="drawer-meta-row">
                <span className="muted" style={{ fontSize: 12.5 }}>How you'll make it:</span>
                <select value={ticket.capture_mode} onChange={(e) => patchT({ capture_mode: e.target.value })}>{modes.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}</select>
              </div>
              <div className="drawer-stage">
                <button className="icon-btn" onClick={() => move(-1)} disabled={phaseOf(ticket.stage) <= 0} title="Back a step">◀</button>
                <span className="stage-pill">{phaseLabel(ticket.stage)}</span>
                <button className="icon-btn" onClick={() => move(1)} disabled={phaseOf(ticket.stage) >= PHASES.length - 1} title="Forward a step">▶</button>
              </div>
              <label className="field">First line (the hook)
                <input key={ticket.hook_text} defaultValue={ticket.hook_text} placeholder="the line that stops people scrolling"
                  onBlur={(e) => e.target.value !== ticket.hook_text && patchT({ hook_text: e.target.value })} />
              </label>

              <div className="ai-row">
                <button onClick={runScript} disabled={!!aiBusy}>{aiBusy === "script" ? "Writing…" : "✨ Write my script"}</button>
                <button onClick={runHooks} disabled={!!aiBusy}>{aiBusy === "hook" ? "Thinking…" : "✨ Suggest first lines"}</button>
              </div>
              {hooks && (
                <div className="hook-options">
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Tap one to use it:</div>
                  {hooks.map((h, i) => <button key={i} className="hook-chip" onClick={() => pickHook(h)}>{h}</button>)}
                </div>
              )}

              <div className="drawer-sec-head">
                <h4>Scenes ({beats.length})</h4>
                {proofGaps > 0 && <span className="warn-chip">⚠ {proofGaps} scene{proofGaps > 1 ? "s" : ""} need a video showing proof</span>}
              </div>

              {beats.length === 0 ? (
                <ReimportBox tid={tid} empty onDone={() => { load(); onChanged(); }} />
              ) : (
                <>
                  <div className="beats">
                    {beats.map((b, i) => (
                      <BeatRow key={b.id} b={b} first={i === 0} last={i === beats.length - 1}
                        onChanged={() => { load(); onChanged(); }} onReorder={reorder} toast={toast} />
                    ))}
                  </div>
                  <div className="beat-add-row">
                    <button onClick={addBeat}>+ Add scene</button>
                    <ReimportBox tid={tid} onDone={() => { load(); onChanged(); }} />
                  </div>
                </>
              )}

              {ticket.capture_mode === "native-short" && beats.length > 0 && (
                <div className="assemble-box">
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Open your scenes as one video — preview it, record your voice, add captions and cut:</div>
                  <button className="primary big-btn" onClick={openEditor} disabled={building}>
                    {building ? "Opening editor…" : "✏️ Open in editor"}
                  </button>
                  <div className="muted" style={{ fontSize: 12, margin: "10px 0 8px" }}>…or make the final video right away:</div>
                  <button className="big-btn" onClick={assembleReel} disabled={asm?.state === "running"}>
                    {asm?.state === "running" ? `⏳ ${asm.stage}…` : ticket.clip_url ? "↻ Make it again" : "🎬 Make my video"}
                  </button>
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
            </>
          );
        })()}
      </div>
    </div>
  );
}

/* One editable beat row (uncontrolled inputs → patch on blur to avoid re-render churn). */
function BeatRow({ b, first, last, onChanged, onReorder, toast }: {
  b: Beat; first: boolean; last: boolean; onChanged: () => void; onReorder: (b: Beat, d: 1 | -1) => void; toast: Notify;
}) {
  const clipInput = useRef<HTMLInputElement>(null);
  const voInput = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState<"" | "clip" | "vo">("");
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
        <input className="beat-in" defaultValue={b.on_screen_text} placeholder="Big text on screen…" onBlur={(e) => save("on_screen_text", e.target.value)} />
        <input className="beat-in" defaultValue={b.caption} placeholder="Captions (words along the bottom)…" onBlur={(e) => save("caption", e.target.value)} />
        <input className="beat-in" defaultValue={b.shot_cue} placeholder="What to film…" onBlur={(e) => save("shot_cue", e.target.value)} />
        <div className="beat-media">
          <button className={"slot" + (b.clip_path ? " filled" : "")} onClick={() => clipInput.current?.click()} disabled={up === "clip"}>
            {up === "clip" ? "…" : b.clip_path ? "✓ Video added" : "＋ Add video"}
          </button>
          <button className={"slot" + (b.voiceover_path ? " filled" : "")} onClick={() => voInput.current?.click()} disabled={up === "vo"}>
            {up === "vo" ? "…" : b.voiceover_path ? "✓ Voice added" : "＋ Add voice"}
          </button>
          <input ref={clipInput} type="file" accept="video/*" hidden onChange={(e) => upClip(e.target.files?.[0])} />
          <input ref={voInput} type="file" accept="audio/*" hidden onChange={(e) => upVo(e.target.files?.[0])} />
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

/* ------------------------------- Intake -------------------------------- */
function Intake({ onSpun }: { onSpun: () => void }) {
  const [outliers, setOutliers] = useState<Outlier[] | null>(null);
  const [f, setF] = useState({ url: "", hook: "", why_popped: "", angle: "", caption: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const refresh = () => api.listOutliers().then(setOutliers);
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!f.angle.trim() && !f.hook.trim() && !f.url.trim()) { toast("Add at least an angle, hook, or URL", "err"); return; }
    setBusy(true);
    try { await api.createOutlier(f); setF({ url: "", hook: "", why_popped: "", angle: "", caption: "" }); toast("Added to swipe file", "ok"); refresh(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  const spin = async (o: Outlier) => { const r = await api.ticketFromOutlier(o.id); toast(`Ticket spun (${r.ticket.angle || "no angle"})`, "ok"); onSpun(); };
  const del = async (o: Outlier) => { await api.deleteOutlier(o.id); toast("Removed", "ok"); refresh(); };

  return (
    <div className="page">
      <div className="page-head"><h2>Ideas</h2><span className="muted">Save videos that inspire you — turn any one into a new video</span></div>
      <div className="intake-form">
        <label className="field">What's the idea?<input value={f.angle} placeholder="e.g. hidden sugar in sauces" onChange={(e) => setF({ ...f, angle: e.target.value })} /></label>
        <div className="form-row">
          <label className="field">Their first line <span className="muted">(optional)</span><input value={f.hook} placeholder="the line that grabbed you" onChange={(e) => setF({ ...f, hook: e.target.value })} /></label>
          <label className="field">Link <span className="muted">(optional)</span><input value={f.url} placeholder="https://…" onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        </div>
        <label className="field">Why it worked <span className="muted">(optional)</span><textarea rows={2} value={f.why_popped} onChange={(e) => setF({ ...f, why_popped: e.target.value })} /></label>
        <div className="modal-actions"><button className="primary" onClick={add} disabled={busy}>{busy ? "Saving…" : "Save this idea"}</button></div>
      </div>

      <div className="page-head" style={{ marginTop: 28 }}><h3 style={{ margin: 0 }}>Saved ideas</h3><span className="muted">{outliers?.length ?? 0} saved</span></div>
      {outliers == null ? <div className="muted">Loading…</div> : outliers.length === 0 ? (
        <div className="empty"><div className="big" style={{ fontSize: 26 }}>💡</div><div style={{ fontWeight: 700, color: "var(--text)" }}>No saved ideas yet</div><div>Add one above to get started.</div></div>
      ) : (
        <div className="swipe-list">
          {outliers.map((o) => (
            <div className="swipe-card" key={o.id}>
              <div className="swipe-main">
                <div className="swipe-angle">{o.angle || <span className="muted">(no title)</span>}</div>
                {o.hook && <div className="swipe-hook">“{o.hook}”</div>}
                {o.why_popped && <div className="muted swipe-why">{o.why_popped}</div>}
                {o.url && <a className="swipe-url" href={o.url} target="_blank" rel="noreferrer">{o.url}</a>}
              </div>
              <div className="swipe-actions">
                <button className="primary" onClick={() => spin(o)}>Make a video from this →</button>
                <button className="icon-btn danger" title="Delete" onClick={() => del(o)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
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

  return (
    <div className="page">
      <div className="page-head"><h2>Downloads</h2><span className="muted">{items.length} finished video{items.length === 1 ? "" : "s"}</span></div>
      {items.length === 0 ? (
        <div className="empty">
          <div className="big" style={{ fontSize: 28 }}>⬇</div>
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 16 }}>No videos yet</div>
          <div>Make a video and it shows up here, ready to download.</div>
        </div>
      ) : (
        [...folders.entries()].map(([group, subs]) => (
          <DownloadFolder key={group} group={group} subs={subs} onPreview={setPreview} onDownload={dl} />
        ))
      )}
      {preview && (
        <VideoModal src={preview.download} title={preview.title}
          onClose={() => setPreview(null)} onDownload={() => dl(preview)} />
      )}
    </div>
  );
}

function DownloadFolder({ group, subs, onPreview, onDownload }: {
  group: string; subs: Map<string, ExportItem[]>; onPreview: (it: ExportItem) => void; onDownload: (it: ExportItem) => void;
}) {
  const [open, setOpen] = useState(true);
  const total = [...subs.values()].reduce((n, arr) => n + arr.length, 0);
  return (
    <div className="dl-folder">
      <button className="dl-folder-head" onClick={() => setOpen((o) => !o)}>
        <span className="dl-caret">{open ? "▾" : "▸"}</span>
        <span className="dl-folder-ic">📁</span>
        <span className="dl-folder-name">{group}</span>
        <span className="board-count">{total}</span>
      </button>
      {open && [...subs.entries()].map(([sg, arr]) => (
        <div className="dl-sub" key={sg}>
          <div className="dl-sub-head">{sg} <span className="muted">· {arr.length}</span></div>
          <div className="exp-grid">
            {arr.map((it) => (
              <div className="exp-card" key={`${it.kind}-${it.id}`}>
                <div className="exp-thumb" onClick={() => onPreview(it)} title="Click to preview">
                  {it.thumb ? <img src={it.thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <div className="exp-noimg">🎬</div>}
                  <div className="exp-play">▶</div>
                  <span className={"exp-kind " + it.kind}>{it.kind}</span>
                  {it.score != null && <span className="exp-score">{it.score}</span>}
                </div>
                <div className="exp-body">
                  <div className="exp-title">{it.title}</div>
                  <div className="muted exp-sub">{it.subtitle}</div>
                  <button className="primary exp-dl" onClick={() => onDownload(it)}>⬇ Download</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Queue --------------------------------- */
const PLATFORM_LABELS: Record<string, string> = { tt: "TikTok", ig: "Instagram", yt: "YouTube" };
const platLabel = (p: string) => PLATFORM_LABELS[p] ?? p.toUpperCase();

function defaultWhen(): string {
  // Tomorrow 9:00, formatted for <input type="datetime-local"> (YYYY-MM-DDTHH:MM).
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Queue() {
  const [data, setData] = useState<QueueData | null>(null);
  const refresh = () => api.getQueue().then(setData);
  useEffect(() => { refresh(); }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h2>Schedule</h2>
        <span className="muted">Queue your videos and post them to TikTok, Instagram &amp; YouTube</span>
      </div>
      {data && data.dry_run && (
        <div className="dry-banner">🧪 <b>Practice mode</b> — posting is simulated, nothing is sent. Add <code>UPLOAD_POST_API_KEY</code> + <code>UPLOAD_POST_USER</code> to <code>backend/.env</code> to post for real.</div>
      )}
      {data && !data.dry_run && !data.config.user_set && (
        <div className="dry-banner warn">⚠ <b>Almost live</b> — your API key is set, but <code>UPLOAD_POST_USER</code> isn't. Set it to your Upload-Post profile name (with TikTok/Instagram/YouTube connected on the Upload-Post dashboard) in <code>backend/.env</code>.</div>
      )}
      {data && !data.dry_run && data.config.user_set && (
        <div className="dry-banner live">🟢 <b>Live</b> — posting as <b>{data.config.user}</b> via Upload-Post.</div>
      )}

      <h3 className="ins-h">Ready to schedule</h3>
      {!data ? <div className="muted">Loading…</div>
        : data.ready.length === 0 ? <div className="muted">Nothing ready yet — make a video first; it shows up here once it's assembled.</div>
        : <div className="q-grid">{data.ready.map((t) => <ScheduleCard key={t.id} t={t} platforms={data.platforms} onDone={refresh} />)}</div>}

      <h3 className="ins-h" style={{ marginTop: 28 }}>In the queue ({data?.scheduled.length ?? 0})</h3>
      {!data || data.scheduled.length === 0 ? <div className="muted">Nothing queued.</div>
        : <div className="q-list">{data.scheduled.map((t) => <QueuedRow key={t.id} t={t} dryRun={data.dry_run} onDone={refresh} />)}</div>}

      {data && data.posted.length > 0 && (
        <>
          <h3 className="ins-h" style={{ marginTop: 28 }}>Recently posted</h3>
          <div className="q-list">{data.posted.map((t) => <PostedRow key={t.id} t={t} />)}</div>
        </>
      )}
    </div>
  );
}

function ScheduleCard({ t, platforms, onDone }: { t: QueueTicket; platforms: string[]; onDone: () => void }) {
  const [when, setWhen] = useState(defaultWhen());
  const [picked, setPicked] = useState<string[]>(t.platforms?.length ? t.platforms : platforms);
  const [busy, setBusy] = useState("");
  const toast = useToast();
  const title = t.hook_text || t.angle || `Video ${t.id}`;
  const toggle = (p: string) => setPicked((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);

  const schedule = async () => {
    if (picked.length === 0) { toast("Pick at least one platform", "err"); return; }
    setBusy("sch");
    try { const r = await api.postTicket(t.id, { platforms: picked, scheduled_at: when }); toast(r.message, "ok"); onDone(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(""); }
  };
  const postNow = async () => {
    if (picked.length === 0) { toast("Pick at least one platform", "err"); return; }
    setBusy("post");
    try { const r = await api.postTicket(t.id, { platforms: picked }); toast(r.message, "ok"); onDone(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(""); }
  };

  return (
    <div className="q-card">
      <div className="q-thumb">{t.has_video ? <img src={api.ticketThumbUrl(t.id)} alt="" /> : <div className="q-noimg">No preview</div>}</div>
      <div className="q-body">
        <div className="q-title">{title}</div>
        <div className="q-sub muted">{t.brand} · {t.format}</div>
        <label className="q-when">When<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        <div className="q-plats">{platforms.map((p) => (
          <button key={p} type="button" className={"q-chip" + (picked.includes(p) ? " on" : "")} onClick={() => toggle(p)}>{platLabel(p)}</button>
        ))}</div>
        <div className="q-actions">
          <button className="ghost" onClick={schedule} disabled={!!busy}>{busy === "sch" ? "…" : "Schedule"}</button>
          <button className="primary" onClick={postNow} disabled={!!busy}>{busy === "post" ? "…" : "Post now"}</button>
        </div>
      </div>
    </div>
  );
}

function QueuedRow({ t, dryRun, onDone }: { t: QueueTicket; dryRun: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState("");
  const toast = useToast();
  const title = t.hook_text || t.angle || `Video ${t.id}`;
  const unsched = async () => { setBusy("un"); try { await api.scheduleTicket(t.id, { scheduled_at: null }); toast("Removed from the queue", "ok"); onDone(); } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(""); } };
  return (
    <div className="q-row">
      <div className="q-row-main">
        <div className="q-title">{title}</div>
        <div className="q-sub muted">{dryRun ? "🗓 queued (practice)" : "🟢 queued on Upload-Post"} for {fmtWhen(t.scheduled_at)} · {(t.platforms || []).map(platLabel).join(", ") || "no platforms"}</div>
      </div>
      <div className="q-actions">
        <button className="ghost" onClick={unsched} disabled={!!busy}>{busy === "un" ? "…" : "Remove from list"}</button>
      </div>
    </div>
  );
}

function PostedRow({ t }: { t: QueueTicket }) {
  const title = t.hook_text || t.angle || `Video ${t.id}`;
  return (
    <div className="q-row done">
      <div className="q-row-main">
        <div className="q-title">{title}</div>
        <div className="q-sub muted">✅ Posted {fmtWhen(t.posted_at)} · {(t.platforms || []).map(platLabel).join(", ")}</div>
      </div>
    </div>
  );
}

/* ------------------------------ Insights ------------------------------- */
function Insights() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const refresh = () => { api.getInsights().then(setData); api.listTickets().then(setTickets); };
  useEffect(() => { refresh(); }, []);

  const k = data?.kpis;
  const kpi = (label: string, val: number, accent = false) => (
    <div className={"kpi" + (accent ? " kpi-accent" : "")}><div className="kpi-val">{val}</div><div className="kpi-label">{label}</div></div>
  );
  return (
    <div className="page">
      <div className="page-head"><h2>Results</h2><span className="muted">What's working — ranked by saves + follows, the numbers that matter</span></div>
      <div className="kpi-row">
        {kpi("Videos", k?.tickets ?? 0)}{kpi("Posted", k?.posted ?? 0)}
        {kpi("Follows", k?.follows ?? 0, true)}{kpi("Saves", k?.saves ?? 0, true)}
        {kpi("Views", k?.views ?? 0)}{kpi("Shares", k?.sends ?? 0)}
      </div>

      {data && data.trend.length > 0 && <TrendChart trend={data.trend} />}

      <PerfLogger tickets={tickets} onLogged={refresh} />

      {data && data.by_platform.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 className="ins-h">By platform <span className="muted">(where it's landing)</span></h3>
          <table className="ins-table plat-table">
            <thead><tr><th>Platform</th><th>Posts</th><th>Views</th><th>Follows</th><th>Saves</th><th>Shares</th><th>Score</th></tr></thead>
            <tbody>{data.by_platform.map((p) => (
              <tr key={p.platform}><td>{platLabel(p.platform)}</td><td>{p.posts}</td><td>{p.views}</td><td>{p.follows}</td><td>{p.saves}</td><td>{p.sends}</td><td><b>{p.score}</b></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="ins-cols">
        <div>
          <h3 className="ins-h">Best ideas <span className="muted">(by saves + follows)</span></h3>
          {!data || data.angles.length === 0 ? <div className="muted">Nothing here yet — add how a video did below.</div> : (
            <table className="ins-table"><thead><tr><th>Idea</th><th>Posts</th><th>Avg score</th></tr></thead>
              <tbody>{data.angles.map((a) => <tr key={a.angle}><td>{a.angle}</td><td>{a.posts_count}</td><td><b>{a.avg_score}</b></td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="ins-h">Best videos</h3>
          {!data || data.top.length === 0 ? <div className="muted">Nothing logged yet.</div> : (
            <table className="ins-table"><thead><tr><th>#</th><th>Idea</th><th>Saves+Follows</th></tr></thead>
              <tbody>{data.top.map((t, i) => <tr key={t.ticket_id}><td>{i + 1}</td><td>{t.angle || `Video ${t.ticket_id}`}</td><td><b>{t.score}</b></td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendChart({ trend }: { trend: InsightsData["trend"] }) {
  const max = Math.max(1, ...trend.map((p) => p.score));
  return (
    <div className="trend">
      <h3 className="ins-h">Momentum <span className="muted">(saves + follows per day)</span></h3>
      <div className="trend-bars">
        {trend.map((p) => (
          <div key={p.date} className="trend-col" title={`${p.date}: ${p.score} (saves+follows)`}>
            <div className="trend-bar" style={{ height: `${Math.round((p.score / max) * 100)}%` }} />
            <div className="trend-x">{p.date.length >= 10 ? p.date.slice(5) : p.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerfLogger({ tickets, onLogged }: { tickets: Ticket[]; onLogged: () => void }) {
  const [tid, setTid] = useState<number | "">("");
  const [platform, setPlatform] = useState("tt");
  const [f, setF] = useState({ views: 0, follows: 0, saves: 0, sends: 0 });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const num = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: parseInt(e.target.value || "0", 10) || 0 });
  const log = async () => {
    if (tid === "") { toast("Pick a ticket", "err"); return; }
    setBusy(true);
    try { await api.logPerf({ ticket_id: tid as number, platform, ...f }); toast("Performance logged", "ok"); setF({ views: 0, follows: 0, saves: 0, sends: 0 }); onLogged(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="perf-log">
      <h3 className="ins-h">Add how a video did</h3>
      <div className="perf-row">
        <select value={tid} onChange={(e) => setTid(e.target.value ? parseInt(e.target.value, 10) : "")}>
          <option value="">Pick a video…</option>
          {tickets.map((t) => <option key={t.id} value={t.id}>{t.angle || `Video ${t.id}`}</option>)}
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option></select>
        <label>Views<input type="number" value={f.views} onChange={num("views")} /></label>
        <label>Follows<input type="number" value={f.follows} onChange={num("follows")} /></label>
        <label>Saves<input type="number" value={f.saves} onChange={num("saves")} /></label>
        <label>Shares<input type="number" value={f.sends} onChange={num("sends")} /></label>
        <button className="primary" onClick={log} disabled={busy}>{busy ? "…" : "Save"}</button>
      </div>
    </div>
  );
}

/* ------------------------------- Home ---------------------------------- */
function Home({ presets, onOpen }: { presets: Presets | null; onOpen: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const toast = useToast();
  const refresh = () => api.listProjects().then(setProjects);
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, []);

  const del = async (p: Project) => {
    if (!confirm(`Delete "${p.name}"? This removes its files.`)) return;
    await api.deleteProject(p.id); toast("Project deleted", "ok"); refresh();
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
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 16 }}>No projects yet</div>
          <div>Paste a YouTube link or upload a video above to get your first clips.</div>
        </div>
      ) : (
        <div className="proj-grid">{projects.map((p) => <ProjectCard key={p.id} p={p} onOpen={onOpen} onDelete={del} />)}</div>
      )}
    </div>
  );
}

function ProjectCard({ p, onOpen, onDelete }: { p: Project; onOpen: (id: number) => void; onDelete: (p: Project) => void }) {
  const [imgOk, setImgOk] = useState(true);
  const ready = p.status === "ready";
  return (
    <div className="proj-card" onClick={() => ready && onOpen(p.id)}>
      <div className="proj-thumb">
        {ready && imgOk ? <img src={api.projectThumbUrl(p.id)} alt="" onError={() => setImgOk(false)} loading="lazy" />
          : <div className="ph" style={{ fontSize: 30 }}>{p.status === "error" ? "!" : "▦"}</div>}
      </div>
      <div className="proj-body">
        <div className="name">{p.name}</div>
        <div className="proj-tags"><span className="tag">{p.brain}</span><span className="tag">{p.aspect}</span><span className="tag">{p.caption_preset}</span></div>
        {!ready && p.status !== "error" && (
          <div><div className="muted" style={{ marginBottom: 5, fontSize: 12.5 }}>{p.stage || p.status}…</div>
            <div className="progress"><div style={{ width: `${p.progress}%` }} /></div></div>
        )}
        <div className="proj-foot">
          {ready ? <span className="badge ready">✓ ready</span> : p.status === "error" ? <span className="badge error">error</span> : <span className="badge busy">working</span>}
          <div className="proj-actions" onClick={(e) => e.stopPropagation()}>
            {ready && <button className="sm" onClick={() => onOpen(p.id)}>Open</button>}
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
  const [brain, setBrain] = useState("ollama"); const [aspect, setAspect] = useState("9:16"); const [preset, setPreset] = useState("capcut");
  const [transcribe, setTranscribe] = useState("local");
  const [busy, setBusy] = useState(false); const toast = useToast();

  const submit = async () => {
    if (!name.trim()) { toast("Give your project a name", "err"); return; }
    setBusy(true);
    try {
      if (mode === "url") {
        if (!url.trim()) { toast("Paste a YouTube URL", "err"); return; }
        await api.createFromUrl({ name, source_url: url, brain, transcribe_backend: transcribe, aspect, caption_preset: preset, mode: genMode });
      } else {
        if (!file) { toast("Choose a video file", "err"); return; }
        const fd = new FormData();
        fd.append("name", name); fd.append("brain", brain); fd.append("transcribe_backend", transcribe); fd.append("aspect", aspect); fd.append("caption_preset", preset); fd.append("mode", genMode); fd.append("file", file);
        await api.createFromUpload(fd);
      }
      setName(""); setUrl(""); setFile(null);
      toast(genMode === "caption" ? "Captioning your clip…" : "Project started — finding clips…", "ok");
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>New project</h2>
        <div className="seg">
          <button className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}>YouTube link</button>
          <button className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>Upload file</button>
        </div>
      </div>
      <div className="row">
        <label className="field grow">Project name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="My video" /></label>
        {mode === "url" ? (
          <label className="field grow">YouTube URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" /></label>
        ) : (
          <label className="field grow">Video file<input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        )}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <label className="field grow">What do you want?
          <div className="seg" style={{ marginTop: 4 }}>
            <button className={genMode === "moments" ? "on" : ""} onClick={() => setGenMode("moments")}>Find viral moments</button>
            <button className={genMode === "caption" ? "on" : ""} onClick={() => setGenMode("caption")}>Just caption my clip</button>
          </div>
        </label>
      </div>
      <div className="row" style={{ marginTop: 14, alignItems: "flex-end" }}>
        {genMode === "moments" && <label className="field">Brain<select value={brain} onChange={(e) => setBrain(e.target.value)}>{(presets?.brains ?? ["ollama"]).map((b) => <option key={b}>{b}</option>)}</select></label>}
        <label className="field">Transcription<select value={transcribe} onChange={(e) => setTranscribe(e.target.value)}>{(presets?.transcribe ?? ["local"]).map((t) => <option key={t} value={t}>{t === "local" ? "Local (free)" : "ElevenLabs"}</option>)}</select></label>
        <label className="field">Aspect<select value={aspect} onChange={(e) => setAspect(e.target.value)}>{(presets?.aspects ?? ["9:16"]).map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field">Caption style<select value={preset} onChange={(e) => setPreset(e.target.value)}>{(presets?.captions ?? ["capcut"]).map((c) => <option key={c}>{c}</option>)}</select></label>
        <div style={{ flex: 1 }} />
        <button className="primary" disabled={busy} onClick={submit}>{busy ? "Starting…" : genMode === "caption" ? "✨ Caption my clip" : "✨ Generate clips"}</button>
      </div>
    </div>
  );
}

/* ---------------------------- Moments grid ----------------------------- */
// Projects whose editor we've already auto-opened (caption mode) — prevents a
// back-navigation loop.
const autoOpenedPids = new Set<number>();
function MomentsGrid({ pid, onName, onEdit, onBack }: {
  pid: number; onName: (s: string) => void; onEdit: (cid: number) => void; onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const toast = useToast();
  const refresh = () => api.getProject(pid).then((d) => { setProject(d.project); setClips(d.clips); onName(d.project.name); });
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [pid]);

  // Caption mode = one full-length clip → drop the user straight into the editor, but
  // only ONCE per project (a module-level guard) so backing out doesn't re-loop.
  useEffect(() => {
    if (!autoOpenedPids.has(pid) && project?.mode === "caption" && project.status === "ready" && clips.length >= 1) {
      autoOpenedPids.add(pid);
      onEdit(clips[0].id);
    }
  }, [project, clips]);

  const sorted = [...clips].sort((a, b) => b.score - a.score);
  const act = async (fn: () => Promise<any>, msg: string) => { await fn(); toast(msg, "ok"); refresh(); };

  return (
    <div className="page">
      <div className="page-head">
        <div><button className="back" onClick={onBack}>← Projects</button>
          <h2 style={{ marginTop: 4 }}>{project?.name}</h2></div>
        <span className="muted">{clips.length} moments · sorted by viral score</span>
      </div>
      {!project ? <div className="skeleton" style={{ height: 300 }} /> : (
        <div className="moments-grid">
          {sorted.map((c) => (
            <MomentCard key={c.id} clip={c} onEdit={() => onEdit(c.id)}
              onRender={() => act(() => api.renderClip(c.id), "Exporting…")}
              onDelete={() => confirm(`Delete "${c.title}"?`) && act(() => api.deleteClip(c.id), "Clip deleted")} />
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
function EditorPage({ pid, cid, presets, onName, onBack }: {
  pid: number; cid: number; presets: Presets | null; onName: (s: string) => void; onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const refresh = () => api.getProject(pid).then((d) => {
    setProject(d.project); onName(d.project.name);
    setClip(d.clips.find((c) => c.id === cid) || null);
  });
  useEffect(() => {
    refresh(); api.getWords(pid).then((d) => setWords(d.words));
    const t = setInterval(refresh, 3000); return () => clearInterval(t);
  }, [pid, cid]);

  if (!project || !clip) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
  return <ClipEditor key={clip.id} pid={pid} clip={clip} words={words} duration={project.duration} presets={presets} onChange={refresh} onBack={onBack} />;
}

function fmt(t: number) { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${s.toString().padStart(2, "0")}`; }

function ClipEditor({ pid, clip, words, duration, presets, onChange, onBack }: {
  pid: number; clip: Clip; words: Word[]; duration: number; presets: Presets | null; onChange: () => void; onBack: () => void;
}) {
  const presetMap = presets?.caption_styles ?? FALLBACK_PRESETS;
  const jsonOr = <T,>(s: string | undefined, fb: T): T => { if (s) { try { return JSON.parse(s); } catch { /* */ } } return fb; };
  const baseStyle = presetMap[clip.caption_preset] ?? FALLBACK_PRESETS.capcut;
  const initDoc: EditDoc = {
    start: clip.start, end: clip.end, preset: clip.caption_preset,
    style: jsonOr(clip.style_json, baseStyle),
    words: jsonOr(clip.words_json, wordsInRange(words, clip.start, clip.end)),
    center: clip.crop_center, resolution: clip.resolution ?? "1080p", title: clip.title,
    cuts: jsonOr(clip.cuts_json, [] as [number, number][]),
  };
  const { doc, set, undo, redo, canUndo, canRedo } = useHistory<EditDoc>(initDoc);

  const [tool, setTool] = useState<string>("subs");
  const [subsTab, setSubsTab] = useState<"style" | "edit">("style");
  // Resync captions from the transcript when the clip range moves to a new section.
  // Saved words are respected on open; once the user hand-edits words this session,
  // we stop auto-resyncing so their edits aren't clobbered by a later trim.
  const [manualWords, setManualWords] = useState<boolean>(false);
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
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
  const loopRangeRef = useRef<{ s: number; e: number } | null>(null);
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
  const resyncCaptions = () => { if (words.length) { setManualWords(false); set({ words: wordsInRange(words, doc.start, doc.end) }); } };

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

  // Autosave (debounced) whenever the doc changes.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSaveState("saving");
    const id = setTimeout(async () => {
      await api.patchClip(clip.id, { start: doc.start, end: doc.end, caption_preset: doc.preset, resolution: doc.resolution, crop_center: doc.center, style: doc.style, words: doc.words, title: doc.title, cuts: doc.cuts });
      setSaveState("saved"); onChange();
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
        if (lr) {
          // Recording: loop within the range so you can keep reading — and skip over
          // any cut ranges so you record against the SAME video the export produces.
          if (v.currentTime >= lr.e || v.currentTime < lr.s - 0.05) v.currentTime = lr.s;
          else {
            for (const [a, b] of doc.cuts) {
              if (v.currentTime >= a && v.currentTime < b) {
                // Land safely PAST the cut (the +0.12 clears frame-snap so we don't
                // re-seek into it every frame); if the cut runs to the end, loop instead.
                v.currentTime = b >= lr.e - 0.05 ? lr.s : Math.min(b + 0.12, lr.e);
                break;
              }
            }
          }
        } else {
          if (v.currentTime >= doc.end) v.currentTime = doc.start;
          for (const [a, b] of doc.cuts) { if (v.currentTime >= a && v.currentTime < b) { v.currentTime = Math.min(b + 0.12, doc.end); break; } }
          // Keep a saved voiceover aligned to the clip's local time (preview only).
          const au = audioRef.current;
          if (au && voUrl) { const want = v.currentTime - doc.start; if (Math.abs(au.currentTime - want) > 0.25) au.currentTime = Math.max(0, want); }
        }
        setTime(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, doc.start, doc.end, doc.cuts, voUrl]);

  // keyboard undo/redo
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [undo, redo]);

  const onLoaded = () => { if (videoRef.current) videoRef.current.currentTime = doc.start; };
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    const au = audioRef.current;
    if (playing) { v.pause(); au?.pause(); setPlaying(false); }
    else {
      if (v.currentTime < doc.start || v.currentTime > doc.end) v.currentTime = doc.start;
      v.muted = !!voUrl;                       // VO replaces the source audio in preview
      if (au && voUrl) { au.currentTime = Math.max(0, v.currentTime - doc.start); au.play().catch(() => {}); }
      v.play(); setPlaying(true);
    }
  };
  const seek = (t: number) => {
    // Skip into a removed (cut) chunk — jump past it so cuts behave as deleted.
    for (const [a, b] of doc.cuts) { if (t >= a && t < b) { t = b; break; } }
    if (videoRef.current) videoRef.current.currentTime = t; setTime(t);
  };
  // Recording: roll the video over a range (a scene, or the whole clip) — muted, at
  // the chosen reading rate — so the teleprompter scrolls while you read.
  const startRecordPlayback = (range?: { s: number; e: number }) => {
    const v = videoRef.current; if (!v) return;
    // stop any preview that's running
    previewChain.current = false; window.clearTimeout(previewTimer.current);
    const a = audioRef.current; if (a) { a.pause(); a.onended = null; } setPreviewMode("off");
    const r = range ?? { s: doc.start, e: doc.end };
    loopRangeRef.current = r;
    v.currentTime = r.s; v.muted = true; v.playbackRate = readRate; v.play().catch(() => {});
    setPlaying(true); setRecording(true);
  };
  const stopRecordPlayback = () => {
    const v = videoRef.current; if (v) { v.pause(); v.playbackRate = 1; }
    loopRangeRef.current = null; setPlaying(false); setRecording(false);
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
    const sc = markers[i]; const v = videoRef.current; const a = audioRef.current;
    if (!sc || !v) { stopPreview(); return; }
    setSceneIdx(i);
    loopRangeRef.current = { s: sc.start, e: sc.end };
    v.currentTime = sc.start; v.muted = true; v.playbackRate = 1; v.play().catch(() => {});
    setPlaying(true);
    window.clearTimeout(previewTimer.current);
    const advance = () => { if (previewChain.current && i + 1 < markers.length) runScene(i + 1); else stopPreview(); };
    if (sceneVos[i] && a) {
      a.onended = advance; a.src = api.sceneVoiceoverUrl(clip.id, i) + "?v=" + voBust;
      a.currentTime = 0; a.play().catch(() => {});
    } else {
      if (a) a.onended = null;
      previewTimer.current = window.setTimeout(advance, Math.max(400, (sc.end - sc.start) * 1000));
    }
  };
  const playScene = (i: number) => { previewChain.current = false; setPreviewMode("scene"); runScene(i); };
  const playReel = () => { previewChain.current = true; setPreviewMode("reel"); runScene(0); };
  const selectScene = (i: number) => { if (previewMode !== "off") stopPreview(); const j = Math.max(0, Math.min(i, markers.length - 1)); setSceneIdx(j); if (markers[j]) seek(markers[j].start); };
  const choosePreset = (name: string) => set({ preset: name, style: presetMap[name] ?? FALLBACK_PRESETS.capcut });
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

  const rendered = clip.status === "rendered";
  const busy = clip.status === "rendering";
  const exportClip = async () => { await api.renderClip(clip.id); toast("Exporting clip…", "info"); onChange(); };

  return (
    <div className="ed2">
      <div className="ed2-top">
        <button className="back" onClick={onBack}>← Back</button>
        <input className="ed2-title" value={doc.title} onChange={(e) => set({ title: e.target.value })} placeholder="Untitled clip" />
        <div className="ed2-top-right">
          <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
          <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
          <span className="save-ind">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : ""}</span>
          <button className="primary" onClick={exportClip} disabled={busy}>{busy ? (clip.stage || "Rendering…") : rendered ? "Re-export" : "Export"}</button>
          {rendered && <button className="icon-btn" title="Download" onClick={() => downloadClip(clip.id, doc.title, toast)}>⬇</button>}
        </div>
      </div>

      <div className="ed2-body">
        <div className="ed2-rail">
          {TOOLS.map((t) => (
            <button key={t.id} className={"rail-btn" + (tool === t.id ? " on" : "")} onClick={() => setTool(t.id)} title={t.label}>
              <span className="rail-ic">{t.icon}</span><span className="rail-lb">{t.label}</span>
              {t.soon && <span className="soon-dot" title="Coming soon" />}
            </button>
          ))}
        </div>

        <div className="ed2-stage">
          <div className={"phone" + (tool === "reframe" ? " reframing" : "")} ref={boxRef} onPointerDown={onPreviewDown}>
            <video ref={videoRef} src={api.sourceUrl(pid)} onLoadedMetadata={onLoaded} style={{ objectPosition: `${doc.center * 100}% 50%` }} playsInline />
            <audio ref={audioRef} src={hasScenes ? undefined : (voUrl ?? undefined)} preload="auto" />
            <CaptionOverlay words={editedWords} time={srcToEdited(time, segments)} style={doc.style} containerHeight={boxH} />
            {tool === "reframe" && <div className="reframe-guide" style={{ left: `${doc.center * 100}%` }} />}
          </div>
          {tool === "voice" && <Teleprompter words={activeScene ? wordsInRange(doc.words, activeScene.start, activeScene.end) : doc.words} time={time} maxWords={doc.style.max_words} />}
          <div className="play-row">
            <button className="primary round" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
            <span className="timecode">{fmt(effPos)} / {fmt(effLen)}{removedTotal > 0 ? ` (−${fmt(removedTotal)} cut)` : ""}</span>
            <span className="ar-badge">9:16</span>
          </div>
          {busy && <div className="muted" style={{ fontSize: 12.5 }}>⏳ {clip.stage || "Working"}… (first export downloads the full video)</div>}
          {clip.error && <div className="err">{clip.error}</div>}
        </div>

        <div className="ed2-panel">
          {tool === "trim" && <TrimPanel doc={doc} set={set} max={win.e} />}
          {tool === "cut" && <CutPanel doc={doc} set={set} time={time} onSeek={seek} />}
          {tool === "voice" && (hasScenes
            ? <SceneVoicePanel cid={clip.id} markers={markers} sceneIdx={Math.min(sceneIdx, markers.length - 1)} onSelectScene={selectScene}
                sceneVos={sceneVos} setSceneVos={applySceneVos} readRate={readRate} setReadRate={setReadRate}
                activeScene={activeScene!} onRecordStart={startRecordPlayback} onRecordStop={stopRecordPlayback}
                previewMode={previewMode} onPlayScene={playScene} onPlayReel={playReel} onStopPreview={stopPreview} onChanged={onChange} toast={toast} />
            : <VoicePanel cid={clip.id} voUrl={voUrl} onChanged={(u) => { setVoUrl(u); onChange(); }} toast={toast} onRecordStart={startRecordPlayback} onRecordStop={stopRecordPlayback} />)}
          {tool === "reframe" && <ReframePanel center={doc.center} set={set} autoCenter={doAutoCenter} autoBusy={autoBusy} />}
          {tool === "subs" && (
            <div className="panel-body">
              <div className="seg-toggle wide">
                <button className={subsTab === "style" ? "on" : ""} onClick={() => setSubsTab("style")}>Style</button>
                <button className={subsTab === "edit" ? "on" : ""} onClick={() => setSubsTab("edit")}>Edit words</button>
              </div>
              {subsTab === "style" ? (
                <>
                  <div className="preset-chips">{(presets?.captions ?? Object.keys(FALLBACK_PRESETS)).map((c) => (
                    <button key={c} className={"chip" + (doc.preset === c ? " on" : "")} onClick={() => choosePreset(c)}>{c}</button>))}</div>
                  <StyleEditor style={doc.style} onChange={(s) => set({ style: s })} />
                  <label className="field">Export resolution
                    <select value={doc.resolution} onChange={(e) => set({ resolution: e.target.value })}>
                      {(presets?.resolutions ?? [{ id: "1080p", label: "1080p", hint: "1080×1920" }]).map((r) => (
                        <option key={r.id} value={r.id}>{r.label} · {r.hint}</option>))}
                    </select>
                  </label>
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
        <FilmstripTimeline pid={pid} winStart={win.s} winEnd={win.e} start={doc.start} end={doc.end} time={time} zoom={zoom} cuts={doc.cuts} markers={markers}
          onStart={(t) => set({ start: t })} onEnd={(t) => set({ end: t })} onScrub={seek} />
      </div>
    </div>
  );
}

/* ---------------- wayin-style clip editor helpers ---------------- */
type EditDoc = { start: number; end: number; preset: string; style: CaptionStyle; words: Word[]; center: number; resolution: string; title: string; cuts: [number, number][] };
type Seg = [number, number];

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

/* Retime caption words onto the edited timeline. A cut removes VIDEO, not caption
   text — so EVERY word is kept (word 4 5 6, cut, 7 8 — never dropped). Words that
   fell inside a removed gap collapse to the seam, keeping their order. Mirrors
   backend render.remap_words_for_cuts so the preview matches the export exactly. */
function remapWords(words: Word[], segs: Seg[]): Word[] {
  return words
    .map((w) => {
      const s = srcToEdited(w.start, segs);
      let e = srcToEdited(w.end, segs);
      if (e <= s) e = s + Math.max(0.15, w.end - w.start);   // word lived inside a cut → keep it at the seam
      return { ...w, start: s, end: e };
    })
    .sort((x, y) => x.start - y.start);
}

const TOOLS: { id: string; label: string; icon: string; soon?: boolean }[] = [
  { id: "trim", label: "Trim", icon: "✂" },
  { id: "cut", label: "Cut", icon: "⌦" },
  { id: "reframe", label: "Reframe", icon: "⛶" },
  { id: "subs", label: "Subtitles", icon: "CC" },
  { id: "voice", label: "Voice", icon: "🎙" },
  { id: "text", label: "Text", icon: "T", soon: true },
  { id: "broll", label: "B-roll", icon: "▦", soon: true },
  { id: "music", label: "Music", icon: "♪", soon: true },
  { id: "transitions", label: "Transitions", icon: "⇄", soon: true },
  { id: "aihook", label: "AI Hook", icon: "✨", soon: true },
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
  return { doc: state.present, set, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
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

function VoicePanel({ cid, voUrl, onChanged, toast, onRecordStart, onRecordStop }: { cid: number; voUrl: string | null; onChanged: (u: string | null) => void; toast: Notify; onRecordStart: () => void; onRecordStop: () => void }) {
  const { recording, error, start, stop } = useRecorder();
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onRecord = async () => { onRecordStart(); const ok = await start(); if (!ok) onRecordStop(); };  // roll video+teleprompter, then mic
  const onStop = async () => {
    const blob = await stop();
    onRecordStop();                                                  // pause the video
    if (blob) setPending({ blob, url: URL.createObjectURL(blob) });
  };
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
  activeScene: { start: number; end: number; label: string }; onRecordStart: (r?: { s: number; e: number }) => void; onRecordStop: () => void;
  previewMode: "off" | "scene" | "reel"; onPlayScene: (i: number) => void; onPlayReel: () => void; onStopPreview: () => void;
  onChanged: () => void; toast: Notify;
}) {
  const { recording, error, start, stop } = useRecorder();
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasVoice = !!sceneVos[sceneIdx];
  const doneCount = sceneVos.filter(Boolean).length;

  const onRecord = async () => { if (previewMode !== "off") onStopPreview(); onRecordStart({ s: activeScene.start, e: activeScene.end }); const ok = await start(); if (!ok) onRecordStop(); };
  const onStop = async () => { const blob = await stop(); onRecordStop(); if (blob) setPending({ blob, url: URL.createObjectURL(blob) }); };
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

/* Continuous scrubbing timeline: one track of frames, dim outside the trim, a
   movable playhead, and start/end trim handles. Drag ANYWHERE on the track to move
   the playhead. Removed (cut) ranges show as a subtle grey band (the captions still
   keep every word — only the video skips them). */
function FilmstripTimeline({ pid, winStart, winEnd, start, end, time, zoom, cuts, markers, onStart, onEnd, onScrub }: {
  pid: number; winStart: number; winEnd: number; start: number; end: number; time: number; zoom: number; cuts: [number, number][];
  markers?: { start: number; end: number; label: string }[];
  onStart: (t: number) => void; onEnd: (t: number) => void; onScrub: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = Math.max(0.1, winEnd - winStart);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - winStart) / span) * 100));
  const toTime = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); const x = Math.min(Math.max(0, clientX - r.left), r.width); return winStart + (x / r.width) * span; };
  const drag = (which: "start" | "end" | "scrub") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const t = toTime(ev.clientX);
      if (which === "start") onStart(Math.max(winStart, Math.min(t, end - 0.5)));
      else if (which === "end") onEnd(Math.min(winEnd, Math.max(t, start + 0.5)));
      else onScrub(Math.max(start, Math.min(end, t)));
    };
    move(e.nativeEvent);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const n = Math.max(8, Math.round(10 * zoom));
  const frames = useMemo(() => Array.from({ length: n }, (_, i) => winStart + ((i + 0.5) / n) * span), [winStart, span, n]);
  return (
    <div className="fs-wrap">
      <div className="fs-scroll">
        <div className="fs-track" ref={ref} onPointerDown={drag("scrub")} style={{ width: `${zoom * 100}%` }}>
          <div className="fs-frames">{frames.map((t, i) => (
            <img key={i} src={api.frameUrl(pid, t)} alt="" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")} />
          ))}</div>
          <div className="fs-dim" style={{ left: 0, width: `${pct(start)}%` }} />
          <div className="fs-dim" style={{ left: `${pct(end)}%`, right: 0 }} />
          <div className="fs-range" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
          {cuts.map(([a, b], i) => (
            <div key={i} className="fs-cut" style={{ left: `${pct(a)}%`, width: `${Math.max(0, pct(b) - pct(a))}%` }} title="Removed from the video (captions keep flowing)" />
          ))}
          {(markers ?? []).map((m, i) => (
            i > 0 ? <div key={"mk" + i} className="fs-marker" style={{ left: `${pct(m.start)}%` }} title={`Scene ${i + 1}: ${m.label}`} /> : null
          ))}
          <div className="fs-handle" style={{ left: `${pct(start)}%` }} onPointerDown={drag("start")} title="Drag to trim the start" />
          <div className="fs-handle" style={{ left: `${pct(end)}%` }} onPointerDown={drag("end")} title="Drag to trim the end" />
          <div className="fs-playhead" style={{ left: `${pct(time)}%` }} />
        </div>
      </div>
      <div className="timeline-labels">
        <span className="tag">start {fmt(start)}</span><span className="tag">{fmt(end - start)} clip</span><span className="tag">end {fmt(end)}</span>
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
