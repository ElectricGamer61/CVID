import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, Beat, Clip, ExportItem, InsightsData, Outlier, Presets, Project, Ticket } from "./api";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionStyle, FALLBACK_PRESETS, groupLines, Word, wordsInRange } from "./captionStyles";
import { Sidebar } from "./Sidebar";
import { useToast } from "./Toast";
import { exportDirSupported, getExportDir, getExportDirName, pickExportDir } from "./exportDir";

type Route =
  | { name: "home" }
  | { name: "board" }
  | { name: "intake" }
  | { name: "insights" }
  | { name: "library" }
  | { name: "project"; pid: number }
  | { name: "editor"; pid: number; cid: number };

export default function App() {
  const [presets, setPresets] = useState<Presets | null>(null);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [projName, setProjName] = useState("");

  useEffect(() => { api.presets().then(setPresets); }, []);
  const goHome = () => setRoute({ name: "home" });
  const goBoard = () => setRoute({ name: "board" });
  const goIntake = () => setRoute({ name: "intake" });
  const goInsights = () => setRoute({ name: "insights" });
  const goLibrary = () => setRoute({ name: "library" });

  const NAMED: Record<string, string> = { board: "Pipeline board", intake: "Intake", insights: "Insights", library: "Exports" };
  const crumbLabel = NAMED[route.name] ?? null;
  const sbView = (["board", "intake", "insights", "library"].includes(route.name) ? route.name : "home") as any;

  return (
    <div className="shell">
      <Sidebar view={sbView} onHome={goHome} onBoard={goBoard} onIntake={goIntake} onInsights={goInsights} onLibrary={goLibrary} />
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

        {route.name === "board" && <Board presets={presets} />}
        {route.name === "intake" && <Intake onSpun={goBoard} />}
        {route.name === "insights" && <Insights />}
        {route.name === "library" && <Library />}
        {route.name === "home" && <Home presets={presets} onOpen={(pid) => setRoute({ name: "project", pid })} />}
        {route.name === "project" && (
          <MomentsGrid pid={route.pid} onName={setProjName}
            onEdit={(cid) => setRoute({ name: "editor", pid: route.pid, cid })} onBack={goHome} />
        )}
        {route.name === "editor" && (
          <EditorPage pid={route.pid} cid={route.cid} presets={presets} onName={setProjName}
            onBack={() => setRoute({ name: "project", pid: route.pid })} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------- Board --------------------------------- */
const STAGE_LABELS: Record<string, string> = {
  outlier: "Outlier", scripted: "Scripted", staged: "Staged", sourced: "Sourced",
  assembled: "Assembled", ready: "Ready", scheduled: "Scheduled", posted: "Posted",
};
const FALLBACK_STAGES = ["outlier", "scripted", "staged", "sourced", "assembled", "ready", "scheduled", "posted"];
const laneOf = (m: string) => (m === "longform-clip" ? "A" : m === "native-short" ? "B" : "R");

function Board({ presets }: { presets: Presets | null }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const toast = useToast();
  const stages = presets?.stages ?? FALLBACK_STAGES;

  const refresh = () => api.listTickets().then(setTickets);
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  const move = async (t: Ticket, dir: 1 | -1) => {
    const j = stages.indexOf(t.stage) + dir;
    if (j < 0 || j >= stages.length) return;
    await api.patchTicket(t.id, { stage: stages[j] }); refresh();
  };
  const del = async (t: Ticket) => {
    if (!confirm(`Delete this ticket${t.angle ? ` (${t.angle})` : ""}?`)) return;
    await api.deleteTicket(t.id); if (openId === t.id) setOpenId(null);
    toast("Ticket deleted", "ok"); refresh();
  };

  return (
    <div className="board-page">
      <div className="page-head">
        <h2>Pipeline board</h2>
        <button className="primary" onClick={() => setShowNew(true)}>+ New ticket</button>
      </div>
      {tickets == null ? <div className="muted">Loading…</div> : (
        <div className="board">
          {stages.map((st) => {
            const col = tickets.filter((t) => t.stage === st);
            return (
              <div className="board-col" key={st}>
                <div className="board-col-head"><span>{STAGE_LABELS[st] ?? st}</span><span className="board-count">{col.length}</span></div>
                {st === "sourced" && <div className="lane-hint">Lane A · long-form  |  Lane B · native</div>}
                <div className="board-col-body">
                  {col.map((t) => <TicketCard key={t.id} t={t} stages={stages} onOpen={() => setOpenId(t.id)} onMove={move} onDelete={del} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showNew && <NewTicketModal presets={presets} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
      {openId != null && <TicketDetail tid={openId} stages={stages} presets={presets} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}

function TicketCard({ t, stages, onOpen, onMove, onDelete }: {
  t: Ticket; stages: string[]; onOpen: () => void; onMove: (t: Ticket, d: 1 | -1) => void; onDelete: (t: Ticket) => void;
}) {
  const i = stages.indexOf(t.stage);
  return (
    <div className="tkt-card" onClick={onOpen}>
      <div className="tkt-top">
        <span className={"lane lane-" + laneOf(t.capture_mode)} title={t.capture_mode}>{laneOf(t.capture_mode)}</span>
        <span className="tkt-fmt">{t.format}</span>
        <span className="spacer" />
        <button className="icon-btn danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(t); }}>🗑</button>
      </div>
      <div className="tkt-angle">{t.angle || <span className="muted">(no angle)</span>}</div>
      {t.hook_text && <div className="tkt-hook">“{t.hook_text}”</div>}
      <div className="tkt-foot" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" disabled={i <= 0} title="Back a stage" onClick={() => onMove(t, -1)}>◀</button>
        <span className="muted tkt-brand">{t.brand}</span>
        <button className="icon-btn" disabled={i >= stages.length - 1} title="Advance a stage" onClick={() => onMove(t, 1)}>▶</button>
      </div>
    </div>
  );
}

function NewTicketModal({ presets, onClose, onCreated }: { presets: Presets | null; onClose: () => void; onCreated: () => void }) {
  const [brand, setBrand] = useState("NoCrapDiet");
  const [angle, setAngle] = useState("");
  const [format, setFormat] = useState("reel");
  const [capture, setCapture] = useState("native-short");
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const formats = presets?.formats ?? ["reel", "carousel"];
  const modes = presets?.capture_modes ?? ["longform-clip", "native-short", "repurpose"];

  const create = async () => {
    setBusy(true);
    try {
      const body = { brand, angle, format, capture_mode: capture, script: script.trim() || undefined };
      const res = script.trim() ? await api.createTicketFromScript(body) : await api.createTicket(body);
      const n = res.beats?.length ?? 0;
      toast(n ? `Ticket created — ${n} beats from script` : "Ticket created", "ok");
      onCreated();
    } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New ticket</h3>
        <div className="form-row">
          <label className="field">Brand<input value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
          <label className="field">Angle<input value={angle} placeholder="e.g. label-reading" onChange={(e) => setAngle(e.target.value)} /></label>
        </div>
        <div className="form-row">
          <label className="field">Format<select value={format} onChange={(e) => setFormat(e.target.value)}>{formats.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="field">Capture mode<select value={capture} onChange={(e) => setCapture(e.target.value)}>{modes.map((m) => <option key={m}>{m}</option>)}</select></label>
        </div>
        <label className="field">Paste script — auto-splits into beats
          <textarea rows={9} value={script} placeholder={"HOOK: the scroll-stopping line\n\nBEAT\nSpoken: what you say\nOn-screen: BIG TEXT\nShot: label close-up\nProof: yes"} onChange={(e) => setScript(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create ticket"}</button>
        </div>
      </div>
    </div>
  );
}

function TicketDetail({ tid, stages, presets, onClose, onChanged }: { tid: number; stages: string[]; presets: Presets | null; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ ticket: Ticket; beats: Beat[] } | null>(null);
  const toast = useToast();
  const load = () => api.getTicket(tid).then(setData);
  useEffect(() => { load(); }, [tid]);

  const patchT = async (body: Partial<Ticket>) => { await api.patchTicket(tid, body); load(); onChanged(); };
  const move = async (dir: 1 | -1) => {
    if (!data) return;
    const j = stages.indexOf(data.ticket.stage) + dir;
    if (j < 0 || j >= stages.length) return;
    patchT({ stage: stages[j] });
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

  const formats = presets?.formats ?? ["reel", "carousel"];
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
                <input className="drawer-angle-input" defaultValue={ticket.angle} placeholder="angle…"
                  onBlur={(e) => e.target.value !== ticket.angle && patchT({ angle: e.target.value })} />
                <button className="icon-btn" onClick={onClose} title="Close">✕</button>
              </div>
              <div className="drawer-meta-row">
                <span className={"lane lane-" + laneOf(ticket.capture_mode)}>{laneOf(ticket.capture_mode)}</span>
                <select value={ticket.capture_mode} onChange={(e) => patchT({ capture_mode: e.target.value })}>{modes.map((m) => <option key={m}>{m}</option>)}</select>
                <select value={ticket.format} onChange={(e) => patchT({ format: e.target.value })}>{formats.map((f) => <option key={f}>{f}</option>)}</select>
              </div>
              <div className="drawer-stage">
                <button className="icon-btn" onClick={() => move(-1)} disabled={stages.indexOf(ticket.stage) <= 0}>◀</button>
                <span className="stage-pill">{STAGE_LABELS[ticket.stage] ?? ticket.stage}</span>
                <button className="icon-btn" onClick={() => move(1)} disabled={stages.indexOf(ticket.stage) >= stages.length - 1}>▶</button>
              </div>
              <label className="field">Hook
                <input key={ticket.hook_text} defaultValue={ticket.hook_text} placeholder="first-frame hook…"
                  onBlur={(e) => e.target.value !== ticket.hook_text && patchT({ hook_text: e.target.value })} />
              </label>

              <div className="ai-row">
                <button onClick={runScript} disabled={!!aiBusy}>{aiBusy === "script" ? "Writing…" : "✨ Run Script Factory"}</button>
                <button onClick={runHooks} disabled={!!aiBusy}>{aiBusy === "hook" ? "Forging…" : "✨ Run Hook Forge"}</button>
              </div>
              {hooks && (
                <div className="hook-options">
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Pick a hook:</div>
                  {hooks.map((h, i) => <button key={i} className="hook-chip" onClick={() => pickHook(h)}>{h}</button>)}
                </div>
              )}

              <div className="drawer-sec-head">
                <h4>Beats ({beats.length})</h4>
                {proofGaps > 0 && <span className="warn-chip">⚠ {proofGaps} proof beat{proofGaps > 1 ? "s" : ""} missing a clip</span>}
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
                    <button onClick={addBeat}>+ Add beat</button>
                    <ReimportBox tid={tid} onDone={() => { load(); onChanged(); }} />
                  </div>
                </>
              )}

              {ticket.capture_mode === "native-short" && beats.length > 0 && (
                <div className="assemble-box">
                  <button className="primary" onClick={assembleReel} disabled={asm?.state === "running"}>
                    {asm?.state === "running" ? `⏳ ${asm.stage}…` : ticket.clip_url ? "↻ Re-assemble reel" : "🎬 Assemble reel"}
                  </button>
                  {asm?.state === "error" && <div className="err">{asm.error}</div>}
                  {ticket.clip_url && asm?.state !== "running" && (
                    <div className="reel-out">
                      <video src={api.ticketDownloadUrl(tid)} controls playsInline className="reel-video" />
                      <button onClick={() => downloadFile(api.ticketDownloadUrl(tid), safeFileName(ticket.angle || "reel"), toast)}>⬇ Download reel</button>
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
        <textarea className="beat-in spoken" rows={2} defaultValue={b.spoken_line} placeholder="Spoken line (teleprompter)…" onBlur={(e) => save("spoken_line", e.target.value)} />
        <input className="beat-in" defaultValue={b.on_screen_text} placeholder="On-screen text…" onBlur={(e) => save("on_screen_text", e.target.value)} />
        <input className="beat-in" defaultValue={b.caption} placeholder="Caption (karaoke)…" onBlur={(e) => save("caption", e.target.value)} />
        <input className="beat-in" defaultValue={b.shot_cue} placeholder="Shot cue (what to film)…" onBlur={(e) => save("shot_cue", e.target.value)} />
        <div className="beat-media">
          <button className={"slot" + (b.clip_path ? " filled" : "")} onClick={() => clipInput.current?.click()} disabled={up === "clip"}>
            {up === "clip" ? "…" : b.clip_path ? "✓ Clip" : "＋ Clip"}
          </button>
          <button className={"slot" + (b.voiceover_path ? " filled" : "")} onClick={() => voInput.current?.click()} disabled={up === "vo"}>
            {up === "vo" ? "…" : b.voiceover_path ? "✓ Voiceover" : "＋ Voiceover"}
          </button>
          <input ref={clipInput} type="file" accept="video/*" hidden onChange={(e) => upClip(e.target.files?.[0])} />
          <input ref={voInput} type="file" accept="audio/*" hidden onChange={(e) => upVo(e.target.files?.[0])} />
        </div>
        {b.is_proof_beat && !b.clip_path && <div className="beat-warn-txt">⚠ proof beat — needs a clip showing the product/label</div>}
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
  if (!open) return <button className="link-btn" onClick={() => setOpen(true)}>Re-import script…</button>;
  const run = async () => {
    setBusy(true);
    try { const r = await api.importScript(tid, script); toast(`Imported ${r.beats.length} beats`, "ok"); setScript(""); setOpen(!!empty); onDone(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="reimport">
      <div className="muted" style={{ fontSize: 12.5 }}>{empty ? "Paste a script to generate beats:" : "Re-import replaces all beats:"}</div>
      <textarea rows={6} value={script} placeholder={"HOOK: ...\n\nBEAT\nSpoken: ..."} onChange={(e) => setScript(e.target.value)} />
      <div className="modal-actions">
        {!empty && <button onClick={() => setOpen(false)} disabled={busy}>Cancel</button>}
        <button className="primary" onClick={run} disabled={busy || !script.trim()}>{busy ? "Importing…" : "Import beats"}</button>
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
      <div className="page-head"><h2>Intake</h2><span className="muted">paste outliers → swipe file → spin tickets</span></div>
      <div className="intake-form">
        <div className="form-row">
          <label className="field">Angle<input value={f.angle} placeholder="e.g. label-reading" onChange={(e) => setF({ ...f, angle: e.target.value })} /></label>
          <label className="field">Source URL<input value={f.url} placeholder="https://…" onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        </div>
        <label className="field">Hook<input value={f.hook} placeholder="the scroll-stopping line" onChange={(e) => setF({ ...f, hook: e.target.value })} /></label>
        <label className="field">Why it popped<textarea rows={2} value={f.why_popped} onChange={(e) => setF({ ...f, why_popped: e.target.value })} /></label>
        <div className="modal-actions"><button className="primary" onClick={add} disabled={busy}>{busy ? "Adding…" : "+ Add outlier"}</button></div>
      </div>

      <div className="page-head" style={{ marginTop: 28 }}><h3 style={{ margin: 0 }}>Swipe file</h3><span className="muted">{outliers?.length ?? 0} saved</span></div>
      {outliers == null ? <div className="muted">Loading…</div> : outliers.length === 0 ? (
        <div className="empty"><div className="big" style={{ fontSize: 26 }}>✎</div><div style={{ fontWeight: 700, color: "var(--text)" }}>Empty swipe file</div><div>Add an outlier above to start mining angles.</div></div>
      ) : (
        <div className="swipe-list">
          {outliers.map((o) => (
            <div className="swipe-card" key={o.id}>
              <div className="swipe-main">
                <div className="swipe-angle">{o.angle || <span className="muted">(no angle)</span>}</div>
                {o.hook && <div className="swipe-hook">“{o.hook}”</div>}
                {o.why_popped && <div className="muted swipe-why">{o.why_popped}</div>}
                {o.url && <a className="swipe-url" href={o.url} target="_blank" rel="noreferrer">{o.url}</a>}
              </div>
              <div className="swipe-actions">
                <button className="primary" onClick={() => spin(o)}>Spin ticket →</button>
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
  const toast = useToast();
  useEffect(() => {
    const load = () => api.listExports().then(setItems).catch(() => setItems([]));
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);
  if (items == null) return <div className="page"><div className="proj-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div></div>;
  return (
    <div className="page">
      <div className="page-head"><h2>Exports</h2><span className="muted">{items.length} rendered output{items.length === 1 ? "" : "s"}</span></div>
      {items.length === 0 ? (
        <div className="empty">
          <div className="big" style={{ fontSize: 28 }}>⬇</div>
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 16 }}>No exports yet</div>
          <div>Render a clip or assemble a reel — finished videos collect here for download.</div>
        </div>
      ) : (
        <div className="proj-grid">
          {items.map((it) => (
            <div className="exp-card" key={`${it.kind}-${it.id}`}>
              <div className="exp-thumb">
                {it.thumb ? <img src={it.thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <div className="exp-noimg">🎬</div>}
                <span className={"exp-kind " + it.kind}>{it.kind}</span>
                {it.score != null && <span className="exp-score">{it.score}</span>}
              </div>
              <div className="exp-body">
                <div className="exp-title">{it.title}</div>
                <div className="muted exp-sub">{it.subtitle}</div>
                <button className="primary exp-dl" onClick={() => downloadFile(it.download, safeFileName(it.title), toast)}>⬇ Download</button>
              </div>
            </div>
          ))}
        </div>
      )}
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
      <div className="page-head"><h2>Insights</h2><span className="muted">Signal Reader · ranks angles by saves + follows</span></div>
      <div className="kpi-row">
        {kpi("Tickets", k?.tickets ?? 0)}{kpi("Posted", k?.posted ?? 0)}
        {kpi("Follows", k?.follows ?? 0, true)}{kpi("Saves", k?.saves ?? 0, true)}
        {kpi("Views", k?.views ?? 0)}{kpi("Sends", k?.sends ?? 0)}
      </div>

      <PerfLogger tickets={tickets} onLogged={refresh} />

      <div className="ins-cols">
        <div>
          <h3 className="ins-h">Angle ranking <span className="muted">(saves + follows)</span></h3>
          {!data || data.angles.length === 0 ? <div className="muted">No angles ranked yet — log some performance below.</div> : (
            <table className="ins-table"><thead><tr><th>Angle</th><th>Posts</th><th>Avg score</th></tr></thead>
              <tbody>{data.angles.map((a) => <tr key={a.angle}><td>{a.angle}</td><td>{a.posts_count}</td><td><b>{a.avg_score}</b></td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="ins-h">Top performers</h3>
          {!data || data.top.length === 0 ? <div className="muted">No performance logged yet.</div> : (
            <table className="ins-table"><thead><tr><th>#</th><th>Angle</th><th>Saves+Follows</th></tr></thead>
              <tbody>{data.top.map((t, i) => <tr key={t.ticket_id}><td>{i + 1}</td><td>{t.angle || `Ticket ${t.ticket_id}`}</td><td><b>{t.score}</b></td></tr>)}</tbody>
            </table>
          )}
        </div>
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
      <h3 className="ins-h">Log performance</h3>
      <div className="perf-row">
        <select value={tid} onChange={(e) => setTid(e.target.value ? parseInt(e.target.value, 10) : "")}>
          <option value="">Select ticket…</option>
          {tickets.map((t) => <option key={t.id} value={t.id}>{t.angle || `Ticket ${t.id}`} ({t.stage})</option>)}
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option></select>
        <label>Views<input type="number" value={f.views} onChange={num("views")} /></label>
        <label>Follows<input type="number" value={f.follows} onChange={num("follows")} /></label>
        <label>Saves<input type="number" value={f.saves} onChange={num("saves")} /></label>
        <label>Sends<input type="number" value={f.sends} onChange={num("sends")} /></label>
        <button className="primary" onClick={log} disabled={busy}>{busy ? "…" : "Log"}</button>
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
        await api.createFromUrl({ name, source_url: url, brain, transcribe_backend: transcribe, aspect, caption_preset: preset });
      } else {
        if (!file) { toast("Choose a video file", "err"); return; }
        const fd = new FormData();
        fd.append("name", name); fd.append("brain", brain); fd.append("transcribe_backend", transcribe); fd.append("aspect", aspect); fd.append("caption_preset", preset); fd.append("file", file);
        await api.createFromUpload(fd);
      }
      setName(""); setUrl(""); setFile(null); toast("Project started — finding clips…", "ok"); onCreated();
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
      <div className="row" style={{ marginTop: 14, alignItems: "flex-end" }}>
        <label className="field">Brain<select value={brain} onChange={(e) => setBrain(e.target.value)}>{(presets?.brains ?? ["ollama"]).map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="field">Transcription<select value={transcribe} onChange={(e) => setTranscribe(e.target.value)}>{(presets?.transcribe ?? ["local"]).map((t) => <option key={t} value={t}>{t === "local" ? "Local (free)" : "ElevenLabs"}</option>)}</select></label>
        <label className="field">Aspect<select value={aspect} onChange={(e) => setAspect(e.target.value)}>{(presets?.aspects ?? ["9:16"]).map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field">Caption style<select value={preset} onChange={(e) => setPreset(e.target.value)}>{(presets?.captions ?? ["capcut"]).map((c) => <option key={c}>{c}</option>)}</select></label>
        <div style={{ flex: 1 }} />
        <button className="primary" disabled={busy} onClick={submit}>{busy ? "Starting…" : "✨ Generate clips"}</button>
      </div>
    </div>
  );
}

/* ---------------------------- Moments grid ----------------------------- */
function MomentsGrid({ pid, onName, onEdit, onBack }: {
  pid: number; onName: (s: string) => void; onEdit: (cid: number) => void; onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const toast = useToast();
  const refresh = () => api.getProject(pid).then((d) => { setProject(d.project); setClips(d.clips); onName(d.project.name); });
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [pid]);

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
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [preset, setPreset] = useState(clip.caption_preset);
  const [style, setStyle] = useState<CaptionStyle>(() => {
    if (clip.style_json) { try { return JSON.parse(clip.style_json); } catch { /* */ } }
    return presetMap[clip.caption_preset] ?? FALLBACK_PRESETS.capcut;
  });
  // caption words being edited (absolute times). seed from per-clip edits or transcript.
  const [editWords, setEditWords] = useState<Word[]>(() => {
    if (clip.words_json) { try { return JSON.parse(clip.words_json); } catch { /* */ } }
    return wordsInRange(words, clip.start, clip.end);
  });
  useEffect(() => {
    if (!clip.words_json && editWords.length === 0 && words.length) setEditWords(wordsInRange(words, clip.start, clip.end));
  }, [words]);

  const [tab, setTab] = useState<"captions" | "text" | "clip">("captions");
  const [time, setTime] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const [boxH, setBoxH] = useState(530);
  const [center, setCenter] = useState(clip.crop_center);
  const [resolution, setResolution] = useState(clip.resolution ?? "1080p");
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Remembered export folder (Chromium) — picked once, reused for every download.
  const [exportDirName, setExportDirName] = useState<string | null>(null);
  useEffect(() => { getExportDirName().then(setExportDirName); }, []);
  const chooseFolder = async () => {
    const h = await pickExportDir();
    if (h) { setExportDirName(h.name); toast(`Export folder set to "${h.name}"`, "ok"); }
  };

  // STABLE timeline window — computed once for this clip, never during drag.
  const win = useMemo(() => {
    const len = Math.max(2, clip.end - clip.start);
    const margin = Math.max(15, len);
    return { s: Math.max(0, clip.start - margin), e: Math.min(duration || clip.end + margin, clip.end + margin) };
  }, [clip.id, duration]);

  const choosePreset = (name: string) => { setPreset(name); setStyle(presetMap[name] ?? FALLBACK_PRESETS.capcut); };

  useEffect(() => { if (boxRef.current) setBoxH(boxRef.current.clientHeight); });
  useEffect(() => {
    let raf = 0;
    const tick = () => { const v = videoRef.current; if (v) { if (v.currentTime >= end) v.currentTime = start; setTime(v.currentTime); } raf = requestAnimationFrame(tick); };
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end]);

  const onLoaded = () => { if (videoRef.current) videoRef.current.currentTime = start; };
  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (playing) { v.pause(); setPlaying(false); } else { if (v.currentTime < start || v.currentTime > end) v.currentTime = start; v.play(); setPlaying(true); } };

  const rendered = clip.status === "rendered";
  const busy = clip.status === "rendering";

  const save = async (silent = false) => {
    await api.patchClip(clip.id, { start, end, caption_preset: preset, resolution, crop_center: center, style, words: editWords });
    if (!silent) toast("Saved", "ok"); onChange();
  };
  const exportClip = async () => { await save(true); await api.renderClip(clip.id); toast("Exporting clip…", "info"); onChange(); };

  return (
    <div className="page">
      <button className="back" onClick={onBack}>← All moments</button>
      <div className="editor">
        <div className="stage">
          <div className="phone" ref={boxRef}>
            <video ref={videoRef} src={api.sourceUrl(pid)} onLoadedMetadata={onLoaded} style={{ objectPosition: `${center * 100}% 50%` }} playsInline />
            <CaptionOverlay words={editWords} time={time} style={style} containerHeight={boxH} />
          </div>
          <div className="play-row">
            <button className="primary" onClick={togglePlay} style={{ borderRadius: 99, width: 44, height: 44, justifyContent: "center", padding: 0 }}>{playing ? "❚❚" : "▶"}</button>
            <span className="timecode">{fmt(time - start)} / {fmt(end - start)}</span>
          </div>
          <div className="stage-actions">
            <button onClick={() => save()} disabled={busy}>Save</button>
            <button className="primary" onClick={exportClip} disabled={busy}>{busy ? (clip.stage || "Rendering…") : rendered ? "Re-export" : "Export"}</button>
            {rendered && <button title="Download" onClick={() => downloadClip(clip.id, clip.title, toast)}>⬇ Download</button>}
          </div>
          {busy && <div className="muted" style={{ fontSize: 12.5 }}>⏳ {clip.stage || "Working"}… (first export downloads the full video)</div>}
          {exportDirSupported() && (
            <div className="muted" style={{ fontSize: 12.5 }}>
              Save folder: {exportDirName ? <b>{exportDirName}</b> : <i>ask first time</i>}{" "}
              <button onClick={chooseFolder} style={{ background: "none", border: "none", color: "var(--primary, #6D5EFC)", cursor: "pointer", padding: 0, font: "inherit", textDecoration: "underline" }}>change</button>
            </div>
          )}
          {clip.error && <div className="err">{clip.error}</div>}
        </div>

        <div className="panel">
          <div className="tabs">
            <button className={tab === "captions" ? "on" : ""} onClick={() => setTab("captions")}>Style</button>
            <button className={tab === "text" ? "on" : ""} onClick={() => setTab("text")}>Text</button>
            <button className={tab === "clip" ? "on" : ""} onClick={() => setTab("clip")}>Clip</button>
          </div>
          {tab === "captions" && (
            <div className="panel-body">
              <div className="preset-chips">{(presets?.captions ?? Object.keys(FALLBACK_PRESETS)).map((c) => (
                <button key={c} className={"chip" + (preset === c ? " on" : "")} onClick={() => choosePreset(c)}>{c}</button>))}</div>
              <StyleEditor style={style} onChange={setStyle} />
            </div>
          )}
          {tab === "text" && (
            <div className="panel-body">
              <div className="muted" style={{ fontSize: 12.5 }}>Fix any wrong words — the preview and export update to match.</div>
              <CaptionTextEditor words={editWords} maxWords={style.max_words} onChange={setEditWords} />
            </div>
          )}
          {tab === "clip" && (
            <div className="panel-body">
              <h3 className="panel-title">{clip.title}</h3>
              <p className="reason">{clip.reason}</p>
              <div className="slider">
                <label><span>Crop position</span><span>{center < 0.4 ? "left" : center > 0.6 ? "right" : "center"}</span></label>
                <input type="range" min={0} max={1} step={0.02} value={center} onChange={(e) => setCenter(parseFloat(e.target.value))} />
              </div>
              <label className="field">Export resolution
                <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  {(presets?.resolutions ?? [{ id: "1080p", label: "1080p", hint: "1080×1920" }]).map((r) => (
                    <option key={r.id} value={r.id}>{r.label} · {r.hint}</option>))}
                </select>
              </label>
              <div className="muted" style={{ fontSize: 12.5 }}>Higher = crisper upload &amp; bigger file. 4K upscales from the source.</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Score {Math.round(clip.score)} · {fmt(end - start)} long</div>
            </div>
          )}
        </div>

        <div className="panel timeline-card">
          <div className="panel-body">
            <Timeline winStart={win.s} winEnd={win.e} start={start} end={end} time={time}
              onStart={setStart} onEnd={setEnd}
              onScrub={(t) => { if (videoRef.current) videoRef.current.currentTime = t; setTime(t); }}
              onCommit={() => save(true)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* Caption text editor: editable line inputs; words keep timing (even-split per line). */
function CaptionTextEditor({ words, maxWords, onChange }: { words: Word[]; maxWords: number; onChange: (w: Word[]) => void }) {
  const lines = useMemo(() => groupLines(words, maxWords), [words, maxWords]);
  const editLine = (lineIdx: number, text: string) => {
    const newLines = lines.map((ln, i) => {
      if (i !== lineIdx) return ln;
      const toks = text.split(/\s+/).filter(Boolean);
      const s = ln[0].start, e = ln[ln.length - 1].end;
      const step = (e - s) / Math.max(1, toks.length);
      return toks.map((w, j) => ({ start: +(s + j * step).toFixed(3), end: +(s + (j + 1) * step).toFixed(3), word: w }));
    });
    onChange(newLines.flat());
  };
  return (
    <div className="cap-lines">
      {lines.map((ln, i) => (
        <input key={i} className="cap-line" defaultValue={ln.map((w) => w.word.trim()).join(" ")}
          onBlur={(e) => editLine(i, e.target.value)} />
      ))}
      {lines.length === 0 && <div className="muted">No captions in this clip range.</div>}
    </div>
  );
}

function Timeline({ winStart, winEnd, start, end, time, onStart, onEnd, onScrub, onCommit }: {
  winStart: number; winEnd: number; start: number; end: number; time: number;
  onStart: (t: number) => void; onEnd: (t: number) => void; onScrub: (t: number) => void; onCommit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = Math.max(0.1, winEnd - winStart);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - winStart) / span) * 100));
  const toTime = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - r.left), r.width);
    return winStart + (x / r.width) * span;
  };
  const drag = (which: "start" | "end" | "scrub") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const t = toTime(ev.clientX);
      if (which === "start") onStart(Math.max(winStart, Math.min(t, end - 0.5)));
      else if (which === "end") onEnd(Math.min(winEnd, Math.max(t, start + 0.5)));
      else onScrub(Math.max(start, Math.min(end, t)));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (which !== "scrub") onCommit(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  return (
    <div className="timeline-wrap">
      <div className="timeline" ref={ref} onPointerDown={drag("scrub")}>
        <div className="tl-range" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
        <div className="tl-handle" style={{ left: `${pct(start)}%` }} onPointerDown={drag("start")} />
        <div className="tl-handle" style={{ left: `${pct(end)}%` }} onPointerDown={drag("end")} />
        <div className="tl-playhead" style={{ left: `${pct(time)}%` }} />
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
