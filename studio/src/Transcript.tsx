// The document: every clip's words, in timeline order. Cut words stay visible, struck
// through (or hidden), so nothing is ever lost. Junk the finders flagged is underlined in
// its kind's colour. Pauses show as small time pills.
//
// Hours of transcript means tens of thousands of words, so each paragraph is memoised on a
// string of its words' classes: an edit or a selection only re-renders the paragraphs it
// touches, and the "now playing" highlight is set straight on the DOM by the editor.

import { memo, useMemo } from "react";
import type { Suggestion, SuggestionType } from "./detect";
import { formatTime, type Range } from "./timeline";
import type { Clip, Word } from "./types";

export interface Pos { c: number; i: number }
export interface Sel { a: Pos; b: Pos }

export const before = (x: Pos, y: Pos) => x.c < y.c || (x.c === y.c && x.i <= y.i);
export const ordered = (s: Sel): Sel => (before(s.a, s.b) ? s : { a: s.b, b: s.a });

const GAP_SHOWN = 0.7;   // pauses at least this long get a pill (shorter ones are just breath)

/** How much of [a, b] the cuts leave. */
function remaining(ranges: Range[], a: number, b: number): number {
  let cut = 0;
  for (const [x, y] of ranges) cut += Math.max(0, Math.min(b, y) - Math.max(a, x));
  return Math.max(0, b - a - cut);
}

export interface DocClip {
  clip: Clip;
  words: Word[] | null;      // null while it is still being transcribed
  ranges: Range[];           // merged cuts of this clip
}

interface Props {
  clips: DocClip[];
  thumb: (clip: string) => string;
  sugAt: Map<string, Suggestion>;
  visible: Set<SuggestionType>;
  sel: Sel | null;
  focusId: string | null;
  hideCut: boolean;
}

