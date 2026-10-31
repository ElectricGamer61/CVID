// Shared caption types + grouping logic. Mirrors backend captions.py so the live
// browser preview matches the burned ASS export.

export interface CaptionStyle {
  font: string;
  size: number; // ASS fontsize on the 1080-wide canvas
  color: string; // #RRGGBB
  highlight: string; // #RRGGBB
  outline_color: string;
  outline: number;
  shadow: number;
  bold: number;
  uppercase: boolean;
  position: "top" | "mid" | "bottom" | string;
  max_words: number;
}

export interface Word {
  start: number;
  end: number;
  word: string;
  emphasis?: boolean;   // opt-in AI auto-effect: punch this word visually
  emoji?: string;       // opt-in AI auto-effect: emoji shown with this word
}

// Fallback presets if the API hasn't loaded yet (kept in sync with captions.PRESETS).
// "cinematic" is first and is what a new clip gets: the big cinematic text people ask for
// IS the subtitle style — huge, two words at a time, across the middle of the frame.
export const FALLBACK_PRESETS: Record<string, CaptionStyle> = {
  cinematic: { font: "Arial", size: 126, color: "#FFFFFF", highlight: "#FFD400", outline_color: "#000000", outline: 10, shadow: 0, bold: 1, uppercase: true, position: "mid", max_words: 2 },
  capcut: { font: "Arial", size: 92, color: "#FFFFFF", highlight: "#FFD400", outline_color: "#000000", outline: 7, shadow: 0, bold: 1, uppercase: false, position: "bottom", max_words: 4 },
  hormozi: { font: "Arial", size: 104, color: "#FFFFFF", highlight: "#22FF55", outline_color: "#000000", outline: 8, shadow: 0, bold: 1, uppercase: true, position: "mid", max_words: 3 },
  beasty: { font: "Arial", size: 110, color: "#FFFFFF", highlight: "#00E5FF", outline_color: "#000000", outline: 6, shadow: 3, bold: 1, uppercase: true, position: "mid", max_words: 3 },
  clean: { font: "Arial", size: 72, color: "#F2F2F2", highlight: "#FFFFFF", outline_color: "#000000", outline: 3, shadow: 0, bold: 1, uppercase: false, position: "bottom", max_words: 6 },
};

// The preset name is an id, not a label. Anything the API sends that isn't listed here
// still renders (falling back to its own id), so a new backend preset is never invisible.
export const PRESET_INFO: Record<string, { label: string; hint: string }> = {
  cinematic: { label: "Cinematic", hint: "huge subtitles, 2 words at a time" },
  capcut: { label: "CapCut", hint: "classic bottom captions" },
  hormozi: { label: "Hormozi", hint: "green pop, all caps" },
  beasty: { label: "Beasty", hint: "cyan, high energy" },
  clean: { label: "Clean", hint: "small and quiet" },
};

export const presetLabel = (id: string) => PRESET_INFO[id]?.label ?? id;
export const presetHint = (id: string) => PRESET_INFO[id]?.hint ?? "";

/** Is this style the big cinematic subtitle look? Drives the "big subtitles are on"
 *  affordances in the editor — by shape, so a hand-tweaked style still counts. */
export const isBigSubtitleStyle = (s: CaptionStyle | undefined | null) =>
  !!s && s.size >= 120 && s.max_words <= 3;

export const DEFAULT_PRESET = "cinematic";

function endsSentence(w: string): boolean {
  const t = w.trim();
  return t.endsWith(".") || t.endsWith("!") || t.endsWith("?");
}

