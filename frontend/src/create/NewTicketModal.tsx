// New-video starter modal. Relocated verbatim from App.tsx into the Create module so
// the dashboard owns its own creation entry point. (Phase 3 of the redesign replaces
// this with the four-path creation wizard; kept as-is for now to preserve behavior.)
import { useState } from "react";
import { api, NormalizedPlan, Presets } from "../api";
import { useToast } from "../Toast";
import { BRANDS, modeLabel } from "./constants";

// Slim starter: 3 choices, then straight into the full-page workspace (no bounce back to the board).
// "I have a script" flips open a paste box + the autopilot / AI-voice toggles, so the whole
// script-in → clips-in → auto-voiced → ready-to-post flow starts from one place.
export function NewTicketModal({ presets, onClose, onCreated }: { presets: Presets | null; onClose: () => void; onCreated: (tid: number) => void }) {
  const [brand, setBrand] = useState("NoCrapDiet");
  const [angle, setAngle] = useState("");
  const [format, setFormat] = useState("reel");
  const [capture, setCapture] = useState("native-short");
  const [script, setScript] = useState("");
  const [showScript, setShowScript] = useState(false);
  const [autopilot, setAutopilot] = useState(true);
  const [autoVoice, setAutoVoice] = useState(true);
  const [busy, setBusy] = useState<"" | "create" | "ai" | "script" | "preview">("");
  const [preview, setPreview] = useState<NormalizedPlan | null>(null);
  const toast = useToast();

  // Show the user exactly how CVideo will split their pasted text into scenes BEFORE
  // creating anything — no external chat, no guessing at the format.
  const previewPlan = async () => {
    setBusy("preview");
    try {
      const p = await api.normalizeScript({ script, angle, format });
      setPreview(p);
    } catch (e: any) { toast(`Couldn't read that script: ${e?.message || e}`, "err"); }
    finally { setBusy(""); }
  };
  const formats = presets?.formats ?? ["reel", "carousel"];
  const modes = presets?.capture_modes ?? ["longform-clip", "native-short", "repurpose"];

  const startBlank = async () => {
    setBusy("create");
    try {
      const res = await api.createTicket({ brand, angle, format, capture_mode: capture });
      toast("Video created — write your script", "ok");
      onCreated(res.ticket.id);
    } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); setBusy(""); }
  };

  // Script path: paste your script → scenes, optionally on autopilot with AI voiceover.
  // You add the clips in the workspace; autopilot voices, builds, and writes post copy.
  const startFromScript = async () => {
    setBusy("script");
    try {
      const res = await api.createTicketFromScript({
        brand, angle, format, capture_mode: capture, script,
        autopilot, auto_voiceover: autoVoice,
      });
      toast(`Made ${res.beats.length} scenes${autopilot ? " — on autopilot, just add your clips" : ""}`, "ok");
      onCreated(res.ticket.id);
    } catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); setBusy(""); }
  };

  // ✨ One-step AI path: create the ticket, fill its scenes, then open the workspace.
  const generateWithAI = async () => {
    setBusy("ai");
    let tid: number | null = null;
    try {
      const res = await api.createTicket({ brand, angle, format, capture_mode: capture });
      tid = res.ticket.id;
      const sf = await api.scriptFactory(tid);
      toast(`AI wrote ${sf.beats.length} scenes`, "ok");
    } catch (e: any) {
      toast(tid == null ? `Failed: ${e?.message || e}` : `AI script failed — write it in the workspace: ${e?.message || e}`, "err");
      if (tid == null) { setBusy(""); return; }
    }
    onCreated(tid);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-slim" onClick={(e) => e.stopPropagation()}>
        <h3>New video</h3>
        <label className="field">What's it about?
          <input value={angle} autoFocus placeholder="e.g. hidden sugar in sauces" onChange={(e) => setAngle(e.target.value)} />
        </label>
        <div className="form-row">
          <label className="field">Brand
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>{BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          </label>
          <label className="field">How will you make it?
            <select value={capture} onChange={(e) => setCapture(e.target.value)}>{modes.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}</select>
          </label>
          {formats.length > 1 && (
            <label className="field">Video type
              <select value={format} onChange={(e) => setFormat(e.target.value)}>{formats.map((f) => <option key={f} value={f}>{f === "reel" ? "Reel (tall video)" : f === "carousel" ? "Carousel (photos)" : f}</option>)}</select>
            </label>
          )}
        </div>
        {!showScript ? (
          <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowScript(true)}>
            📝 I already have a script — paste it
          </button>
        ) : (
          <div className="nt-script">
            <textarea rows={7} value={script} autoFocus
              placeholder={"Paste anything — rough notes, bullet points, prose, or another AI's output.\nCVideo splits it into scenes for you. No special format needed."}
              onChange={(e) => { setScript(e.target.value); setPreview(null); }} />
            <div className="nt-preview-row">
              <button className="link-btn" onClick={previewPlan} disabled={!script.trim() || busy === "preview"}>
                {busy === "preview" ? "Reading…" : "👁 Preview scenes"}
              </button>
              <span className="muted" style={{ fontSize: 11.5 }}>See how CVideo splits your text before creating.</span>
            </div>
            {preview && (
              <div className="nt-preview">
                <div className="nt-preview-head">
                  <b>{preview.plan.beats.length} scene{preview.plan.beats.length === 1 ? "" : "s"}</b>
                  {preview.plan.hook && <span className="nt-preview-hook">Hook: “{preview.plan.hook}”</span>}
                </div>
                <ol className="nt-preview-list">
                  {preview.plan.beats.map((b) => (
                    <li key={b.order_index}>
                      <span className="nt-preview-line">{b.spoken_line}</span>
                      {b.is_proof_beat && <span className="nt-proof" title="States a number → needs a proof clip">proof</span>}
                    </li>
                  ))}
                </ol>
                {preview.warnings.map((w, i) => <div key={i} className="nt-preview-warn">⚠ {w}</div>)}
                {preview.errors.map((e, i) => <div key={i} className="nt-preview-err">✕ {e}</div>)}
              </div>
            )}
            <label className="nt-toggle" title="Autopilot voices the scenes, builds the reel, writes captions & tags, and queues the post — pausing for your OK">
              <input type="checkbox" checked={autopilot} onChange={(e) => setAutopilot(e.target.checked)} />
              <span>🤖 Run on autopilot (build &amp; prep the post once clips are in)</span>
            </label>
            <label className="nt-toggle" title="Reads the whole script in your AI voice (MasterDee) as ONE continuous voiceover over all your clips — for silent B-roll">
              <input type="checkbox" checked={autoVoice} onChange={(e) => setAutoVoice(e.target.checked)} />
              <span>🎙 AI voiceover (one read over the whole video)</span>
            </label>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12.5 }}>Next you'll land in the workspace — script, scenes, and “make my video” all live there.</div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={!!busy}>Cancel</button>
          {showScript ? (
            <button className="primary" onClick={startFromScript} disabled={!!busy || !script.trim()}
              title={!script.trim() ? "Paste your script first" : "Split into scenes — then add your clips"}>
              {busy === "script" ? "Making scenes…" : "Use this script →"}
            </button>
          ) : (
            <>
              <button onClick={startBlank} disabled={!!busy}>{busy === "create" ? "Creating…" : "Start writing myself"}</button>
              <button className="primary" onClick={generateWithAI} disabled={!!busy || !angle.trim()} title={!angle.trim() ? "Enter a topic first" : "Create + write the script with AI"}>{busy === "ai" ? "Writing your script…" : "✨ Write it with AI"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
