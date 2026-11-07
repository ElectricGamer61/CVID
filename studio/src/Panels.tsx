import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Icon, KIND_COLOR } from "./bits";
import { TYPE_INFO, type DetectOptions, type Suggestion, type SuggestionType } from "./detect";
import { formatLength, formatTime, type Segment } from "./timeline";
import type { Clip, EngineInfo, Project } from "./types";

const ORDER: SuggestionType[] = ["filler", "cutoff", "repeat", "retake", "pause", "dead"];
// The ones safe to take without looking. Retakes and repeats can be deliberate.
export const OBVIOUS: SuggestionType[] = ["filler", "cutoff", "pause", "dead"];


// ---------------------------------------------------------------- clean up

export function CleanupPanel({ suggestions, visible, onToggle, onCutAll, onReview, options, onOptions, transcribing }: {
  suggestions: Suggestion[];
  visible: Set<SuggestionType>;
  onToggle: (t: SuggestionType) => void;
  onCutAll: (types: SuggestionType[]) => void;
  onReview: (t: SuggestionType) => void;
  options: DetectOptions;
  onOptions: (o: DetectOptions) => void;
  transcribing: boolean;
}) {
  const by = new Map<SuggestionType, Suggestion[]>();
  for (const s of suggestions) by.set(s.type, [...(by.get(s.type) || []), s]);
  const obvious = suggestions.filter((s) => OBVIOUS.includes(s.type));
  const total = suggestions.reduce((t, s) => t + s.seconds, 0);

  return (
    <div className="panel">
      <div className="clean-head">
        <div>
          <div className="big">{suggestions.length ? `${suggestions.length} things to clean up` : "Nothing left to clean up"}</div>
          <div className="muted">{suggestions.length ? `about ${formatLength(total)} of junk` : transcribing ? "More will show up as clips finish transcribing." : "Every finder came back empty."}</div>
        </div>
        <span className="spacer" />
        <button className="primary sm" disabled={!obvious.length} onClick={() => onCutAll(OBVIOUS)}
          title="Cuts fillers, stumbles, long pauses and dead air. Retakes and repeated words wait for you.">
          <Icon name="scissors" size={15} /> Clean up the obvious{obvious.length ? ` (${obvious.length})` : ""}
        </button>
      </div>
      {ORDER.map((t) => {
        const list = by.get(t) || [];
        const info = TYPE_INFO[t];
        const sec = list.reduce((a, s) => a + s.seconds, 0);
        return (
          <div key={t} className={"kind-row" + (list.length ? "" : " off")}>
            <span className="kind-dot" style={{ background: KIND_COLOR[t] }} />
            <div className="kind-label">{info.label}</div>
            <div className="kind-actions">
              <button className={"eye" + (visible.has(t) ? " on" : "")} title={visible.has(t) ? "Hide in the text" : "Show in the text"}
                aria-label={(visible.has(t) ? "Hide " : "Show ") + info.label} onClick={() => onToggle(t)}>
                <Icon name={visible.has(t) ? "eye" : "eyeOff"} size={16} />
              </button>
              <button className="sm" disabled={!list.length} onClick={() => onReview(t)}>Review</button>
              <button className="sm" disabled={!list.length} onClick={() => onCutAll([t])}>Cut all</button>
            </div>
            <div className="kind-hint">
              <b>{list.length ? `${list.length} · ${formatLength(sec)}` : "none"}</b> · {info.hint}
            </div>
            {t === "pause" && (
              <div className="kind-settings">
                Pauses longer than
                <input type="number" min={0.3} max={5} step={0.1} value={options.pauseMax}
                  onChange={(e) => onOptions({ ...options, pauseMax: Math.max(0.3, Number(e.target.value) || 0.8) })} />
                s become
                <input type="number" min={0.1} max={2} step={0.05} value={options.pauseKeep}
                  onChange={(e) => onOptions({ ...options, pauseKeep: Math.min(options.pauseMax, Math.max(0.1, Number(e.target.value) || 0.35)) })} />
                s
              </div>
            )}
          </div>
        );
      })}
      <p className="done-note">
        Select words and press <kbd>Backspace</kbd> to cut them; do it again on cut words to bring them back.
        <br /><kbd>Space</kbd> plays · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- clips

export function ClipsPanel({ project, engines, uploading, onAdd, onRemove, onRetry, onMove, onEngine, onRetranscribe, onCutClip }: {
  project: Project;
  engines: { order: string[]; engines: Record<string, EngineInfo>; default: string | null } | null;
  uploading: { names: string[]; fraction: number } | null;
  onAdd: (files: File[]) => void;
  onRemove: (c: Clip) => void;
  onRetry: (c: Clip) => void;
  onMove: (c: Clip, dir: -1 | 1) => void;
  onEngine: (e: string) => void;
  onRetranscribe: () => void;
  onCutClip: (c: Clip, cut: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const chosen = (project.settings.engine as string) || "auto";
  return (
    <div className="panel">
      <div className={"drop-zone" + (over ? " over" : "")} role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onAdd([...e.dataTransfer.files]); }}>
        <b>Add clips</b> · drop video or audio files here, or click to pick
        <input ref={input} type="file" multiple accept="video/*,audio/*" hidden
          onChange={(e) => { onAdd([...(e.target.files || [])]); e.target.value = ""; }} />
      </div>
      {uploading && (
        <div className="clip-row" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <div className="clip-name">Uploading {uploading.names.length} file{uploading.names.length === 1 ? "" : "s"}…</div>
            <div className="mini-progress"><div style={{ width: `${Math.round(uploading.fraction * 100)}%` }} /></div>
          </div>
        </div>
      )}
      {project.clips.map((c, k) => {
        const p = c.progress || {};
        const busy = c.proxy === "pending" || c.transcript === "pending";
        const pct = c.transcript === "pending" ? p.transcript ?? 0 : p.proxy ?? 0;
        const label = c.proxy === "error" || c.transcript === "error" ? c.error
          : c.transcript === "pending" ? (p.msg || "Waiting to transcribe")
          : c.proxy === "pending" ? `Making a preview copy ${p.proxy ?? 0}%`
          : c.transcript === "none" ? "No speech" : `Words by ${engines?.engines[c.engine]?.label || c.engine}`;
        const whole = project.cuts.some((x) => x.clip === c.id && x.start <= 0.001 && x.end >= c.duration - 0.001);
        return (
          <div key={c.id} className="clip-row" style={{ opacity: whole ? 0.55 : 1 }}>
            {c.proxy === "done" && c.width ? <img className="clip-thumb" src={api.thumbUrl(project.id, c.id)} alt="" />
              : <div className="clip-thumb">{c.width ? "…" : "audio"}</div>}
            <div style={{ minWidth: 0 }}>
              <div className="clip-name" title={c.name}>{k + 1}. {c.name}</div>
              <div className="clip-meta">
                <span>{formatTime(c.duration)}</span>
                {c.width > 0 && <span>{c.width}×{c.height}</span>}
                {c.vfr && <span className="warn" title="Phones record a variable frame rate. Studio's own export handles it.">VFR</span>}
              </div>
              <div className={"clip-meta" + (c.error ? " err" : "")} style={{ marginTop: 2 }} title={label}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              </div>
              {busy && <div className="mini-progress"><div style={{ width: `${pct}%` }} /></div>}
            </div>
            <div className="clip-actions">
              {(c.proxy === "error" || c.transcript === "error") ? <button className="sm" onClick={() => onRetry(c)}>Retry</button> : (
                <button className="sm" onClick={() => onCutClip(c, !whole)} title={whole ? "Put this clip back in the edit" : "Leave this whole clip out of the edit"}>
                  {whole ? "Use" : "Skip"}
                </button>
              )}
              <div style={{ display: "flex", gap: 4 }}>
                <button className="sm ghost" disabled={k === 0} onClick={() => onMove(c, -1)} aria-label="Move up">↑</button>
                <button className="sm ghost" disabled={k === project.clips.length - 1} onClick={() => onMove(c, 1)} aria-label="Move down">↓</button>
              </div>
              <button className="sm ghost danger" onClick={() => onRemove(c)}>Remove</button>
            </div>
          </div>
        );
      })}
      {engines && (
        <label className="engine-pick">
          Speech engine for this project
          <select value={chosen} onChange={(e) => onEngine(e.target.value)}>
            <option value="auto">Best available ({engines.default ? engines.engines[engines.default].label : "none"})</option>
            {engines.order.map((e) => (
              <option key={e} value={e} disabled={!engines.engines[e].ok}>
                {engines.engines[e].label}{engines.engines[e].ok ? "" : ` (${engines.engines[e].why})`}
              </option>
            ))}
          </select>
          <button className="sm" style={{ alignSelf: "flex-start" }} disabled={!project.clips.some((c) => c.transcript === "done")}
            onClick={onRetranscribe}>Transcribe every clip again with this engine</button>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- export

export function ExportDialog({ project, editedSeconds, onClose, onStart, onCancel }: {
  project: Project;
  editedSeconds: number;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const st = project.export;
  const fmt = project.export_format;
  const busy = project.clips.filter((c) => c.proxy === "pending" || c.transcript === "pending").length;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    ref.current?.querySelector<HTMLElement>(".primary")?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="exp-title" ref={ref}>
        <h2 id="exp-title">Export</h2>
        <dl className="facts">
          <dt>Length</dt><dd>{formatTime(editedSeconds)}</dd>
          <dt>Picture</dt><dd>{fmt.width}×{fmt.height} at {fmt.fps.includes("/") ? (Number(fmt.fps.split("/")[0]) / Number(fmt.fps.split("/")[1])).toFixed(2) : fmt.fps} fps</dd>
          <dt>Files</dt><dd>MP4 (H.264 + AAC) and SRT captions</dd>
          <dt>From</dt><dd>your original clips, not the previews</dd>
        </dl>
        {busy > 0 && st.state !== "running" && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{busy} clip{busy === 1 ? " is" : "s are"} still processing; they go in as they are now.</p>
        )}
        {st.state === "running" && (
          <div>
            <div className="progress"><div style={{ width: `${st.pct ?? 0}%` }} /></div>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>Rendering… {st.pct ?? 0}%</p>
          </div>
        )}
        {st.state === "error" && <p className="err" style={{ margin: 0, fontSize: 13 }}>{st.error}</p>}
        {st.state === "done" && <p style={{ margin: 0, fontSize: 13.5 }}>Done: <b>{st.file}</b></p>}
        <div className="actions">
          <button onClick={onClose}>Close</button>
          {st.state === "running" ? <button className="danger" onClick={onCancel}>Stop</button> : st.state === "done" ? (
            <>
              <a className="btn" href={api.exportFileUrl(project.id, "srt")} download>Captions (.srt)</a>
              <a className="btn primary" href={api.exportFileUrl(project.id, "mp4")} download>Download MP4</a>
              <button onClick={onStart}>Export again</button>
            </>
          ) : (
            <button className="primary" onClick={onStart}>Export MP4</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the edited timeline strip

const SHADES = ["#d9d5ff", "#c8f0ea", "#ffe3b3", "#d6e6ff", "#f7d4dc", "#e2e7ee"];

export function Strip({ segs, clips, time, total, original, onSeek }: {
  segs: Segment[]; clips: Clip[]; time: number; total: number; original: number; onSeek: (t: number) => void;
}) {
  const idx = new Map(clips.map((c, i) => [c.id, i]));
  const firstOf = new Map<string, Segment>();
  for (const s of segs) if (!firstOf.has(s.clip)) firstOf.set(s.clip, s);
  const pct = (t: number) => (total ? (t / total) * 100 : 0);
  const saved = Math.max(0, original - total);
  return (
    <>
      <div className="strip" role="slider" aria-label="Position in the edit" aria-valuemin={0}
        aria-valuemax={Math.round(total)} aria-valuenow={Math.round(time)} tabIndex={0}
        onMouseDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const seek = (x: number) => onSeek(Math.min(1, Math.max(0, (x - r.left) / r.width)) * total);
          seek(e.clientX);
          const move = (ev: MouseEvent) => seek(ev.clientX);
          const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(total, time + 5));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 5));
        }}>
        {segs.map((s, i) => (
          <div key={i} className="strip-seg" style={{ left: `${pct(s.offset)}%`, width: `${pct(s.end - s.start)}%`, background: SHADES[(idx.get(s.clip) ?? 0) % SHADES.length] }} />
        ))}
        {[...firstOf.entries()].map(([cid, s]) => (
          <div key={cid} className="strip-clip" style={{ left: `${pct(s.offset)}%`, maxWidth: `${Math.max(4, 100 - pct(s.offset))}%` }}>
            {clips[idx.get(cid) ?? 0]?.name}
          </div>
        ))}
        <div className="strip-head" style={{ left: `${pct(time)}%` }} />
      </div>
      <div className="strip-foot">
        <span>{segs.length} piece{segs.length === 1 ? "" : "s"} from {firstOf.size} clip{firstOf.size === 1 ? "" : "s"}</span>
        <span>Raw footage {formatTime(original)} → edit <b>{formatTime(total)}</b>{saved / Math.max(1, original) >= 0.01 ? ` (${Math.round((saved / Math.max(1, original)) * 100)}% shorter)` : ""}</span>
      </div>
    </>
  );
}
