import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type ProjectEdit } from "./api";
import { go } from "./App";
import { Icon, KIND_COLOR, Toasts } from "./bits";
import {
  cutsFor, DEFAULT_OPTIONS, detect, TYPE_INFO,
  type ClipWords, type DetectOptions, type Suggestion, type SuggestionType,
} from "./detect";
import { takePendingFiles } from "./Home";
import { useHistory, useToasts } from "./hooks";
import { CleanupPanel, ClipsPanel, ExportDialog, Strip } from "./Panels";
import { SeamlessPlayer } from "./player";
import { cutForWords } from "./snap";
import {
  clipCutRanges, editedDuration, formatLength, formatTime, keptSegments, subtractRange, toEdited, toSource,
  type ClipSpan, type Range,
} from "./timeline";
import TranscriptView, { ordered, type DocClip, type Pos, type Sel } from "./Transcript";
import type { Cut, EngineInfo, Project, Word } from "./types";

const Transcript = memo(TranscriptView);
const ALL: SuggestionType[] = ["filler", "cutoff", "repeat", "retake", "pause", "dead"];

interface EditState { cuts: Cut[]; ignored: string[] }
interface ClipData { words: Word[] | null; energy: Float32Array | null; sig: string }

const rateOf = (fps: string) => {
  const [a, b] = fps.split("/").map(Number);
  return b ? a / b : a || 30;
};