export function groupLines(words: Word[], maxWords: number): Word[][] {
  const lines: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (!w.word.trim()) continue;
    cur.push(w);
    if (cur.length >= maxWords || endsSentence(w.word)) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Which caption line + active word index is showing at time t (absolute video sec).
export function captionAt(
  words: Word[],
  t: number,
  maxWords: number
): { line: Word[]; activeIdx: number } | null {
  const lines = groupLines(words, maxWords);
  for (const line of lines) {
    const ls = line[0].start;
    const le = line[line.length - 1].end;
    if (t >= ls && t <= le + 0.15) {
      let activeIdx = 0;
      for (let i = 0; i < line.length; i++) if (t >= line[i].start) activeIdx = i;
      return { line, activeIdx };
    }
  }
  return null;
}

export function wordsInRange(words: Word[], start: number, end: number): Word[] {
  return words.filter((w) => w.end > start && w.start < end);
}

// --- fit: a caption line must never run off the frame (mirror of captions.fit_layout) ------
// Arial Bold advance widths in em units. Same table, constants and rule as the backend, so
// the preview lays out exactly what the export burns: two long words go onto two rows, and
// only then shrink as far as the widest row needs. Lines that fit are untouched.
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UPPER_EM = [.722, .722, .722, .722, .667, .611, .778, .722, .278, .556, .722, .611, .833,
  .722, .778, .667, .778, .722, .667, .611, .722, .667, .944, .667, .667, .611];
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const LOWER_EM = [.556, .611, .556, .611, .556, .333, .611, .611, .278, .278, .556, .278, .889,
  .611, .611, .611, .611, .389, .556, .333, .611, .556, .778, .556, .556, .500];
const PUNCT_EM: Record<string, number> = {
  " ": .278, ".": .278, ",": .278, ":": .333, ";": .333, "!": .333, "?": .611, "'": .238,
  '"': .474, "-": .333, "%": .889, "$": .556, "&": .722, "(": .333, ")": .333, "/": .278,
};
const DEFAULT_EM = .611;
const EMOJI_EM = 1.15;
export const FIT_MARGIN = 80;      // Base style MarginL / MarginR on the 1080-wide canvas
export const FIT_MIN_SCALE = 0.45;
export const ACTIVE_POP = 1.12;
export const EMPHASIS_POP = 1.18;
const SPLIT_BELOW = 0.8;

const charEm = (ch: string): number => {
  const u = UPPER.indexOf(ch); if (u >= 0) return UPPER_EM[u];
  const l = LOWER.indexOf(ch); if (l >= 0) return LOWER_EM[l];
  if (ch >= "0" && ch <= "9") return .556;
  if (ch in PUNCT_EM) return PUNCT_EM[ch];
  const cp = ch.codePointAt(0) ?? 0;
  return cp > 0x2000 && !/[\p{L}\p{N}]/u.test(ch) ? EMOJI_EM : DEFAULT_EM;
};

/** Width of a string in em units of Arial Bold (iterates code points, like Python). */
export const textEm = (text: string): number => [...text].reduce((s, ch) => s + charEm(ch), 0);

const wordEm = (w: Word, uppercase: boolean): number => {
  const base = uppercase ? w.word.trim().toUpperCase() : w.word.trim();
  const text = base + (w.emoji ? ` ${w.emoji}` : "");
  return textEm(text) * (w.emphasis ? EMPHASIS_POP : ACTIVE_POP);
};
const rowEm = (widths: number[]): number =>
  widths.reduce((a, b) => a + b, 0) + PUNCT_EM[" "] * Math.max(0, widths.length - 1);

/** { scale, split } for one caption line: split = index of the first word on row two. */
export function fitLayout(line: Word[], style: CaptionStyle, outW = 1080): { scale: number; split: number | null } {
  if (!line.length) return { scale: 1, split: null };
  const widths = line.map((w) => wordEm(w, style.uppercase));
  const available = outW - 2 * FIT_MARGIN;
  // The outline is a fixed style width (\fs does not shrink it): only the font share scales.
  const scaleFor = (em: number) =>
    em * style.size + 2 * style.outline <= available ? 1
      : Math.max(FIT_MIN_SCALE, (available - 2 * style.outline) / (em * style.size));
  const oneRow = scaleFor(rowEm(widths));
  if (oneRow >= SPLIT_BELOW || line.length < 2) return { scale: oneRow, split: null };
  let best: { scale: number; split: number | null } = { scale: oneRow, split: null };
  for (let split = 1; split < line.length; split++) {
    const k = scaleFor(Math.max(rowEm(widths.slice(0, split)), rowEm(widths.slice(split))));
    if (k > best.scale + 1e-9) best = { scale: k, split };
  }
  return best;
}
