import { useEffect, useState } from "react";
import { api } from "./api";
import { go } from "./App";
import { useToasts } from "./hooks";
import { Toasts } from "./bits";
import { formatTime } from "./timeline";
import type { ProjectSummary } from "./types";

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export default function Home() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const { toasts, push } = useToasts();

  useEffect(() => {
    api.projects().then((r) => setList(r.projects)).catch((e) => push(e.message, { kind: "err" }));
  }, [push]);

  const create = async (files?: File[]) => {
    setBusy(true);
    try {
      const name = files?.length ? files[0].name.replace(/\.[^.]+$/, "") : "Untitled";
      const p = await api.create(name);
      if (files?.length) sessionStorage.setItem("studio.pendingUpload", p.id);
      pending = files ?? null;
      go(`#/p/${p.id}`);
    } catch (e) {
      push((e as Error).message, { kind: "err" });
      setBusy(false);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) void create(f); }}
      style={{ minHeight: "100%" }}
    >
      <header className="topbar">
        <div className="brand" style={{ cursor: "default" }}>
          <div className="logo">S</div>
          <b>Cvideo Studio</b>
          <span>edit long videos by editing words</span>
        </div>
      </header>
      <main className="home">
        <div className="home-head">
          <div>
            <h1>Your projects</h1>
            <p>Drop in a pile of clips. Studio writes down every word, finds the ums, stumbles,
              retakes and dead air, and you cut them by editing text.</p>
          </div>
          <button className="primary" disabled={busy} onClick={() => void create()}>+ New project</button>
        </div>
        {list === null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <div className="empty">
            <h2>Drop your clips anywhere on this page</h2>
            <p>or start an empty project and add them inside.</p>
            <button className="primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void create()}>+ New project</button>
          </div>
        ) : (
          <div className="proj-grid">
            {list.map((p) => (
              <button key={p.id} className="proj-card" onClick={() => go(`#/p/${p.id}`)}>
                <div className="proj-thumb">
                  {p.thumb_clip ? <img src={api.thumbUrl(p.id, p.thumb_clip)} alt="" /> : <span>No clips yet</span>}
                </div>
                <div className="proj-body">
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    {p.clips} clip{p.clips === 1 ? "" : "s"} · {formatTime(p.duration)} · {ago(p.updated)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
      {over && <div className="drop-overlay">Drop to start a new project</div>}
      <Toasts toasts={toasts} />
    </div>
  );
}

/** Files dropped on Home travel to the editor that opens next (same page, no reload). */
let pending: File[] | null = null;
export function takePendingFiles(id: string): File[] | null {
  if (sessionStorage.getItem("studio.pendingUpload") !== id) return null;
  sessionStorage.removeItem("studio.pendingUpload");
  const f = pending;
  pending = null;
  return f;
}