export default function Editor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [data, setData] = useState<Record<string, ClipData>>({});
  const hist = useHistory<EditState>({ cuts: [], ignored: [] });
  const [opts, setOpts] = useState<DetectOptions>(DEFAULT_OPTIONS);
  const [sel, setSel] = useState<Sel | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<SuggestionType>>(() => new Set(ALL));
  const [hideCut, setHideCut] = useState(false);
  const [tab, setTab] = useState<"clean" | "clips">("clean");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [exportOpen, setExportOpen] = useState(false);
  const [uploading, setUploading] = useState<{ names: string[]; fraction: number } | null>(null);
  const [engines, setEngines] = useState<{ order: string[]; engines: Record<string, EngineInfo>; default: string | null } | null>(null);
  const [dragFiles, setDragFiles] = useState(false);
  const [pop, setPop] = useState<{ top: number; left: number } | null>(null);
  const { toasts, push } = useToasts();

  const revRef = useRef(0);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  const loaded = useRef(false);
  const skipSave = useRef(true);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const wrapRef = useRef<HTMLDivElement>(null);
  const vidA = useRef<HTMLVideoElement>(null);
  const vidB = useRef<HTMLVideoElement>(null);
  const player = useRef<SeamlessPlayer | null>(null);

  const { cuts, ignored } = hist.value;
  // useHistory hands back a fresh object every render; only its functions are stable. Depend
  // on those, or every render re-arms the autosave (it did: a save ~10x a second in playback).
  const { reset: histReset, set: histSet, undo: histUndo, redo: histRedo } = hist;

  // ------------------------------------------------------------ load + poll
  const adopt = useCallback((p: Project) => {
    revRef.current = p.edit_rev;
    skipSave.current = true;
    histReset({ cuts: p.cuts, ignored: (p.settings.ignored as string[]) ?? [] });
    setOpts({ pauseMax: Number(p.settings.pauseMax) || DEFAULT_OPTIONS.pauseMax, pauseKeep: Number(p.settings.pauseKeep) || DEFAULT_OPTIONS.pauseKeep });
    setProject(p);
  }, [histReset]);

  useEffect(() => {
    api.project(id).then((p) => {
      adopt(p);
      loaded.current = true;
      const files = takePendingFiles(id);
      if (files?.length) void addClips(files);
    }).catch((e: ApiError) => setLoadErr(e.status === 404 ? "This project doesn't exist any more." : e.message));
    api.engines().then(setEngines).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const busy = !!project && (project.clips.some((c) => c.proxy === "pending" || c.transcript === "pending") || project.export.state === "running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      api.project(id).then((p) => setProject((old) => (old ? { ...p, cuts: old.cuts } : p))).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [busy, id]);

  // Words + loudness for every clip whose transcript is ready (again, after a re-transcribe).
  useEffect(() => {
    if (!project) return;
    for (const c of project.clips) {
      const sig = `${c.transcript}:${c.engine}`;
      if (data[c.id]?.sig === sig) continue;
      if (c.transcript === "pending" || c.transcript === "error") {
        if (data[c.id]?.words) setData((d) => ({ ...d, [c.id]: { words: null, energy: null, sig } }));
        continue;
      }
      setData((d) => ({ ...d, [c.id]: { words: d[c.id]?.words ?? null, energy: d[c.id]?.energy ?? null, sig } }));
      Promise.all([
        c.transcript === "done" ? api.words(id, c.id) : Promise.resolve([] as Word[]),
        c.has_audio ? api.energy(id, c.id) : Promise.resolve(null),
      ]).then(([words, energy]) => setData((d) => ({ ...d, [c.id]: { words, energy, sig } })))
        .catch(() => setData((d) => { const n = { ...d }; delete n[c.id]; return n; }));
    }
  }, [project, data, id]);

  // ------------------------------------------------------------ saving
  const enqueueSave = useCallback((edit: Omit<ProjectEdit, "edit_rev">) => {
    const run = async () => {
      try {
        const p = await api.save(id, { ...edit, edit_rev: revRef.current });
        revRef.current = p.edit_rev;
        setProject((old) => (old ? { ...p } : p));
        setSaveState("saved");
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409) {
          const server = (err.body as { project: Project }).project;
          adopt(server);
          setSaveState("saved");
          push("This project was changed in another window. You're looking at the latest version.");
        } else {
          setSaveState("error");
        }
      }
    };
    saveChain.current = saveChain.current.then(run, run);
    return saveChain.current;
  }, [id, adopt, push]);

  useEffect(() => {
    if (!loaded.current) return;
    if (skipSave.current) { skipSave.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => void enqueueSave({ cuts, settings: { ignored, pauseMax: opts.pauseMax, pauseKeep: opts.pauseKeep } }), 450);
    return () => clearTimeout(t);
  }, [cuts, ignored, opts, enqueueSave]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saveState !== "saved") e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // ------------------------------------------------------------ derived
  const clips = useMemo(() => project?.clips ?? [], [project]);
  const spansKey = clips.map((c) => `${c.id}:${c.duration}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spans: ClipSpan[] = useMemo(() => clips.map((c) => ({ id: c.id, duration: c.duration })), [spansKey]);
  const rate = project ? rateOf(project.export_format.fps) : 30;
  const segs = useMemo(() => keptSegments(spans, cuts, 1 / rate), [spans, cuts, rate]);
  const total = editedDuration(segs);
  const original = useMemo(() => spans.reduce((t, c) => t + c.duration, 0), [spans]);
  const rangesBy = useMemo(() => new Map(spans.map((c) => [c.id, clipCutRanges(cuts, c)])), [spans, cuts]);
  const clipIndex = useMemo(() => new Map(clips.map((c, i) => [c.id, i])), [clips]);

  const docClips: DocClip[] = useMemo(() => clips.map((c) => ({
    clip: c, words: data[c.id]?.words ?? null, ranges: rangesBy.get(c.id) ?? [],
  })), [clips, data, rangesBy]);

  const clipWords: ClipWords[] = useMemo(() => clips.filter((c) => data[c.id]?.words).map((c) => ({
    id: c.id, duration: c.duration, words: data[c.id].words!, energy: data[c.id].energy,
  })), [clips, data]);

  const ignoredSet = useMemo(() => new Set(ignored), [ignored]);
  const suggestions = useMemo(() => detect(clipWords, cuts, ignoredSet, opts), [clipWords, cuts, ignoredSet, opts]);

  // Which suggestion sits on each word / pause, for the underlines. Small, specific ones win
  // over a retake that spans the same words.
  const sugAt = useMemo(() => {
    const m = new Map<string, Suggestion>();
    const wordsOf = (cid: string) => data[cid]?.words ?? [];
    const ranked = [...suggestions].sort((a, b) => (a.type === "retake" ? 1 : 0) - (b.type === "retake" ? 1 : 0));
    for (const s of ranked) {
      for (const p of s.parts) {
        if (p.first >= 0) {
          for (let i = p.first; i <= p.last; i++) if (!m.has(`${p.clip}:${i}`)) m.set(`${p.clip}:${i}`, s);
        } else if (s.id.endsWith(":head")) m.set(`${p.clip}:head`, s);
        else if (s.id.endsWith(":tail")) m.set(`${p.clip}:tail`, s);
        else {
          const ws = wordsOf(p.clip);
          const i = ws.findIndex((w, k) => k + 1 < ws.length && w.end <= p.start + 1e-6 && ws[k + 1].start >= p.end - 1e-6);
          if (i >= 0) m.set(`${p.clip}:g${i}`, s);
        }
      }
    }
    return m;
  }, [suggestions, data]);

  const focused = focusId ? suggestions.find((s) => s.id === focusId) ?? null : null;

  // ------------------------------------------------------------ player
  useEffect(() => {
    if (!vidA.current || !vidB.current) return;
    const p = new SeamlessPlayer(vidA.current, vidB.current, (cid) => {
      const c = projectRef.current?.clips.find((x) => x.id === cid);
      return c && c.proxy === "done" ? api.proxyUrl(id, cid) : null;
    });
    player.current = p;
    if (import.meta.env.DEV) (window as unknown as { studioPlayer?: SeamlessPlayer }).studioPlayer = p; // for debugging
    return () => { p.destroy(); player.current = null; };
  }, [id, !!project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { player.current?.setSegments(segs); }, [segs]);

  // The word under the playhead: straight on the DOM, every frame, without re-rendering.
  const nowEl = useRef<HTMLElement | null>(null);
  const lastScroll = useRef(0);
  const userScrolled = useRef(0);
  const lastTimeSet = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const clipIndexRef = useRef(clipIndex);
  clipIndexRef.current = clipIndex;

  const onTime = useCallback((t: number) => {
    const now = performance.now();
    if (now - lastTimeSet.current > 90) { lastTimeSet.current = now; setTime(t); }
    const loc = toSource(segsRef.current, t);
    let el: HTMLElement | null = null;
    if (loc) {
      const ws = dataRef.current[loc.clip]?.words;
      const c = clipIndexRef.current.get(loc.clip);
      if (ws?.length && c !== undefined) {
        let lo = 0, hi = ws.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ws[mid].start <= loc.time + 0.02) lo = mid; else hi = mid - 1; }
        if (ws[lo].start <= loc.time + 0.02 && loc.time < ws[lo].end + 0.25) {
          el = wrapRef.current?.querySelector<HTMLElement>(`[data-c="${c}"][data-i="${lo}"]:not([data-gap])`) ?? null;
        }
      }
    }
    if (el !== nowEl.current) {
      nowEl.current?.classList.remove("now");
      el?.classList.add("now");
      nowEl.current = el;
      const wrap = wrapRef.current;
      if (el && wrap && player.current?.playing && now - userScrolled.current > 2500 && now - lastScroll.current > 300) {
        const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        if (r.top < w.top + 60 || r.bottom > w.bottom - 60) {
          lastScroll.current = now;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    }
  }, []);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    p.onTime = onTime;
    p.onPlayState = setPlaying;
  }, [onTime, project?.id]);

  const seekTo = useCallback((t: number) => { void player.current?.seek(Math.max(0, t)); }, []);
  const seekWord = (cid: string, w: Word) => {
    const t = toEdited(segs, cid, Math.max(0, w.start - 0.05));
    if (t !== null) seekTo(t);
  };

  // ------------------------------------------------------------ edits
  const setCuts = (next: Cut[], nextIgnored = ignored) => histSet({ cuts: next, ignored: nextIgnored });

  const wordsAt = (c: number) => data[clips[c]?.id]?.words ?? [];
  const energyAt = (c: number) => data[clips[c]?.id]?.energy ?? null;

  /** Backspace on a selection: cut it, or bring it back if it is all cut already. */
  const cutSelection = () => {
    if (!sel) return;
    const s = ordered(sel);
    let next = cuts;
    const parts: { c: number; first: number; last: number }[] = [];
    for (let c = s.a.c; c <= s.b.c; c++) {
      const ws = wordsAt(c);
      if (!ws.length) continue;
      parts.push({ c, first: c === s.a.c ? s.a.i : 0, last: c === s.b.c ? Math.min(s.b.i, ws.length - 1) : ws.length - 1 });
    }
    const allCut = parts.every(({ c, first, last }) => {
      const r = rangesBy.get(clips[c].id) ?? [];
      return wordsAt(c).slice(first, last + 1).every((w) => r.some(([x, y]) => (w.start + w.end) / 2 >= x && (w.start + w.end) / 2 < y));
    });
    for (const { c, first, last } of parts) {
      const ws = wordsAt(c), clip = clips[c];
      if (allCut) {
        const a = first === 0 ? 0 : ws[first - 1].end;
        const b = last === ws.length - 1 ? clip.duration : ws[last + 1].start;
        next = subtractRange(next, clip.id, a, b);
      } else {
        const [a, b] = cutForWords(ws, first, last, clip.duration, energyAt(c));
        next = [...next, { clip: clip.id, start: a, end: b, reason: "manual" }];
      }
    }
    setCuts(next);
    setSel(null);
  };

  const applySuggestions = (list: Suggestion[]) => {
    if (!list.length) return;
    setCuts([...cuts, ...list.flatMap(cutsFor)]);
  };

  const nextOfType = (type: SuggestionType, after: Suggestion | null, excluding?: string) => {
    const list = suggestions.filter((s) => s.type === type && s.id !== excluding);
    if (!list.length) return null;
    if (!after) return list[0];
    const key = (s: Suggestion) => [clipIndex.get(s.parts[0].clip) ?? 0, s.parts[0].start] as const;
    const [ac, at] = key(after);
    return list.find((s) => { const [c, t] = key(s); return c > ac || (c === ac && t > at + 1e-6); }) ?? list[0];
  };

  const applyFocused = (s: Suggestion) => {
    const next = nextOfType(s.type, s, s.id);
    applySuggestions([s]);
    setFocusId(next?.id ?? null);
  };
  const keepFocused = (s: Suggestion) => {
    const next = nextOfType(s.type, s, s.id);
    histSet({ cuts, ignored: [...ignored, s.id] });
    setFocusId(next?.id ?? null);
  };

  /** Hear it with the cut made, before making it. */
  const audition = (s: Suggestion) => {
    const trial = keptSegments(spans, [...cuts, ...cutsFor(s)], 1 / rate);
    const p = s.parts[0];
    const seam = toEdited(trial, p.clip, p.start) ?? 0;
    void player.current?.audition(trial, seam - 2.5, seam + 2);
  };

  const review = (type: SuggestionType) => {
    const s = nextOfType(type, focused?.type === type ? focused : null);
    if (!s) return;
    if (!visible.has(type)) setVisible(new Set([...visible, type]));
    setFocusId(s.id);
  };

  // Keep the focused suggestion on screen and the card next to it.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let anchor: HTMLElement | null = null;
    if (focused) {
      const p = focused.parts[0];
      const c = clipIndex.get(p.clip);
      const sel = p.first >= 0 ? `[data-c="${c}"][data-i="${p.first}"]:not([data-gap])`
        : focused.id.endsWith(":head") ? `[data-c="${c}"][data-gap="head"]`
        : focused.id.endsWith(":tail") ? `[data-c="${c}"][data-gap="tail"]`
        : `[data-c="${c}"].sug-pause.focus, [data-c="${c}"][data-gap].focus`;
      anchor = wrap.querySelector<HTMLElement>(sel);
    } else if (sel) {
      const s = ordered(sel);
      anchor = wrap.querySelector<HTMLElement>(`[data-c="${s.b.c}"][data-i="${s.b.i}"]:not([data-gap])`);
    }
    if (!anchor) { setPop(null); return; }
    const r = anchor.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    if (focused && (r.top < w.top + 40 || r.bottom > w.bottom - 180)) {
      anchor.scrollIntoView({ block: "center" });
    }
    const r2 = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r2.left - w.left - 20), w.width - 316);
    setPop({ top: r2.bottom - w.top + wrap.scrollTop + 8, left });
  }, [focused, sel, clipIndex, hideCut, docClips]);

  // ------------------------------------------------------------ clips
  const addClips = async (files: File[]) => {
    const ok = files.filter((f) => /^(video|audio)\//.test(f.type) || /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mxf|mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(f.name));
    if (ok.length < files.length) push(`Skipped ${files.length - ok.length} file(s) that aren't video or audio.`);
    if (!ok.length) return;
    ok.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    await saveChain.current;
    setUploading({ names: ok.map((f) => f.name), fraction: 0 });
    setTab("clips");
    try {
      const p = await api.addClips(id, ok, (fraction) => setUploading({ names: ok.map((f) => f.name), fraction }));
      revRef.current = p.edit_rev;
      setProject(p);
    } catch (e) {
      push((e as Error).message, { kind: "err" });
    } finally {
      setUploading(null);
    }
  };

  const removeClip = async (cid: string) => {
    const c = clips.find((x) => x.id === cid);
    if (!c || !confirm(`Remove "${c.name}" from this project? Its file is deleted from Studio.`)) return;
    await saveChain.current;
    try {
      const p = await api.removeClip(id, cid);
      revRef.current = p.edit_rev;
      skipSave.current = true;
      histReset({ cuts: cuts.filter((x) => x.clip !== cid), ignored });
      setProject(p);
    } catch (e) { push((e as Error).message, { kind: "err" }); }
  };

  const moveClip = (cid: string, dir: -1 | 1) => {
    const order = clips.map((c) => c.id);
    const i = order.indexOf(cid), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setProject((p) => (p ? { ...p, clips: order.map((x) => p.clips.find((c) => c.id === x)!) } : p));
    void enqueueSave({ clip_order: order });
  };

  const cutWholeClip = (cid: string, cut: boolean) => {
    const c = clips.find((x) => x.id === cid);
    if (!c) return;
    setCuts(cut ? [...cuts, { clip: cid, start: 0, end: c.duration, reason: "manual" }] : subtractRange(cuts, cid, 0, c.duration));
  };

  const setEngine = (e: string) => void enqueueSave({ settings: { engine: e } }).then(() => push("Saved. New clips use this engine."));
  const retranscribeAll = async () => {
    if (!confirm("Transcribe every clip again? Your cuts stay where they are.")) return;
    await saveChain.current;
    for (const c of clips) if (c.transcript === "done") await api.retranscribe(id, c.id).catch(() => {});
    setProject(await api.project(id));
  };

  const startExport = async () => {
    await saveChain.current;
    try {
      const st = await api.startExport(id);
      setProject((p) => (p ? { ...p, export: st } : p));
    } catch (e) { push((e as Error).message, { kind: "err" }); }
  };

  // ------------------------------------------------------------ keyboard + mouse
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, select, textarea") || exportOpen) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? histRedo() : histUndo(); }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); return histRedo(); }
    if (e.key === " " && !el.closest("button, a")) { e.preventDefault(); return void player.current?.toggle(); }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (sel) { e.preventDefault(); return cutSelection(); }
      if (focused) { e.preventDefault(); return applyFocused(focused); }
    }
    if (e.key === "Enter" && focused && !el.closest("button")) { e.preventDefault(); return applyFocused(focused); }
    if (e.key === "Escape") { setSel(null); setFocusId(null); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const drag = useRef<{ start: Pos; moved: boolean } | null>(null);
  const justDragged = useRef(false); // the click that ends a drag-select must not clear it
  const posOf = (t: EventTarget | null): (Pos & { gap?: string }) | null => {
    const el = (t as HTMLElement | null)?.closest?.("[data-c][data-i]") as HTMLElement | null;
    if (!el) return null;
    return { c: Number(el.dataset.c), i: Number(el.dataset.i), gap: el.dataset.gap };
  };

  const onDocDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".pop")) return;
    const p = posOf(e.target);
    if (!p) { setSel(null); setFocusId(null); return; }
    if (p.gap !== undefined) return; // pauses are clicked, not dragged
    e.preventDefault();
    if (e.shiftKey && sel) { setSel({ a: sel.a, b: p }); return; }
    drag.current = { start: p, moved: false };
  };
  const onDocOver = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d) return; // a drag runs from mousedown to the window mouseup, nothing else
    const p = posOf(e.target);
    if (!p || p.gap !== undefined) return;
    if (p.c !== d.start.c || p.i !== d.start.i) {
      d.moved = true;
      justDragged.current = true;
      setFocusId(null);
      setSel({ a: d.start, b: p });
    }
  };
  useEffect(() => {
    const up = () => { drag.current = null; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const onDocClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".pop")) return;
    if (justDragged.current) { justDragged.current = false; return; }
    const p = posOf(e.target);
    if (!p) return;
    const clip = clips[p.c];
    const ws = wordsAt(p.c);
    if (p.gap !== undefined) {
      const s = sugAt.get(`${clip.id}:${p.gap}`);
      setSel(null);
      setFocusId(s && visible.has(s.type) ? s.id : null);
      const t = p.gap === "head" ? 0 : ws[p.i]?.end ?? 0;
      const et = toEdited(segs, clip.id, t);
      if (et !== null) seekTo(et);
      return;
    }
    if (e.shiftKey) return;
    const s = sugAt.get(`${clip.id}:${p.i}`);
    setSel(null);
    setFocusId(s && visible.has(s.type) ? s.id : null);
    if (ws[p.i]) seekWord(clip.id, ws[p.i]);
  };
  const onDocDouble = (e: React.MouseEvent) => {
    const p = posOf(e.target);
    if (!p || p.gap !== undefined) return;
    setFocusId(null);
    setSel({ a: p, b: p });
  };

  const thumb = useCallback((cid: string) => api.thumbUrl(id, cid), [id]);

  // ------------------------------------------------------------ render
  if (loadErr) {
    return (
      <div className="home"><div className="empty"><h2>{loadErr}</h2><button onClick={() => go("#/")}>Back to projects</button></div></div>
    );
  }
  if (!project) return <div className="home"><p className="muted">Loading…</p></div>;

  const transcribing = clips.some((c) => c.transcript === "pending");
  const selInfo = sel ? describeSelection(ordered(sel), clips, data, rangesBy) : null;

  return (
    <div className="ed"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) setDragFiles(true); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDragLeave={(e) => { if (!e.relatedTarget) setDragFiles(false); }}
      onDrop={(e) => { e.preventDefault(); setDragFiles(false); const f = [...e.dataTransfer.files]; if (f.length) void addClips(f); }}>
      <header className="topbar">
        <button className="brand" onClick={() => go("#/")} title="All projects">
          <Icon name="back" size={16} /><div className="logo">S</div><span>Projects</span>
        </button>
        <input className="title-input" aria-label="Project name" defaultValue={project.name} key={project.name}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== project.name) void enqueueSave({ name: v }); }} />
        <span className={"save-state" + (saveState === "error" ? " bad" : "")}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved. Is Cvideo running?" : "Saved"}
        </span>
        <span className="spacer" />
        <button className="ghost icon" onClick={histUndo} disabled={!hist.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
        <button className="ghost icon" onClick={histRedo} disabled={!hist.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
        <button className="ghost sm" onClick={() => setHideCut(!hideCut)} aria-pressed={hideCut}>
          <Icon name={hideCut ? "eyeOff" : "eye"} size={16} /> <span className="hide-label">{hideCut ? "Show cut words" : "Hide cut words"}</span>
        </button>
        <button className="primary" disabled={!segs.length} onClick={() => setExportOpen(true)}>
          {project.export.state === "running" ? `Exporting ${project.export.pct ?? 0}%` : "Export"}
        </button>
      </header>

      <div className="doc-wrap" ref={wrapRef} onMouseDown={onDocDown} onMouseOver={onDocOver} onClick={onDocClick}
        onDoubleClick={onDocDouble} onWheel={() => { userScrolled.current = performance.now(); }}>
        {clips.length === 0 && !uploading ? (
          <div className="doc doc-empty">
            <div className="empty">
              <h2>Drop your clips here</h2>
              <p>Video or audio, as many as you like. They're transcribed word by word,<br />then you edit the video by editing the text.</p>
              <button className="primary" style={{ marginTop: 10 }} onClick={() => setTab("clips")}>Add clips</button>
            </div>
          </div>
        ) : (
          <Transcript clips={docClips} thumb={thumb} sugAt={sugAt} visible={visible} sel={sel} focusId={focusId} hideCut={hideCut} />
        )}
        {pop && focused && (
          <div className="pop" style={{ top: pop.top, left: pop.left }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="pop-kind"><span className="kind-dot" style={{ background: KIND_COLOR[focused.type] }} />{TYPE_INFO[focused.type].label}
              <span className="spacer" /><span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{focused.seconds.toFixed(1)}s</span></div>
            <div className="pop-why">{focused.why}</div>
            <div className="pop-actions">
              <button className="primary sm" onClick={() => applyFocused(focused)}><Icon name="scissors" size={14} /> Cut <kbd>⌫</kbd></button>
              <button className="sm" onClick={() => keepFocused(focused)}>Keep it</button>
              <button className="sm" onClick={() => audition(focused)}><Icon name="play" size={13} /> Hear it cut</button>
            </div>
            <div className="pop-nav">
              {(() => { const list = suggestions.filter((s) => s.type === focused.type); const k = list.findIndex((s) => s.id === focused.id); return `${k + 1} of ${list.length}`; })()}
              <span className="spacer" />
              <button className="sm ghost" onClick={() => { const n = nextOfType(focused.type, focused, focused.id); if (n) setFocusId(n.id); }}>Next ›</button>
            </div>
          </div>
        )}
        {pop && !focused && selInfo && (
          <div className="pop" style={{ top: pop.top, left: pop.left, width: "auto" }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="pop-actions" style={{ alignItems: "center" }}>
              <span className="muted">{selInfo.words} word{selInfo.words === 1 ? "" : "s"}</span>
              <button className="primary sm" onClick={cutSelection}>
                {selInfo.allCut ? "Bring back" : <><Icon name="scissors" size={14} /> Cut</>} <kbd>⌫</kbd>
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="side">
        <div className="preview">
          <div className="screen">
            <video ref={vidA} />
            <video ref={vidB} />
            {!clips.some((c) => c.proxy === "done") && (
              <div className="screen-msg">{clips.length ? "Making preview copies…" : "Your edit plays here"}</div>
            )}
          </div>
          <div className="transport">
            <button className="play-btn" onClick={() => void player.current?.toggle()} aria-label={playing ? "Pause" : "Play"} disabled={!segs.length}>
              <Icon name={playing ? "pause" : "play"} size={20} />
            </button>
            <span className="clock">{formatTime(time)} <span className="muted">/ {formatTime(total)}</span></span>
            {original - total >= 0.1 && <span className="saved-chip">−{formatLength(original - total)} cut</span>}
          </div>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "clean"} className={tab === "clean" ? "on" : ""} onClick={() => setTab("clean")}>
            Clean up {suggestions.length > 0 && <span className="count">{suggestions.length}</span>}
          </button>
          <button role="tab" aria-selected={tab === "clips"} className={tab === "clips" ? "on" : ""} onClick={() => setTab("clips")}>
            Clips <span className="count">{clips.length}</span>
          </button>
        </div>
        {tab === "clean" ? (
          <CleanupPanel suggestions={suggestions} visible={visible} transcribing={transcribing}
            onToggle={(t) => { const v = new Set(visible); if (v.has(t)) v.delete(t); else v.add(t); setVisible(v); }}
            onCutAll={(types) => { applySuggestions(suggestions.filter((s) => types.includes(s.type))); setFocusId(null); push(`Cut ${suggestions.filter((s) => types.includes(s.type)).length}. Ctrl+Z puts them back.`); }}
            onReview={review} options={opts} onOptions={setOpts} />
        ) : (
          <ClipsPanel project={{ ...project, cuts }} engines={engines} uploading={uploading} onAdd={(f) => void addClips(f)}
            onRemove={(c) => void removeClip(c.id)} onRetry={(c) => void api.retryClip(id, c.id).then(setProject)}
            onMove={(c, d) => moveClip(c.id, d)} onEngine={setEngine} onRetranscribe={() => void retranscribeAll()}
            onCutClip={(c, cut) => cutWholeClip(c.id, cut)} />
        )}
      </aside>

      <footer className="bar">
        <Strip segs={segs} clips={clips} time={time} total={total} original={original} onSeek={seekTo} />
      </footer>

      {exportOpen && (
        <ExportDialog project={project} editedSeconds={total} onClose={() => setExportOpen(false)}
          onStart={() => void startExport()} onCancel={() => void api.cancelExport(id).then((st) => setProject((p) => (p ? { ...p, export: st } : p)))} />
      )}
      {dragFiles && <div className="drop-overlay">Drop to add these clips</div>}
      <Toasts toasts={toasts} />
    </div>
  );
}

function describeSelection(s: Sel, clips: Project["clips"], data: Record<string, ClipData>, rangesBy: Map<string, Range[]>) {
  let words = 0, cut = 0;
  for (let c = s.a.c; c <= s.b.c; c++) {
    const ws = data[clips[c]?.id]?.words ?? [];
    const r = rangesBy.get(clips[c]?.id) ?? [];
    const a = c === s.a.c ? s.a.i : 0, b = c === s.b.c ? Math.min(s.b.i, ws.length - 1) : ws.length - 1;
    for (let i = a; i <= b; i++) {
      words++;
      const m = (ws[i].start + ws[i].end) / 2;
      if (r.some(([x, y]) => m >= x && m < y)) cut++;
    }
  }
  return { words, allCut: words > 0 && cut === words };
}