const fmtGap = (s: number) => (s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`);

export default function Transcript({ clips, thumb, sugAt, visible, sel, focusId, hideCut }: Props) {
  const s = sel ? ordered(sel) : null;
  return (
    <div className={"doc" + (hideCut ? " hide-cut" : "")}>
      {clips.map((dc, c) => (
        <ClipBlock key={dc.clip.id} c={c} dc={dc} thumb={thumb} sugAt={sugAt} visible={visible}
          selA={s && s.a.c <= c && s.b.c >= c ? (s.a.c === c ? s.a.i : 0) : -1}
          selB={s && s.a.c <= c && s.b.c >= c ? (s.b.c === c ? s.b.i : Infinity) : -2}
          focusId={focusId} />
      ))}
    </div>
  );
}

function status(clip: Clip): string {
  const p = clip.progress || {};
  if (clip.transcript === "error") return "Couldn't transcribe: " + clip.error;
  if (clip.transcript === "pending") {
    return (p.msg || "Waiting to transcribe") + (p.transcript ? ` · ${p.transcript}%` : "");
  }
  return "";
}

function ClipBlock({ c, dc, thumb, sugAt, visible, selA, selB, focusId }: {
  c: number; dc: DocClip; thumb: (id: string) => string; sugAt: Map<string, Suggestion>;
  visible: Set<SuggestionType>; selA: number; selB: number; focusId: string | null;
}) {
  const { clip, words, ranges } = dc;

  // Classes for every word and gap, then grouped into paragraphs.
  const items = useMemo(() => {
    if (!words) return null;
    const isIn = (a: number, b: number) => {
      const mid = (a + b) / 2;
      return ranges.some(([x, y]) => mid >= x && mid < y);
    };
    const sugClass = (key: string) => {
      const s = sugAt.get(`${clip.id}:${key}`);
      if (!s || !visible.has(s.type)) return "";
      return ` sug sug-${s.type}${s.id === focusId ? " focus" : ""}`;
    };
    type Item = { k: string; cls: string; text: string; i: number; gap?: string };
    const out: Item[] = [];
    const gapItem = (key: string, a: number, b: number, i: number) => {
      const len = b - a;
      if (len < GAP_SHOWN) return;
      const left = remaining(ranges, a, b);
      const cut = left < 0.05;
      const shortened = !cut && left < len - 0.05;
      out.push({
        k: "g" + key, i, gap: key,
        cls: "gap" + (cut ? " cut" : "") + sugClass(key),
        text: shortened ? `${fmtGap(len)} → ${fmtGap(left)}` : fmtGap(len),
      });
    };
    if (words.length) gapItem("head", 0, words[0].start, -1);
    words.forEach((w, i) => {
      const sel = i >= selA && i <= selB;
      out.push({
        k: "w" + i, i, text: w.word,
        cls: "w" + (w.kind ? " " + w.kind : "") + (isIn(w.start, w.end) ? " cut" : "")
          + sugClass(String(i)) + (sel ? " sel" : ""),
      });
      if (i + 1 < words.length) gapItem("g" + i, w.end, words[i + 1].start, i);
    });
    if (words.length) gapItem("tail", words[words.length - 1].end, clip.duration, words.length - 1);
    return out;
  }, [words, ranges, sugAt, visible, selA, selB, focusId, clip.id, clip.duration]);

  // Paragraphs: break after a sentence once a paragraph is long enough, or at a long pause.
  const paras = useMemo(() => {
    if (!items || !words) return [];
    const ps: (typeof items)[] = [];
    let cur: typeof items = [];
    let n = 0;
    for (const it of items) {
      cur.push(it);
      if (it.gap === undefined) {
        n++;
        const w = words[it.i];
        const nextGap = it.i + 1 < words.length ? words[it.i + 1].start - w.end : 0;
        if ((n >= 45 && /[.!?]["')]*$/.test(w.word)) || nextGap > 2.5) {
          ps.push(cur); cur = []; n = 0;
        }
      }
    }
    if (cur.length) ps.push(cur);
    return ps;
  }, [items, words]);

  const allCut = clip.duration > 0 && remaining(ranges, 0, clip.duration) < 0.05;
  const st = status(clip);
  return (
    <section data-clip={c}>
      <div className="clip-head">
        {clip.proxy === "done" && clip.width ? <img src={thumb(clip.id)} alt="" /> : <span className="ph" />}
        <span className="nm">{clip.name}</span>
        <span className="meta">{formatTime(clip.duration)}</span>
        {st && <span className={"meta" + (clip.transcript === "error" ? " err" : "")} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{st}</span>}
      </div>
      {words === null ? (
        <p className="no-speech">{clip.transcript === "error" ? "No transcript. Retry it from the Clips tab." : "Writing down every word…"}</p>
      ) : words.length === 0 ? (
        <p className={"no-speech" + (allCut ? " cut" : "")} data-clip-silent={c}>
          {clip.transcript === "none" || !clip.has_audio
            ? "No speech in this clip (B-roll). It plays in full; cut it from the Clips tab."
            : "No words found in this clip."}
        </p>
      ) : (
        paras.map((p, k) => <Para key={k} c={c} items={p} sig={p.map((x) => x.cls).join("|")} />)
      )}
    </section>
  );
}

const Para = memo(function Para({ c, items }: {
  c: number; items: { k: string; cls: string; text: string; i: number; gap?: string }[]; sig: string;
}) {
  return (
    <p className="para">
      {items.map((it) =>
        it.gap !== undefined ? (
          <span key={it.k} className={it.cls} data-c={c} data-gap={it.gap} data-i={it.i}>{it.text}</span>
        ) : (
          // The space travels inside the word, so a selection or a strike-through runs
          // across the gaps between words instead of breaking into separate boxes.
          <span key={it.k} className={it.cls} data-c={c} data-i={it.i}>{it.text + " "}</span>
        ),
      )}
    </p>
  );
}, (a, b) => a.sig === b.sig && a.c === b.c);
